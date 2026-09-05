import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { Button } from "../../shared/ui/primitives";
import CustomerPicker from "../workOrders/CustomerPicker.jsx";
import EquipmentPicker from "../workOrders/EquipmentPicker.jsx";
import { useAccountPicker } from "../../hooks/useAccountPicker";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useAuth } from "../../auth/AuthContext";
import { useGovernedCapabilities } from "../../access/useGovernedCapabilities.js";
import {
  DEFAULT_INBOUND_WORK_SOURCE,
  INBOUND_WORK_CAPABILITY_REQUEST,
  INBOUND_WORK_READ,
  INBOUND_WORK_ACCEPT,
  INBOUND_WORK_DECLINE,
  INBOUND_WORK_ATTACH,
  SOURCE_STATUS,
} from "../../access/inboundWorkSource.js";

// SERVICE -> INBOUND WORK. The operational queue for work that arrived from outside EOS -- today by email
// from Taylor Corporate, vendors and manufacturers.
//
// THE POINT OF THE SCREEN IS THAT NOBODY RETYPES ANYTHING. The left side is the message exactly as it
// arrived; the right side is what EOS made of it. A reviewer confirms or corrects the interpretation and
// presses Accept Job, and the Work Order is created server-side from those confirmed values.
//
// NOTHING HERE IS AUTHORITY. Every control is rendered from the trusted effective-access feed and every
// action is re-authorized server-side; hiding a button is a courtesy, not a security boundary. The
// pickers are the SAME CustomerPicker / EquipmentPicker / location read the Work Order wizard uses --
// a second lookup system for the same records is how two surfaces come to disagree about a customer.
//
// THE ORIGINAL MESSAGE IS TEXT. The governed read never sends the stored markup; `originalBodyText` is
// plain text and is rendered as text. There is no dangerouslySetInnerHTML in this file, and there must
// never be one: inbound email is untrusted external input.

const DECLINE_REASONS = [
  ["OUTSIDE_SERVICE_AREA", "Outside service area"],
  ["UNSUPPORTED_EQUIPMENT", "Unsupported equipment"],
  ["CAPACITY", "No capacity"],
  ["DUPLICATE", "Duplicate request"],
  ["CUSTOMER_ACCOUNT_ISSUE", "Customer account issue"],
  ["INVALID_REQUEST", "Invalid request"],
  ["OTHER", "Other"],
];

const REQUEST_TYPES = ["SERVICE", "WARRANTY", "INSTALL", "PM", "PARTS", "OTHER"];

const PRIORITIES = [
  [1, "1 — Emergency"],
  [2, "2 — High"],
  [3, "3 — Normal"],
  [4, "4 — Low"],
];

const STATUS_TONE = {
  AWAITING_DECISION: "info",
  NEEDS_REVIEW: "attention",
  ACCEPTED: "positive",
  DECLINED: "unknown",
  ATTACHED: "positive",
  DUPLICATE: "unknown",
  FAILED: "attention",
  QUARANTINED: "attention",
};

const WARNING_LABELS = {
  NO_PROBLEM_DESCRIPTION: "No problem description found",
  NO_SERIAL_NUMBER: "No serial number found",
  NO_EXTERNAL_REFERENCE: "No warranty or reference number found",
};

const formatWhen = (millis) => (millis ? new Date(millis).toLocaleString() : "—");

function Fact({ label, children }) {
  return (
    <div className="fo-inbound-fact">
      <span className="fo-inbound-fact__label">{label}</span>
      <span className="fo-inbound-fact__value">{children ?? "—"}</span>
    </div>
  );
}

/** The message as it arrived. Read-only evidence; never edited, never re-rendered as markup. */
function OriginalMessage({ detail }) {
  return (
    <section className="fo-inbound-pane" aria-label="Original message">
      <h4 className="fo-inbound-pane__title">Original message</h4>
      <Fact label="From">{detail.sender || "Unknown sender"}</Fact>
      <Fact label="To">{detail.recipients.join(", ") || "—"}</Fact>
      {detail.cc.length > 0 && <Fact label="CC">{detail.cc.join(", ")}</Fact>}
      <Fact label="Received">{formatWhen(detail.receivedAt)}</Fact>
      <Fact label="Subject">{detail.subject || "(no subject)"}</Fact>
      <Fact label="Source">
        {detail.sourceProvider || "—"} · mailbox {detail.sourceMailboxId || "—"}
      </Fact>
      <pre className="fo-inbound-body">{detail.originalBodyText || "(no message body)"}</pre>
      <h5 className="fo-inbound-pane__subtitle">Attachments</h5>
      {detail.attachmentRefs.length === 0 ? (
        <p className="fo-muted">No attachments.</p>
      ) : (
        <ul className="fo-inbound-attachments">
          {detail.attachmentRefs.map((a) => (
            <li key={`${a.sourceMessageId}:${a.providerAttachmentId}`}>
              <strong>{a.filename}</strong>{" "}
              <span className="fo-muted">
                {a.mimeType} · {a.size} bytes
              </span>
            </li>
          ))}
        </ul>
      )}
      {detail.threadMessages.length > 0 && (
        <>
          <h5 className="fo-inbound-pane__subtitle">Later messages on this thread</h5>
          <ul className="fo-inbound-thread">
            {detail.threadMessages.map((m) => (
              <li key={m.messageId}>
                <span className="fo-muted">
                  {formatWhen(m.receivedAt)} · {m.sender}
                </span>
                <pre className="fo-inbound-body">{m.normalizedBody}</pre>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The review pane. Suggestions arrive as candidate ids; a reviewer confirms or replaces them, and the
 * server re-reads and re-validates whatever is finally submitted.
 */
function Interpretation({ detail, capabilities, onDecided }) {
  const accountPicker = useAccountPicker();
  const [customerId, setCustomerId] = useState(detail.customerCandidate?.id ?? null);
  const [customerName, setCustomerName] = useState(null);
  const [locationId, setLocationId] = useState(detail.locationCandidate?.id ?? "");
  const [equipmentId, setEquipmentId] = useState(detail.equipmentCandidate?.id ?? null);
  const [requestType, setRequestType] = useState(detail.requestType ?? "SERVICE");
  const [priority, setPriority] = useState(detail.priority ?? 3);
  const [problem, setProblem] = useState(detail.problemDescription ?? "");
  const [declineReason, setDeclineReason] = useState("OUTSIDE_SERVICE_AREA");
  const [declineNote, setDeclineNote] = useState("");
  const [attachWorkOrderId, setAttachWorkOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { data: locations, error: locationsError } = useLocationsForAccount(customerId);
  // The chosen name if the reviewer picked one, else the suggested account resolved against the same
  // bounded list the picker offers. Null when neither -- the render says so rather than printing an id.
  const resolvedCustomerName =
    customerName ?? (accountPicker.options ?? []).find((a) => a.id === customerId)?.name ?? null;
  const decided = detail.status !== "AWAITING_DECISION" && detail.status !== "NEEDS_REVIEW";

  // The suggestion is a starting point, not a lock: switching the customer clears the site and unit
  // chosen under the previous one so a stale selection can never be submitted.
  const chooseCustomer = (account) => {
    setCustomerId(account?.id ?? null);
    setCustomerName(account?.name ?? null);
    setLocationId("");
    setEquipmentId(null);
  };

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result?.ok) {
      setError(result?.message ?? "That action could not be completed.");
      return;
    }
    onDecided(result.data);
  };

  return (
    <section className="fo-inbound-pane" aria-label="EOS work interpretation">
      <h4 className="fo-inbound-pane__title">EOS work interpretation</h4>

      {detail.warnings.length > 0 && (
        <p className="fo-inbound-warnings">
          {detail.warnings.map((w) => (
            <StatusPill key={w} tone="attention" label={WARNING_LABELS[w] ?? w} asText />
          ))}
        </p>
      )}
      {detail.processingError && (
        <p className="fo-inline-error" role="alert">
          Processing failed: {detail.processingError}. The message is retained and can be reviewed by hand.
        </p>
      )}

      <div className="fo-inbound-field">
        <label className="fo-wizard-field-label" htmlFor="inbound-type">Request type</label>
        <select id="inbound-type" className="fo-wizard-control" value={requestType} disabled={decided}
          onChange={(e) => setRequestType(e.target.value)}>
          {REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="fo-inbound-field">
        <span className="fo-wizard-field-label">Customer</span>
        {customerId ? (
          <p className="fo-inbound-selected">
            {/* A DOCUMENT ID IS A ROUTING KEY, NOT A NAME (DECISIONS #106). A suggestion arrives as an
                id, so it is resolved against the same bounded account list the picker uses. When the
                account is outside that page the honest answer is that the name could not be read --
                never the raw id, which a reviewer cannot check the suggestion against. */}
            {resolvedCustomerName ?? "Suggested customer — name could not be read"}
            {detail.customerCandidate?.matchedOn && !customerName ? (
              <span className="fo-muted"> — suggested from {detail.customerCandidate.matchedOn}</span>
            ) : null}
            {!decided && (
              <Button variant="tertiary" className="fo-link-btn" onClick={() => chooseCustomer(null)}>Change</Button>
            )}
          </p>
        ) : (
          <CustomerPicker inputId="inbound-customer" accounts={accountPicker.options} onSelect={chooseCustomer} />
        )}
      </div>

      <div className="fo-inbound-field">
        <label className="fo-wizard-field-label" htmlFor="inbound-location">Location</label>
        {locationsError ? (
          <p className="fo-inline-error" role="alert">{locationsError}</p>
        ) : (
          <select id="inbound-location" className="fo-wizard-control" value={locationId} disabled={decided || !customerId}
            onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Select a location…</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="fo-inbound-field">
        <span className="fo-wizard-field-label">Equipment</span>
        <EquipmentPicker
          accountId={customerId}
          locationId={locationId || null}
          type={requestType === "WARRANTY" ? "WARRANTY" : requestType === "INSTALL" ? "INSTALL" : "SERVICE_CALL"}
          value={equipmentId}
          onChange={setEquipmentId}
        />
      </div>

      <Fact label="Model">{detail.modelNumber}</Fact>
      <Fact label="Serial">{detail.serialNumber}</Fact>
      <Fact label="Warranty / authorization">{detail.authorizationNumber}</Fact>
      <Fact label="External reference">{detail.externalReference}</Fact>
      <Fact label="Routing">
        {detail.routingRuleId ? `rule ${detail.routingRuleId}` : "no rule matched — review required"}
        {detail.queue ? ` · queue ${detail.queue}` : ""}
      </Fact>
      <Fact label="Operating company">{detail.operatingCompanyId}</Fact>
      {detail.threadAssociation === "AMBIGUOUS" && (
        <p className="fo-inbound-warnings">
          <StatusPill tone="attention" label="Reply matched more than one open request" asText />
        </p>
      )}

      <div className="fo-inbound-field">
        <label className="fo-wizard-field-label" htmlFor="inbound-priority">Priority</label>
        <select id="inbound-priority" className="fo-wizard-control" value={priority} disabled={decided}
          onChange={(e) => setPriority(Number(e.target.value))}>
          {PRIORITIES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="fo-inbound-field fo-wizard-field-wide">
        <label className="fo-wizard-field-label" htmlFor="inbound-problem">Problem</label>
        <textarea id="inbound-problem" className="fo-wizard-control" rows={3} value={problem} disabled={decided}
          onChange={(e) => setProblem(e.target.value)} />
      </div>

      {decided ? (
        <p className="fo-muted">
          This request is {detail.status}
          {detail.workItemId ? ` and is linked to work order ${detail.workItemId}.` : "."}
        </p>
      ) : (
        <>
          {error && <p className="fo-inline-error" role="alert">{error}</p>}
          <div className="fo-inbound-actions">
            <div className="fo-inbound-decline">
              <label className="fo-wizard-field-label" htmlFor="inbound-decline-reason">Decline reason</label>
              <select id="inbound-decline-reason" className="fo-wizard-control" value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}>
                {DECLINE_REASONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className="fo-wizard-control" placeholder="Note (optional)" value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)} aria-label="Decline note" />
              <Button variant="secondary" disabled={busy || !capabilities.canDecline}
                onClick={() => run(() => capabilities.source.decline({ requestId: detail.id, reason: declineReason, note: declineNote || null }))}>
                Decline Job
              </Button>
            </div>
            <div className="fo-inbound-attach">
              <label className="fo-wizard-field-label" htmlFor="inbound-attach-wo">Existing work order</label>
              <input id="inbound-attach-wo" className="fo-wizard-control" value={attachWorkOrderId}
                placeholder="Work Order id" onChange={(e) => setAttachWorkOrderId(e.target.value)} />
              <Button variant="secondary" disabled={busy || !capabilities.canAttach || !attachWorkOrderId}
                onClick={() => run(() => capabilities.source.attach({ requestId: detail.id, workOrderId: attachWorkOrderId.trim() }))}>
                Attach to Existing Work
              </Button>
            </div>
            <Button variant="primary" disabled={busy || !capabilities.canAccept || !customerId || !locationId}
              onClick={() =>
                run(() =>
                  capabilities.source.accept({
                    requestId: detail.id,
                    customerId,
                    locationId,
                    equipmentId: equipmentId || null,
                    requestType,
                    priority,
                    problemDescription: problem || null,
                  }),
                )
              }>
              Accept Job
            </Button>
          </div>
          {!capabilities.canAccept && (
            <p className="fo-muted">Accepting a job is not part of your role.</p>
          )}
        </>
      )}
    </section>
  );
}

export default function InboundWorkWorkspace({ source = DEFAULT_INBOUND_WORK_SOURCE, capabilityRequest = INBOUND_WORK_CAPABILITY_REQUEST } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasCapability, accessVersion } = useGovernedCapabilities(user, capabilityRequest);
  const [queue, setQueue] = useState({ status: "loading", rows: [], truncated: false });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const canRead = hasCapability(INBOUND_WORK_READ);

  const loadQueue = useCallback(async () => {
    const result = await source.listQueue({});
    if (result.status === SOURCE_STATUS.READY) {
      setQueue({ status: "ready", rows: result.payload.rows ?? [], truncated: Boolean(result.payload.truncated) });
    } else {
      setQueue({ status: result.status, rows: [], truncated: false });
    }
  }, [source]);

  // Re-read on every access change as well as on mount: a revoked capability must not leave a stale
  // queue on screen (the same convention PartsList/Operations follow with accessVersion).
  useEffect(() => {
    if (!canRead) {
      setQueue({ status: SOURCE_STATUS.DENIED, rows: [], truncated: false });
      return;
    }
    setQueue({ status: "loading", rows: [], truncated: false });
    loadQueue();
  }, [canRead, accessVersion, loadQueue, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId || !canRead) {
      setDetail(null);
      return undefined;
    }
    setDetail({ status: "loading" });
    source.getRequest(selectedId).then((result) => {
      if (cancelled) return;
      setDetail(result.status === SOURCE_STATUS.READY ? { status: "ready", value: result.payload } : { status: result.status });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, canRead, source, reloadToken]);

  const counts = useMemo(() => {
    const rows = queue.rows;
    const by = (status) => rows.filter((r) => r.status === status).length;
    return [
      { key: "awaiting", label: "Awaiting decision", value: by("AWAITING_DECISION") },
      { key: "review", label: "Needs review", value: by("NEEDS_REVIEW") },
      { key: "accepted", label: "Accepted", value: by("ACCEPTED") },
      { key: "declined", label: "Declined", value: by("DECLINED") },
    ];
  }, [queue.rows]);

  const capabilities = {
    canAccept: hasCapability(INBOUND_WORK_ACCEPT),
    canDecline: hasCapability(INBOUND_WORK_DECLINE),
    canAttach: hasCapability(INBOUND_WORK_ATTACH),
    source,
  };

  // ACCEPTANCE ENDS ON THE WORK ORDER, not on a toast. The reviewer's next act is always about the job
  // they just created, so the screen takes them there.
  const handleDecided = (data) => {
    setReloadToken((t) => t + 1);
    if (data?.workItemId) navigate(`/service/work-orders/${data.workItemId}`);
  };

  return (
    <WorkspaceShell
      title="Inbound Work"
      density="compact"
      context={<ContextBand items={counts} />}
    >
      {queue.status === "loading" ? (
        <HonestState state={HONEST_STATE.LOADING} subject="inbound work" />
      ) : queue.status === SOURCE_STATUS.DENIED ? (
        <HonestState state={HONEST_STATE.DENIED} subject="Inbound Work" />
      ) : queue.status !== "ready" ? (
        <HonestState state={HONEST_STATE.UNAVAILABLE} subject="The inbound work queue" onRetry={() => setReloadToken((t) => t + 1)} />
      ) : queue.rows.length === 0 ? (
        <HonestState state={HONEST_STATE.EMPTY} subject="Inbound work" detail="No inbound requests have arrived in a connected mailbox yet." />
      ) : (
        <div className="fo-sales-pipeline-wrap">
          <table className="fo-sales-pipeline">
            <thead>
              <tr>
                <th>Received</th>
                <th>From</th>
                <th>Subject</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.rows.map((row) => (
                <tr
                  key={row.id}
                  className={`fo-sales-row ${selectedId === row.id ? "is-selected" : ""}`.trim()}
                  role="button"
                  tabIndex={0}
                  aria-selected={selectedId === row.id}
                  onClick={() => setSelectedId(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(row.id);
                    }
                  }}
                >
                  <td data-label="Received">{formatWhen(row.receivedAt)}</td>
                  <td data-label="From">{row.sender || "Unknown sender"}</td>
                  <td data-label="Subject">{row.subject || "(no subject)"}</td>
                  <td data-label="Type">{row.requestType ?? "—"}</td>
                  <td data-label="Status">
                    <StatusPill tone={STATUS_TONE[row.status] ?? "unknown"} label={row.status} asText />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queue.truncated && <p className="fo-muted">Showing the most recent requests only.</p>}
        </div>
      )}

      {selectedId && detail?.status === "loading" && <HonestState state={HONEST_STATE.LOADING} subject="this request" />}
      {selectedId && detail?.status === SOURCE_STATUS.DENIED && <HonestState state={HONEST_STATE.DENIED} subject="This request" />}
      {selectedId && detail?.status === SOURCE_STATUS.UNAVAILABLE && (
        <HonestState state={HONEST_STATE.UNAVAILABLE} subject="This request" onRetry={() => setReloadToken((t) => t + 1)} />
      )}
      {detail?.status === "ready" && (
        <div className="fo-inbound-review">
          <OriginalMessage detail={detail.value} />
          <Interpretation key={detail.value.id} detail={detail.value} capabilities={capabilities} onDecided={handleDecided} />
        </div>
      )}
    </WorkspaceShell>
  );
}

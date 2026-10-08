import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { Button } from "../../shared/ui/primitives";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { operatingCompanyLabel, titleCase } from "../../shared/display/displayLabels.js";
import CustomerPicker from "../workOrders/CustomerPicker.jsx";
import EquipmentPicker from "../workOrders/EquipmentPicker.jsx";
import { useAccountPicker } from "../../hooks/useAccountPicker";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import {
  EOS_INBOUND_WORK_SOURCE,
  INBOUND_SOURCE_STATUS as SOURCE_STATUS,
  INBOUND_WORK_NOT_YET_ACTIVATED_MESSAGE,
} from "../../services/inboundWorkApiClient.js";

// SERVICE -> INBOUND WORK. The operational queue for work that arrived from outside EOS -- today by email
// from Taylor Corporate, vendors and manufacturers.
//
// THE POINT OF THE SCREEN IS THAT NOBODY RETYPES ANYTHING. The left side is the message exactly as it
// arrived; the right side is what EOS made of it. A reviewer confirms or corrects the interpretation and
// presses Accept Job, and the Work Order is created server-side from those confirmed values.
//
// THE GOVERNED EOS PATH (Owner ruling W9, 2026-09-30). Every read and decision goes to POST
// /operations/inbound-work (services/inboundWorkApiClient.js) -- the governed PostgreSQL intake. Accept creates the
// Work Order through the governed EOS Work Order create, with the operating company STATED here by the reviewer
// (never inferred from the sender, the mailbox or the customer). No Firebase Inbound Work callable is invoked, and
// there is no fallback: while the Work Order authority is not activated the screen says NOT_YET_ACTIVATED.
//
// NOTHING HERE IS AUTHORITY. Controls are rendered from the caller's own decision set (readInboundWorkAccess) and
// every action is re-authorized server-side; hiding a button is a courtesy, not a security boundary. The
// pickers are the SAME CustomerPicker / EquipmentPicker / location read the Work Order wizard uses --
// a second lookup system for the same records is how two surfaces come to disagree about a customer.
//
// THE ORIGINAL MESSAGE IS TEXT. The governed read never sends the stored markup; `originalBodyText` is
// plain text and is rendered as text. There is no dangerouslySetInnerHTML in this file, and there must
// never be one: inbound email is untrusted external input.

const DECLINE_REASONS = [
  ["OUTSIDE_SERVICE_AREA", "Outside Service Area"],
  ["UNSUPPORTED_EQUIPMENT", "Unsupported Equipment"],
  ["CAPACITY", "No Capacity"],
  ["DUPLICATE", "Duplicate Request"],
  ["CUSTOMER_ACCOUNT_ISSUE", "Customer Account Issue"],
  ["INVALID_REQUEST", "Invalid Request"],
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
  ACCEPTING: "info",
  ACCEPTED: "positive",
  DECLINED: "unknown",
  ATTACHED: "positive",
  DUPLICATE: "unknown",
  FAILED: "attention",
  QUARANTINED: "attention",
};

const STATUS_LABELS = {
  AWAITING_DECISION: "Awaiting Decision",
  NEEDS_REVIEW: "Needs Review",
  ACCEPTING: "Acceptance in Progress",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  ATTACHED: "Attached to Existing Work",
  DUPLICATE: "Duplicate of an Earlier Message",
  FAILED: "Processing Failed",
  QUARANTINED: "Quarantined",
};

const PROVIDER_LABELS = { MICROSOFT_365: "Microsoft 365", GOOGLE_WORKSPACE: "Google Workspace" };

const REQUEST_TYPE_LABELS = {
  SERVICE: "Service",
  WARRANTY: "Warranty",
  INSTALL: "Install",
  PM: "Planned Maintenance",
  PARTS: "Parts",
  OTHER: "Other",
};

/** A stored token as a label. Unmapped values degrade to Title Case, never to a raw enum. */
function label(map, value) {
  if (!value) return "—";
  return map[value] ?? titleCase(value);
}

/** File size as a person reads it. "2412881 bytes" is a number; "2.4 MB" is a size. */
function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const WARNING_LABELS = {
  NO_PROBLEM_DESCRIPTION: "No Problem Description Found",
  NO_SERIAL_NUMBER: "No Serial Number Found",
  NO_EXTERNAL_REFERENCE: "No Warranty or Reference Number Found",
};

const formatWhen = (millis) => (millis ? new Date(millis).toLocaleString() : "—");

/** How long a request has been waiting, as a person says it: "3 h", "2 d". */
export function ageLabel(millis, now = Date.now()) {
  if (!millis) return "—";
  const minutes = Math.max(0, Math.round((now - millis) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (24 * 60))} d`;
}

/** The at-a-glance flags a reviewer needs: thread replies, duplicate content, quarantine, attachments. */
export function queueFlags(row) {
  const flags = [];
  if (row.threadMessageCount > 0) flags.push(`${row.threadMessageCount} repl${row.threadMessageCount === 1 ? "y" : "ies"}`);
  if (row.threadAssociation === "AMBIGUOUS") flags.push("Ambiguous thread");
  if (row.duplicateOfRequestId) flags.push("Possible duplicate");
  if (row.status === "QUARANTINED") flags.push("Quarantined");
  if (row.attachmentCount > 0) flags.push(`${row.attachmentCount} attachment${row.attachmentCount === 1 ? "" : "s"}`);
  if (row.attachmentCustody === "REFUSED_UNSAFE") flags.push("Unsafe attachment blocked");
  return flags;
}

const CUSTODY_PILLS = {
  STORED: ["positive", "Held in EOS"],
  PENDING: ["info", "Being retrieved from the mailbox"],
  FAILED: ["attention", "Could not be retrieved"],
  REFUSED_UNSAFE: ["attention", "Blocked — unsafe attachment, never downloaded"],
  METADATA_ONLY: ["info", "Held by the mailbox provider — not copied into EOS"],
};

/** Offer a custodied attachment as an opaque download. Never rendered, never opened as its declared type. */
function downloadAttachment(payload) {
  const bytes = Uint8Array.from(atob(payload.contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = payload.filename || "attachment";
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Fact({ label, children }) {
  return (
    <div className="fo-inbound-fact">
      <span className="fo-inbound-fact__label">{label}</span>
      <span className="fo-inbound-fact__value">{children ?? "—"}</span>
    </div>
  );
}

/** The message as it arrived. Read-only evidence; never edited, never re-rendered as markup. */
function OriginalMessage({ detail, source }) {
  const [downloadError, setDownloadError] = useState(null);
  return (
    <section className="fo-inbound-pane" aria-label="Original Message">
      <h2 className="fo-inbound-pane__title">Original Message</h2>
      <Fact label="From">{detail.sender || "Unknown sender"}</Fact>
      <Fact label="To">{detail.recipients.join(", ") || "—"}</Fact>
      {detail.cc.length > 0 && <Fact label="CC">{detail.cc.join(", ")}</Fact>}
      <Fact label="Received">{formatWhen(detail.receivedAt)}</Fact>
      <Fact label="Subject">{detail.subject || "(no subject)"}</Fact>
      <Fact label="Source">
        {label(PROVIDER_LABELS, detail.sourceProvider)}
        {detail.sourceMailboxName ? ` · ${detail.sourceMailboxName}` : ""}
      </Fact>
      <pre className="fo-inbound-body">{detail.originalBodyText || "(no message body)"}</pre>
      <h3 className="fo-inbound-pane__subtitle">Attachments</h3>
      {detail.attachmentRefs.length === 0 ? (
        <p className="fo-muted">No attachments.</p>
      ) : (
        <ul className="fo-inbound-attachments">
          {detail.attachmentRefs.map((a) => (
            <li key={`${a.sourceMessageId}:${a.providerAttachmentId}`}>
              <strong>{a.filename}</strong>{" "}
              <span className="fo-muted">
                {a.mimeType} · {fileSize(a.size)}
              </span>{" "}
              {/* CUSTODY IS STATED, NOT ASSUMED: held in EOS (downloadable, through this request), still being
                  retrieved, failed, blocked as unsafe, or metadata only -- each says so. */}
              <StatusPill tone={(CUSTODY_PILLS[a.custody] ?? CUSTODY_PILLS.METADATA_ONLY)[0]}
                label={(CUSTODY_PILLS[a.custody] ?? CUSTODY_PILLS.METADATA_ONLY)[1]} asText />
              {a.custody === "STORED" && a.attachmentId && typeof source?.readAttachment === "function" && (
                <Button variant="tertiary" className="fo-link-btn" onClick={async () => {
                  setDownloadError(null);
                  const res = await source.readAttachment({ requestId: detail.id, attachmentId: a.attachmentId });
                  if (res.status === SOURCE_STATUS.READY) downloadAttachment(res.payload);
                  else setDownloadError("That attachment could not be downloaded.");
                }}>
                  Download
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {downloadError && <p className="fo-inline-error" role="alert">{downloadError}</p>}
      {detail.statusNote && <p className="fo-muted" role="note">{detail.statusNote}</p>}
      {detail.threadMessages.length > 0 && (
        <>
          <h3 className="fo-inbound-pane__subtitle">Later Messages on This Thread</h3>
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
function Interpretation({ detail, capabilities, onDecided, onOpenWorkOrder }) {
  const accountPicker = useAccountPicker();
  // THE OPERATING COMPANY IS STATED, NEVER PRE-FILLED. The routed suggestion is shown beside the choice; choosing
  // it is the reviewer's act. The options are the governed ACTIVE + keyed companies (listWorkOrderOperatingCompanies).
  const [operatingCompanyId, setOperatingCompanyId] = useState("");
  const [companies, setCompanies] = useState({ status: "loading", items: [] });
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

  useEffect(() => {
    let active = true;
    if (decided || !capabilities.canAccept || typeof capabilities.source.listOperatingCompanies !== "function") {
      setCompanies({ status: "skipped", items: [] });
      return undefined;
    }
    capabilities.source.listOperatingCompanies().then((res) => {
      if (!active) return;
      setCompanies(res?.status === SOURCE_STATUS.READY
        ? { status: "ready", items: res.payload.items ?? [] }
        : { status: res?.status ?? SOURCE_STATUS.UNAVAILABLE, items: [] });
    });
    return () => {
      active = false;
    };
  }, [decided, capabilities.canAccept, capabilities.source]);

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
    <section className="fo-inbound-pane" aria-label="EOS Work Interpretation">
      <h2 className="fo-inbound-pane__title">EOS Work Interpretation</h2>

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
        <label className="fo-wizard-field-label" htmlFor="inbound-type">Request Type</label>
        <select id="inbound-type" className="fo-wizard-control" value={requestType} disabled={decided}
          onChange={(e) => setRequestType(e.target.value)}>
          {REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>{REQUEST_TYPE_LABELS[t] ?? t}</option>
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
      <Fact label="Warranty / Authorization">{detail.authorizationNumber}</Fact>
      <Fact label="External Reference">{detail.externalReference}</Fact>
      <Fact label="Routing">
        {detail.routingRuleName || (detail.routingRuleId ? "Matched a routing rule that has since been removed" : "No rule matched — review required")}
        {detail.queue ? ` · queue ${detail.queue}` : ""}
      </Fact>
      <Fact label="Suggested Operating Company">{operatingCompanyLabel(detail.suggestedOperatingCompanyId, { short: false })}</Fact>
      {decided ? (
        <Fact label="Operating Company">{operatingCompanyLabel(detail.operatingCompanyId, { short: false })}</Fact>
      ) : (
        <div className="fo-inbound-field">
          <label className="fo-wizard-field-label" htmlFor="inbound-company">Operating Company</label>
          <select id="inbound-company" className="fo-wizard-control" value={operatingCompanyId}
            disabled={!capabilities.canAccept || companies.status !== "ready"}
            onChange={(e) => setOperatingCompanyId(e.target.value)}>
            <option value="">Select the operating company…</option>
            {companies.items.map((c) => (
              <option key={c.operatingCompanyId} value={c.operatingCompanyId}>{operatingCompanyLabel(c.operatingCompanyId, { short: false })}</option>
            ))}
          </select>
          {companies.status !== "ready" && companies.status !== "loading" && companies.status !== "skipped" && (
            <p className="fo-inline-error" role="alert">The governed operating companies could not be read.</p>
          )}
        </div>
      )}
      {detail.threadAssociation === "AMBIGUOUS" && (
        <p className="fo-inbound-warnings">
          <StatusPill tone="attention" label="Reply Matched More Than One Open Request" asText />
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
        <p className="fo-inbound-decided">
          <StatusPill tone={STATUS_TONE[detail.status] ?? "unknown"} label={label(STATUS_LABELS, detail.status)} asText />
          {detail.workItemId ? (
            <Button variant="tertiary" className="fo-link-btn" onClick={() => onOpenWorkOrder(detail.workItemId)}>
              Open the Work Order{detail.workOrderNumber ? ` ${detail.workOrderNumber}` : ""}
            </Button>
          ) : null}
        </p>
      ) : (
        <>
          {error && <p className="fo-inline-error" role="alert">{error}</p>}
          <div className="fo-inbound-actions">
            <div className="fo-inbound-decline">
              <label className="fo-wizard-field-label" htmlFor="inbound-decline-reason">Decline Reason</label>
              <select id="inbound-decline-reason" className="fo-wizard-control" value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}>
                {DECLINE_REASONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className="fo-wizard-control" placeholder="Note (optional)" value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)} aria-label="Decline Note" />
              <Button variant="secondary" disabled={busy || !capabilities.canDecline}
                onClick={() => run(() => capabilities.source.decline({ requestId: detail.id, reason: declineReason, note: declineNote || null }))}>
                Decline Job
              </Button>
            </div>
            <div className="fo-inbound-attach">
              <label className="fo-wizard-field-label" htmlFor="inbound-attach-wo">Existing Work Order</label>
              <input id="inbound-attach-wo" className="fo-wizard-control" value={attachWorkOrderId}
                placeholder="Work Order id" onChange={(e) => setAttachWorkOrderId(e.target.value)} />
              <Button variant="secondary" disabled={busy || !capabilities.canAttach || !attachWorkOrderId}
                onClick={() => run(() => capabilities.source.attach({ requestId: detail.id, workOrderId: attachWorkOrderId.trim() }))}>
                Attach to Existing Work
              </Button>
            </div>
            <Button variant="primary" disabled={busy || !capabilities.canAccept || !customerId || !locationId || !operatingCompanyId}
              onClick={() =>
                run(() =>
                  capabilities.source.accept({
                    requestId: detail.id,
                    operatingCompanyId,
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

const CLAIM_EVENT_LABELS = { CLAIMED: "Accepted by", RELEASED: "Released by recovery", REASSIGNED: "Reassigned", COMPLETED: "Completed by" };

/**
 * WHO HAS IT, AND WHAT HAPPENED TO IT. The claim history is shown to every reader; RELEASE / REASSIGN are offered only
 * to a caller holding inboundWork.request.recover (the Service Manager), and only on an unfinished ACCEPTING claim. The
 * server re-authorizes both and refuses anything outside Service intake.
 */
function ClaimPanel({ detail, capabilities, onRecovered }) {
  const [reason, setReason] = useState("");
  const [targets, setTargets] = useState({ status: "idle", items: [] });
  const [target, setTarget] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const recoverable = detail.status === "ACCEPTING" && capabilities.canRecover;
  useEffect(() => {
    if (!recoverable || typeof capabilities.source.listRecoveryTargets !== "function") return;
    let live = true;
    setTargets({ status: "loading", items: [] });
    capabilities.source.listRecoveryTargets(detail.id).then((res) => {
      if (live) setTargets(res.status === SOURCE_STATUS.READY ? { status: "ready", items: res.payload.targets ?? [] } : { status: res.status, items: [] });
    });
    return () => { live = false; };
  }, [recoverable, detail.id, capabilities.source]);
  const history = detail.claimHistory ?? [];
  if (detail.status !== "ACCEPTING" && history.length === 0) return null;
  const act = async (fn) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setError(res.message);
    else onRecovered?.();
  };
  return (
    <section className="fo-inbound-pane" aria-label="Reviewer">
      <h3 className="fo-inbound-pane__subtitle">Reviewer</h3>
      {detail.status === "ACCEPTING" && (
        <p>
          Accepted by <strong>{detail.claimedByName ?? "another reviewer"}</strong> {formatWhen(detail.claimedAt)} — not yet finished.
          {detail.pendingWorkOrderId ? " A Work Order was already created; finishing the acceptance links it." : ""}
        </p>
      )}
      {history.length > 0 && (
        <ol className="fo-inbound-thread" aria-label="Reviewer History">
          {history.map((e, i) => (
            <li key={`${e.kind}-${i}`}>
              <span className="fo-muted">{formatWhen(e.at)}</span>{" "}
              {CLAIM_EVENT_LABELS[e.kind] ?? e.kind}{" "}
              {e.kind === "REASSIGNED" ? `from ${e.fromName ?? "a reviewer"} to ${e.toName ?? "a reviewer"}` : e.kind === "RELEASED" ? `(was ${e.fromName ?? "a reviewer"})` : e.toName ?? e.fromName ?? ""}
              {e.reason ? ` — ${e.reason}` : ""}
            </li>
          ))}
        </ol>
      )}
      {recoverable && (
        <div className="fo-inbound-form">
          {error && <p className="fo-inline-error" role="alert">{error}</p>}
          <label className="fo-wizard-field">
            <span>Reason (Required)</span>
            <input className="fo-wizard-control" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
          <Button variant="secondary" disabled={busy || !reason.trim()}
            onClick={() => act(() => capabilities.source.release({ requestId: detail.id, reason: reason.trim() }))}>
            Release to Queue
          </Button>
          <label className="fo-wizard-field">
            <span>Reassign To</span>
            <select className="fo-wizard-control" value={target} onChange={(e) => setTarget(e.target.value)} disabled={targets.status !== "ready"}>
              <option value="">{targets.status === "loading" ? "Loading reviewers…" : "Choose a reviewer…"}</option>
              {targets.items.map((t) => (
                <option key={t.employeeId} value={t.employeeId}>{t.displayName ?? t.employeeId}</option>
              ))}
            </select>
          </label>
          <Button variant="secondary" disabled={busy || !reason.trim() || !target}
            onClick={() => act(() => capabilities.source.reassign({ requestId: detail.id, employeeId: target, reason: reason.trim() }))}>
            Reassign
          </Button>
        </div>
      )}
    </section>
  );
}

const QUEUE_SORT_COLUMNS = Object.freeze({
  received: { value: (row) => row.receivedAt || null },
  // Age is "now minus arrival": ascending = youngest (latest arrival) first.
  age: { value: (row) => { const at = row.receivedAt || row.createdAt; return at ? -at : null; } },
  mailbox: { value: (row) => row.sourceMailboxName ?? null },
  from: { value: (row) => row.sender || null },
  subject: { value: (row) => row.subject || null },
  type: { value: (row) => (row.requestType ? label(REQUEST_TYPE_LABELS, row.requestType) : null) },
  status: { value: (row) => (row.status ? label(STATUS_LABELS, row.status) : null) },
  reviewer: { value: (row) => (row.status === "ACCEPTING" ? (row.claimedByName ?? "Another reviewer") : null) },
  flags: { value: (row) => queueFlags(row).join(" · ") || null },
});

export default function InboundWorkWorkspace({ source = EOS_INBOUND_WORK_SOURCE } = {}) {
  const navigate = useNavigate();
  const [access, setAccess] = useState({ status: "loading", value: null });
  const [queue, setQueue] = useState({ status: "loading", rows: [], truncated: false });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // The caller's OWN decision set, from the same governed authority that enforces it.
  useEffect(() => {
    let active = true;
    setAccess({ status: "loading", value: null });
    source.readAccess().then((res) => {
      if (active) setAccess(res.status === SOURCE_STATUS.READY ? { status: "ready", value: res.payload } : { status: res.status, value: null });
    });
    return () => {
      active = false;
    };
  }, [source, reloadToken]);

  const canRead = access.status === "ready" && access.value?.canRead === true;

  const loadQueue = useCallback(async () => {
    const result = await source.listQueue({});
    if (result.status === SOURCE_STATUS.READY) {
      setQueue({ status: "ready", rows: result.payload.rows ?? [], truncated: Boolean(result.payload.truncated) });
    } else {
      setQueue({ status: result.status, rows: [], truncated: false });
    }
  }, [source]);

  // Re-read on every access change as well as on mount: a revoked capability must not leave a stale queue.
  useEffect(() => {
    if (access.status === "loading") {
      setQueue({ status: "loading", rows: [], truncated: false });
      return;
    }
    if (access.status !== "ready") {
      setQueue({ status: access.status, rows: [], truncated: false });
      return;
    }
    if (!canRead) {
      setQueue({ status: SOURCE_STATUS.DENIED, rows: [], truncated: false });
      return;
    }
    setQueue({ status: "loading", rows: [], truncated: false });
    loadQueue();
  }, [access.status, canRead, loadQueue, reloadToken]);

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
      { key: "awaiting", label: "Awaiting Decision", value: by("AWAITING_DECISION") },
      { key: "review", label: "Needs Review", value: by("NEEDS_REVIEW") },
      { key: "accepting", label: "Accepted, Unfinished", value: by("ACCEPTING") },
      { key: "quarantined", label: "Quarantined", value: by("QUARANTINED") },
      { key: "accepted", label: "Accepted", value: by("ACCEPTED") },
      { key: "declined", label: "Declined", value: by("DECLINED") },
    ];
  }, [queue.rows]);

  // HEADER SORTING over the queue already read; no sort = the server's queue order.
  const { sort, toggle, sorted: sortedQueueRows } = useTableSort({ rows: queue.rows, columns: QUEUE_SORT_COLUMNS });

  const capabilities = useMemo(() => ({
    canAccept: access.value?.canAccept === true,
    canDecline: access.value?.canDecline === true,
    canAttach: access.value?.canAttach === true,
    canRecover: access.value?.canRecover === true,
    source,
  }), [access.value, source]);

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
      ) : queue.status === SOURCE_STATUS.NOT_ACTIVATED ? (
        <div className="fo-muted fo-work-order-readiness" role="status" data-inbound-work-readiness="NOT_YET_ACTIVATED">
          <strong>Inbound Work: Not Yet Activated.</strong> {INBOUND_WORK_NOT_YET_ACTIVATED_MESSAGE}
        </div>
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
                <SortableHeader columnKey="received" label="Received" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="age" label="Age" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="mailbox" label="Mailbox" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="from" label="From" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="subject" label="Subject" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="type" label="Type" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="status" label="Status" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="reviewer" label="Reviewer" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="flags" label="Flags" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {sortedQueueRows.map((row) => (
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
                  <td data-label="Age">{ageLabel(row.receivedAt || row.createdAt)}</td>
                  <td data-label="Mailbox">{row.sourceMailboxName ?? "—"}</td>
                  <td data-label="From">{row.sender || "Unknown sender"}</td>
                  <td data-label="Subject">{row.subject || "(no subject)"}</td>
                  <td data-label="Type">{label(REQUEST_TYPE_LABELS, row.requestType)}</td>
                  <td data-label="Status">
                    <StatusPill tone={STATUS_TONE[row.status] ?? "unknown"} label={label(STATUS_LABELS, row.status)} asText />
                  </td>
                  <td data-label="Reviewer">{row.status === "ACCEPTING" ? (row.claimedByName ?? "Another reviewer") : "—"}</td>
                  <td data-label="Flags">{queueFlags(row).join(" · ") || "—"}</td>
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
          <OriginalMessage detail={detail.value} source={source} />
          <ClaimPanel key={`claim-${detail.value.id}`} detail={detail.value} capabilities={capabilities} onRecovered={() => setReloadToken((t) => t + 1)} />
          <Interpretation
            key={detail.value.id}
            detail={detail.value}
            capabilities={capabilities}
            onDecided={handleDecided}
            onOpenWorkOrder={(id) => navigate(`/service/work-orders/${id}`)}
          />
        </div>
      )}
    </WorkspaceShell>
  );
}

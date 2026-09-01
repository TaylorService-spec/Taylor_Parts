import { useEffect, useMemo, useRef, useState } from "react";
import { useReorderRequestsByStatuses } from "../../hooks/useReorderRequests";
import { usePurchaseOrdersByIds } from "../../hooks/usePurchaseOrdersByIds";
import { buildPurchaseOrdersView, PURCHASE_ORDERS_STATUS } from "../../domain/purchaseOrdersView";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { fetchReceivingLocationOptions, submitReceiveInventoryStock } from "../../services/receivingCallableClient";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import {
  buildReceiveRequestInput,
  describeLotNotSupported,
  describePartTrackingBlock,
  describeReceiveOutcome,
  describeSerialEntryIssues,
  isReceivingUnavailable,
  PART_TRACKING_STATUS,
  RECEIVE_STEP,
  resolvePartTrackingMode,
  TRACKING_MODE,
} from "../../domain/receiveAgainstPurchaseOrder";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";
import { Button } from "../../shared/ui/primitives/index.js";

// Receive-against-Purchase-Order (A1) — the ONE canonical governed receive workflow, and the
// single source of truth for receiving. It lives in the capability home modules/receiving/ and is
// consumed by TWO launch points: the Inventory > Receiving workspace (modules/inventory/
// Receiving.jsx, all ORDERED candidates) and the PartsScanner "Receive" action in FieldMode
// (part-scoped via initialPartId). It receives an ORDERED reorder Purchase Order into a warehouse
// location, reusing the existing PO read stack for candidates and the READINESS-GATED, fail-closed
// transport (services/receivingCallableClient.js) for the location options and the receipt itself.
//
// Nothing here can execute a live receipt while readiness is false OR the caller lacks the
// inventory.stock.receive capability — both fail closed to honest sanitized states. No readiness
// flip, deploy, Rules change, or grant is part of this component. There is no demo/ad-hoc receive.
//
// Wave 7 Part 2 -- a SERIAL-tracked Part additionally requires one serial number per unit before
// it can be received. The Part's tracking mode is resolved through the SAME governed Part Master
// read the rest of the app uses (services/partMasterQueries.fetchPartMasterList) -- no new read is
// added -- and a failed/denied read blocks the receipt honestly rather than assuming NONE.
const ORDERED_ONLY = [REORDER_REQUEST_STATUS.ORDERED];

// `initialReorderRequestId` — Receiving North Star frame 1a entry seam. The workspace's
// Awaiting-receipt queue already identified the candidate, so when the matching row is present in
// the governed read it is chosen automatically through the SAME chooseCandidate path a tap uses. If
// it is no longer a candidate (received or voided meanwhile), the normal candidate list renders —
// the read's truth, not the queue's memory. Presentation-only; steps and submit path untouched.
export default function ReceiveAgainstPurchaseOrder({ initialPartId = null, initialReorderRequestId = null, onDone }) {
  const requestsRead = useReorderRequestsByStatuses(ORDERED_ONLY);
  const ids = useMemo(() => requestsRead.data.map((r) => r.id), [requestsRead.data]);
  const purchaseOrdersRead = usePurchaseOrdersByIds(ids);
  const view = useMemo(
    () => buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead }),
    [requestsRead, purchaseOrdersRead]
  );
  const candidates = useMemo(
    () => view.rows.filter((r) => r.isReceiptCandidate && (!initialPartId || r.partId === initialPartId)),
    [view.rows, initialPartId]
  );

  const [step, setStep] = useState(RECEIVE_STEP.SELECT_CANDIDATE);
  const [candidate, setCandidate] = useState(null);
  const [locations, setLocations] = useState({ status: "idle", options: [] });
  const [locationId, setLocationId] = useState("");
  const [partTracking, setPartTracking] = useState({ status: "idle", trackingMode: null });
  const [serials, setSerials] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Guard the async handlers against setState after unmount (the technician can switch the
  // scanner action mid-flight) -- the same cancelled-flag discipline the repo's async hooks use.
  const mountedRef = useRef(true);
  const locationRequestGenerationRef = useRef(0);
  const serialInputRefs = useRef([]);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Auto-select the queue's candidate ONCE, and only while the picker step is still showing —
  // a restart() deliberately returns to the full candidate list rather than re-looping here.
  const autoChosenRef = useRef(false);
  const initialCandidate =
    initialReorderRequestId && step === RECEIVE_STEP.SELECT_CANDIDATE && !autoChosenRef.current
      ? candidates.find((c) => c.reorderRequestId === initialReorderRequestId) ?? null
      : null;
  useEffect(() => {
    if (!initialCandidate) return;
    autoChosenRef.current = true;
    chooseCandidate(initialCandidate);
  }, [initialCandidate]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chooseCandidate(c) {
    const generation = ++locationRequestGenerationRef.current;
    setCandidate(c);
    setLocationId("");
    setSerials([]);
    serialInputRefs.current = [];
    setStep(RECEIVE_STEP.SELECT_LOCATION);
    setLocations({ status: "loading", options: [] });
    setPartTracking({ status: "loading", trackingMode: null });
    // Fetch the receiving locations AND resolve this part's tracking mode in parallel -- the
    // tracking mode isn't needed until Continue, but reading it now avoids a second spinner.
    const [locationsRes, partsRes] = await Promise.all([fetchReceivingLocationOptions(), fetchPartMasterList()]);
    if (!mountedRef.current || generation !== locationRequestGenerationRef.current) return;
    setLocations({ status: locationsRes.status, options: locationsRes.options ?? [] });
    setPartTracking(resolvePartTrackingMode({ partsFetchResult: partsRes, partId: c.partId }));
  }

  function continueFromLocation() {
    if (partTracking.trackingMode === TRACKING_MODE.SERIAL) {
      setSerials(Array.from({ length: candidate.orderedQuantity }, () => ""));
      setStep(RECEIVE_STEP.SERIALS);
    } else {
      setStep(RECEIVE_STEP.CONFIRM);
    }
  }

  function updateSerial(index, value) {
    setSerials((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function submit() {
    const isSerial = partTracking.trackingMode === TRACKING_MODE.SERIAL;
    const input = buildReceiveRequestInput({
      candidate,
      locationId,
      trackingMode: partTracking.trackingMode,
      serialNumbers: isSerial ? serials : undefined,
    });
    if (!input) return;
    setSubmitting(true);
    const res = await submitReceiveInventoryStock(input);
    if (!mountedRef.current) return;
    setSubmitting(false);
    setResult(res.status);
    setStep(RECEIVE_STEP.RESULT);
  }

  function restart() {
    locationRequestGenerationRef.current += 1;
    setCandidate(null);
    setLocationId("");
    setLocations({ status: "idle", options: [] });
    setPartTracking({ status: "idle", trackingMode: null });
    setSerials([]);
    serialInputRefs.current = [];
    setResult(null);
    setStep(RECEIVE_STEP.SELECT_CANDIDATE);
  }

  // ---- Step: choose a receipt candidate (fail-closed on the governed PO read) ----
  const chooseStep = { n: 1, total: null, name: "Choose the purchase order" };
  if (step === RECEIVE_STEP.SELECT_CANDIDATE) {
    if (view.status === PURCHASE_ORDERS_STATUS.LOADING) return <Frame step={chooseStep}><LoadingState>Loading purchase orders…</LoadingState></Frame>;
    if (view.status === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION || view.status === PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE) {
      const code = view.status === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION ? "permission-denied" : "unavailable";
      return <Frame><FailureState title="Can't load purchase orders" message={loadErrorMessage({ code }, { entity: "purchase orders" })} /></Frame>;
    }
    if (candidates.length === 0) {
      return (
        <Frame>
          <EmptyState
            variant="database"
            title="Nothing to receive"
            message={initialPartId ? "No open purchase order is awaiting receipt for this part." : "No open purchase orders are awaiting receipt."}
          />
        </Frame>
      );
    }
    return (
      <Frame step={chooseStep}>
        <p className="fo-muted">Select the purchase order to receive:</p>
        <ul className="fo-receive-candidates">
          {candidates.map((c) => (
            <li key={c.reorderRequestId}>
              <Button type="button" variant="tertiary" className="fo-receive-candidate" onClick={() => chooseCandidate(c)}>
                <strong>{c.partId}</strong>
                <span className="fo-muted">
                  {/* The governed external PO number, or its stated absence — never the opaque
                      reorderRequestId, and never a synthesized RR-number (RCV-G4: unwired). */}
                  {c.supplierName ? `${c.supplierName} · ` : ""}
                  {c.externalPoNumber ? `PO ${c.externalPoNumber}` : "No PO number recorded"} · qty {c.orderedQuantity}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </Frame>
    );
  }

  // ---- Step: choose a receiving location (fail-closed if receiving isn't activated / permitted,
  // OR if this part's tracking mode couldn't be authoritatively read, OR if it's LOT-tracked) ----
  if (step === RECEIVE_STEP.SELECT_LOCATION) {
    // The step total depends on the part's tracking mode (a SERIAL part adds the serial-capture
    // stage); until that governed read settles, the total is honestly omitted rather than guessed.
    const isSerialKnown = partTracking.status === PART_TRACKING_STATUS.READY;
    const stepTotal = isSerialKnown ? (partTracking.trackingMode === TRACKING_MODE.SERIAL ? 4 : 3) : null;
    const destinationStep = { n: 2, total: stepTotal, name: "Destination" };
    if (locations.status === "loading" || partTracking.status === "loading") {
      return <Frame onBack={restart} candidate={candidate} step={{ n: 2, total: null, name: "Destination" }}><LoadingState>Loading receiving details…</LoadingState></Frame>;
    }
    if (locations.status === "ready" && locations.options.length === 0) {
      // Receiving IS activated but no eligible location came back.
      return <Frame onBack={restart} candidate={candidate}><FailureState title="No receiving location" message="No eligible receiving location is available." /></Frame>;
    }
    if (locations.status !== "ready") {
      // "not activated" (readiness false) or a genuine denied/other -> sanitized honest copy.
      const d = describeReceiveOutcome(locations.status);
      return <Frame onBack={restart} candidate={candidate}><FailureState title={d.title} message={d.message} /></Frame>;
    }
    if (partTracking.status !== PART_TRACKING_STATUS.READY) {
      // The Part read failed or the part wasn't found -- fail closed rather than assume NONE,
      // which would either fail server-side or (worse) receive a serialized part with no identity.
      const d = describePartTrackingBlock(partTracking.status);
      return <Frame onBack={restart} candidate={candidate}><FailureState title={d.title} message={d.message} /></Frame>;
    }
    if (partTracking.trackingMode === TRACKING_MODE.LOT) {
      const d = describeLotNotSupported();
      return <Frame onBack={restart} candidate={candidate}><FailureState title={d.title} message={d.message} /></Frame>;
    }
    return (
      <Frame onBack={restart} candidate={candidate} step={destinationStep}>
        <p className="fo-muted">Receiving <strong>{candidate.partId}</strong> (qty {candidate.orderedQuantity}, full order). Where is it going?</p>
        <label className="scan-field">
          Receiving location
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Select a location</option>
            {locations.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <Button type="button" className="scan-confirm" disabled={!locationId} onClick={continueFromLocation}>
          Continue
        </Button>
        <p className="fo-muted fo-receive-stepnote">
          The part's tracking mode is resolved through the governed Part Master read while you
          choose — a failed or denied read blocks the receipt honestly rather than assuming no
          serial numbers are needed.
        </p>
      </Frame>
    );
  }

  // ---- Step: capture one serial number per unit (SERIAL-tracked parts only) ----
  if (step === RECEIVE_STEP.SERIALS) {
    const issues = describeSerialEntryIssues({ serials, expectedCount: candidate.orderedQuantity });
    return (
      <Frame onBack={() => setStep(RECEIVE_STEP.SELECT_LOCATION)} candidate={candidate} step={{ n: 3, total: 4, name: "Serial numbers" }}>
        <p className="fo-muted">
          Scan or enter all {candidate.orderedQuantity} serial number{candidate.orderedQuantity === 1 ? "" : "s"} for <strong>{candidate.partId}</strong>. One serial is one physical unit.
        </p>
        <ol className="fo-serial-list">
          {serials.map((value, index) => (
            <li key={index}>
              <label className="scan-field">
                {`Serial ${index + 1}`}
                <input
                  ref={(el) => { serialInputRefs.current[index] = el; }}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoFocus={index === 0}
                  value={value}
                  aria-invalid={issues.blankIndexes.includes(index) || issues.duplicateIndexes.includes(index)}
                  onChange={(e) => updateSerial(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const nextField = serialInputRefs.current[index + 1];
                    if (nextField) nextField.focus();
                  }}
                />
              </label>
            </li>
          ))}
        </ol>
        {issues.blankIndexes.length > 0 && (
          <p className="fo-form-error" role="alert">Every serial number is required.</p>
        )}
        {issues.duplicateIndexes.length > 0 && (
          <p className="fo-form-error" role="alert">Duplicate serial numbers aren't allowed — each unit needs its own.</p>
        )}
        <Button type="button" className="scan-confirm" disabled={!issues.ok} onClick={() => setStep(RECEIVE_STEP.CONFIRM)}>
          Continue
        </Button>
      </Frame>
    );
  }

  // ---- Step: confirm the full ordered quantity, then submit ----
  if (step === RECEIVE_STEP.CONFIRM) {
    const location = locations.options.find((o) => o.value === locationId);
    const isSerial = partTracking.trackingMode === TRACKING_MODE.SERIAL;
    return (
      <Frame
        onBack={() => setStep(isSerial ? RECEIVE_STEP.SERIALS : RECEIVE_STEP.SELECT_LOCATION)}
        candidate={candidate}
        step={{ n: isSerial ? 4 : 3, total: isSerial ? 4 : 3, name: "Confirm" }}
      >
        {/* The read-back is exactly the facts the governed command will receive — REVIEW performs
            no write; only the Confirm press below reaches the existing submit path. */}
        <dl className="fo-receive-confirm">
          <div><dt>Part</dt><dd>{candidate.partId}</dd></div>
          {/* The governed external PO number or its STATED absence — the opaque reorderRequestId
              is command input, never a displayed fact (RCV-G4: RR numbering is unwired). */}
          <div><dt>Purchase order</dt><dd>{candidate.externalPoNumber ?? <span className="fo-muted">No PO number recorded</span>}</dd></div>
          {candidate.supplierName && <div><dt>Supplier</dt><dd>{candidate.supplierName}</dd></div>}
          <div><dt>Quantity to receive</dt><dd>{candidate.orderedQuantity} (full order)</dd></div>
          <div><dt>Receiving location</dt><dd>{location?.label ?? locationId}</dd></div>
          {isSerial && (
            <div><dt>Serial numbers</dt><dd>{serials.map((s) => s.trim()).join(", ")}</dd></div>
          )}
        </dl>
        <p className="fo-muted">Receiving records the full ordered quantity. This is a governed transaction.</p>
        <Button type="button" className="scan-confirm" loading={submitting} onClick={submit}>
          Confirm receipt
        </Button>
        <p className="fo-muted fo-receive-stepnote">
          A retry rebuilds the identical request — a double press yields “Already received”, never
          duplicate stock.
        </p>
      </Frame>
    );
  }

  // ---- Step: governed outcome ----
  const outcome = describeReceiveOutcome(result);
  return (
    <Frame candidate={candidate}>
      <div className={`fo-receive-result fo-receive-result--${outcome.tone}`} role="status">
        <strong>{outcome.title}</strong>
        <p>{outcome.message}</p>
        {/* RCV-G1/G2 — the response carries no receiving order number and no governed read exposes
            one, so its absence is stated; no internal id is ever printed in its place. */}
        {outcome.terminal && (
          <p className="fo-muted">The receiving order number is not yet readable here.</p>
        )}
      </div>
      <div className="fo-receive-actions">
        {!outcome.terminal && !isReceivingUnavailable(result) && (
          <Button type="button" variant="secondary" onClick={restart}>Try again</Button>
        )}
        <Button type="button" className="scan-confirm" onClick={() => onDone?.()}>Done</Button>
      </div>
    </Frame>
  );
}

// North Star frame 1d — ONE subordinate journey identity inside the Receiving workspace (no page
// H1, no nested shell, no card border). The title is a governed human identity, in preference
// order: the external PO number (this record's governed nameField) → the supplier name → the
// truthful generic. The opaque reorderRequestId is never a candidate — it travels only inside the
// command input. RR numbering is declared but UNWIRED (RCV-G4), so no RR-#### may be synthesized
// in the number's place; its absence is STATED on the facts line instead. The step line is
// presentation over the existing RECEIVE_STEP machine — it labels the stage, it never drives it.
function Frame({ children, onBack, step = null, candidate = null }) {
  const title = candidate
    ? candidate.externalPoNumber ?? candidate.supplierName ?? "Reorder purchase order"
    : "Reorder purchase order";
  return (
    <section className="fo-receiving-session fo-reorder-journey" aria-label="Receive a reorder purchase order">
      <header className="fo-receiving-session__identity">
        <p className="fo-receiving-session__kicker">Reorder purchase order · full-quantity receipt</p>
        <div className="fo-receive-header">
          <h2 className="fo-receiving-session__title">{title}</h2>
          {onBack && <Button type="button" variant="tertiary" className="fo-receive-back" onClick={onBack}>← Back</Button>}
        </div>
        {candidate && (
          <p className="fo-muted">
            {candidate.partId} · qty {candidate.orderedQuantity} (full order)
            {candidate.externalPoNumber == null ? " · No PO number recorded" : ""}
            {candidate.externalPoNumber != null && candidate.supplierName ? ` · ${candidate.supplierName}` : ""}
          </p>
        )}
      </header>
      {step && (
        <p className="fo-receiving-session__step">
          Step {step.n}
          {step.total ? ` of ${step.total}` : ""} · {step.name}
        </p>
      )}
      {children}
    </section>
  );
}

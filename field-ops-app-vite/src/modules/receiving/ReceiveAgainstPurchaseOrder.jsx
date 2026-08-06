import { useEffect, useMemo, useRef, useState } from "react";
import { useReorderRequestsByStatuses } from "../../hooks/useReorderRequests";
import { usePurchaseOrdersByIds } from "../../hooks/usePurchaseOrdersByIds";
import { buildPurchaseOrdersView, PURCHASE_ORDERS_STATUS } from "../../domain/purchaseOrdersView";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { fetchReceivingLocationOptions, submitReceiveInventoryStock } from "../../services/receivingCallableClient";
import {
  buildReceiveRequestInput,
  describeReceiveOutcome,
  isReceivingUnavailable,
  RECEIVE_STEP,
} from "../../domain/receiveAgainstPurchaseOrder";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

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
const ORDERED_ONLY = [REORDER_REQUEST_STATUS.ORDERED];

export default function ReceiveAgainstPurchaseOrder({ initialPartId = null, onDone }) {
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
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Guard the two async handlers against setState after unmount (the technician can switch the
  // scanner action mid-flight) -- the same cancelled-flag discipline the repo's async hooks use.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function chooseCandidate(c) {
    setCandidate(c);
    setLocationId("");
    setStep(RECEIVE_STEP.SELECT_LOCATION);
    setLocations({ status: "loading", options: [] });
    const res = await fetchReceivingLocationOptions();
    if (mountedRef.current) setLocations({ status: res.status, options: res.options ?? [] });
  }

  async function submit() {
    const input = buildReceiveRequestInput({ candidate, locationId });
    if (!input) return;
    setSubmitting(true);
    const res = await submitReceiveInventoryStock(input);
    if (!mountedRef.current) return;
    setSubmitting(false);
    setResult(res.status);
    setStep(RECEIVE_STEP.RESULT);
  }

  function restart() {
    setCandidate(null);
    setLocationId("");
    setLocations({ status: "idle", options: [] });
    setResult(null);
    setStep(RECEIVE_STEP.SELECT_CANDIDATE);
  }

  // ---- Step: choose a receipt candidate (fail-closed on the governed PO read) ----
  if (step === RECEIVE_STEP.SELECT_CANDIDATE) {
    if (view.status === PURCHASE_ORDERS_STATUS.LOADING) return <Frame><LoadingState>Loading purchase orders…</LoadingState></Frame>;
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
      <Frame>
        <p className="fo-muted">Select the purchase order to receive:</p>
        <ul className="fo-receive-candidates">
          {candidates.map((c) => (
            <li key={c.reorderRequestId}>
              <button type="button" className="fo-receive-candidate" onClick={() => chooseCandidate(c)}>
                <strong>{c.partId}</strong>
                <span className="fo-muted">
                  {c.supplierName ? `${c.supplierName} · ` : ""}PO {c.externalPoNumber ?? c.reorderRequestId} · qty {c.orderedQuantity}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Frame>
    );
  }

  // ---- Step: choose a receiving location (fail-closed if receiving isn't activated / permitted) ----
  if (step === RECEIVE_STEP.SELECT_LOCATION) {
    if (locations.status === "loading") return <Frame onBack={restart}><LoadingState>Loading receiving locations…</LoadingState></Frame>;
    if (locations.status === "ready" && locations.options.length === 0) {
      // Receiving IS activated but no eligible location came back.
      return <Frame onBack={restart}><FailureState title="No receiving location" message="No eligible receiving location is available." /></Frame>;
    }
    if (locations.status !== "ready") {
      // "not activated" (readiness false) or a genuine denied/other -> sanitized honest copy.
      const d = describeReceiveOutcome(locations.status);
      return <Frame onBack={restart}><FailureState title={d.title} message={d.message} /></Frame>;
    }
    return (
      <Frame onBack={restart}>
        <p className="fo-muted">Receiving <strong>{candidate.partId}</strong> (qty {candidate.orderedQuantity}). Where is it going?</p>
        <label className="scan-field">
          Receiving location
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Select a location</option>
            {locations.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="scan-confirm" disabled={!locationId} onClick={() => setStep(RECEIVE_STEP.CONFIRM)}>
          Continue
        </button>
      </Frame>
    );
  }

  // ---- Step: confirm the full ordered quantity, then submit ----
  if (step === RECEIVE_STEP.CONFIRM) {
    const location = locations.options.find((o) => o.value === locationId);
    return (
      <Frame onBack={() => setStep(RECEIVE_STEP.SELECT_LOCATION)}>
        <dl className="fo-receive-confirm">
          <div><dt>Part</dt><dd>{candidate.partId}</dd></div>
          <div><dt>Purchase order</dt><dd>{candidate.externalPoNumber ?? candidate.reorderRequestId}</dd></div>
          <div><dt>Quantity to receive</dt><dd>{candidate.orderedQuantity} (full order)</dd></div>
          <div><dt>Receiving location</dt><dd>{location?.label ?? locationId}</dd></div>
        </dl>
        <p className="fo-muted">Receiving records the full ordered quantity. This is a governed transaction.</p>
        <button type="button" className="scan-confirm" disabled={submitting} onClick={submit}>
          {submitting ? "Receiving…" : "Confirm receipt"}
        </button>
      </Frame>
    );
  }

  // ---- Step: governed outcome ----
  const outcome = describeReceiveOutcome(result);
  return (
    <Frame>
      <div className={`fo-receive-result fo-receive-result--${outcome.tone}`} role="status">
        <strong>{outcome.title}</strong>
        <p>{outcome.message}</p>
      </div>
      <div className="fo-receive-actions">
        {!outcome.terminal && !isReceivingUnavailable(result) && (
          <button type="button" onClick={restart}>Try again</button>
        )}
        <button type="button" className="scan-confirm" onClick={() => onDone?.()}>Done</button>
      </div>
    </Frame>
  );
}

function Frame({ children, onBack }) {
  return (
    <section className="fo-receive-po" aria-label="Receive against a purchase order">
      <div className="fo-receive-header">
        <h3>Receive a purchase order</h3>
        {onBack && <button type="button" className="fo-receive-back" onClick={onBack}>← Back</button>}
      </div>
      {children}
    </section>
  );
}

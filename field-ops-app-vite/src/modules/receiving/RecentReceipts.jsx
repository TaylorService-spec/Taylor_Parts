import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";
import { fetchReceipts, fetchReceivingLocationOptions } from "../../services/partsOperationsReads.js";
import { fetchAcquireWarehouseOptions } from "../../services/inventoryLocationClient.js";
import { correctReceipt, correctionKindsFor, CORRECTION_KIND } from "../../services/receiptCorrectionClient.js";
import { SESSION_GATE_KEYS, sessionDecision, useSessionAccess } from "../../access/sessionAccess.js";

// Inventory > Receiving > RECENT RECEIPTS (Firebase exit B3-x; DECISIONS #B3-x).
//
// The history of what was received -- Reorder AND supplier purchase orders -- read back from the one receipt representation
// (listReceipts: eos_ops.receiving_orders), scoped by the server to the caller's warehouses and, for a supplier-PO receipt, companies. It
// replaces the "Not connected yet" slot: the read existed on the server and had no screen.
//
//   * A row is labelled by the receiving ORDER NUMBER (RO-...) and the order's own number -- never an internal id. A receipt recorded
//     before numbering shows the stated absence.
//   * A VOIDED receipt stays in the list, struck from the derivation but never hidden: history is evidence.
//   * "Correct" is offered only to a holder of inventory.receipt.correct (granted to nobody by default; an Administrator grants it), and the
//     server re-decides everything. It is the correction of a RECORDING mistake -- not a vendor return and not a stock adjustment.
//   * The correction states WHY (required), is sent under ONE idempotency key per opened correction (a retry cannot apply it twice), and
//     answers in the server's own words.

const JOURNEY_WORDS = Object.freeze({ PURCHASE_ORDER: "Supplier PO", REORDER_PURCHASE_ORDER: "Reorder PO" });
const LIST_LIMIT = 25;

function newKey() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `rcvfix-${uuid}`.slice(0, 150);
}

const statusWords = (r) => (r.status === "CANCELLED" ? (r.corrected ? "Voided (corrected)" : "Cancelled") : "Recorded");

export default function RecentReceipts({ deps = null }) {
  const read = deps?.fetchReceipts ?? fetchReceipts;
  const readWarehouses = deps?.fetchWarehouseLabels ?? fetchAcquireWarehouseOptions;
  const access = useSessionAccess();
  const canCorrect = deps?.canCorrect ?? sessionDecision(access, SESSION_GATE_KEYS.receiptCorrect, false);

  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState({ state: "LOADING", items: [] });
  const [labels, setLabels] = useState({});
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setList((l) => ({ ...l, state: "LOADING" }));
    Promise.resolve()
      .then(() => read({ limit: LIST_LIMIT }))
      .then((res) => { if (!cancelled) setList({ state: "READY", items: Array.isArray(res?.items) ? res.items : [] }); })
      .catch((err) => { if (!cancelled) setList({ state: err?.code === "FORBIDDEN" ? "DENIED" : "FAILED", items: [] }); });
    return () => { cancelled = true; };
  }, [read, attempt]);

  // Warehouse NAMES are enrichment: an id that will not resolve stays an id, and a failed lookup never blocks the list.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => readWarehouses()).then((res) => {
      if (cancelled || res?.status !== "ready") return;
      setLabels(Object.fromEntries((res.options ?? []).map((o) => [o.value, o.label])));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [readWarehouses]);

  return (
    <div>
      {list.state === "LOADING" && <LoadingState>Loading recent receipts…</LoadingState>}
      {list.state === "DENIED" && <FailureState title="Not authorized" message="You are not authorized to read receipts." />}
      {list.state === "FAILED" && (
        <FailureState title="Receipts could not be loaded"
          message="The receipt history could not be read. This is not a statement that nothing was received." />
      )}
      {list.state === "READY" && list.items.length === 0 && (
        <EmptyState variant="database" title="No receipts to show" message="No receipts were found in your warehouses and companies." />
      )}
      {list.state === "READY" && list.items.length > 0 && (
        <div className="fo-table-scroll">
          <table className="fo-table fo-receiving-queue" aria-label="Recent receipts">
            <thead>
              <tr>
                <th scope="col">Receipt</th>
                <th scope="col">Journey</th>
                <th scope="col">Order</th>
                <th scope="col">Received</th>
                <th scope="col">Into</th>
                <th scope="col" className="fo-receiving-queue__num">Lines · Units</th>
                <th scope="col">Status</th>
                <th scope="col" className="fo-receiving-queue__action-col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <tr key={r.receiptId}>
                  <td data-label="Receipt">{r.receivingOrderNumber ? <strong>{r.receivingOrderNumber}</strong> : <span className="fo-muted">No receipt number recorded</span>}</td>
                  <td data-label="Journey">{JOURNEY_WORDS[r.sourceKind] ?? "Receipt"}</td>
                  <td data-label="Order">{r.orderNumber ? r.orderNumber : <span className="fo-muted">No order number recorded</span>}</td>
                  <td data-label="Received">{r.receivedAt ? new Date(r.receivedAt).toLocaleString() : <span className="fo-muted">Not recorded</span>}</td>
                  <td data-label="Into">{labels[r.warehouseId] ?? r.warehouseId ?? <span className="fo-muted">Unknown</span>}</td>
                  <td data-label="Lines · Units" className="fo-receiving-queue__num">{r.lineCount} · {r.totalQuantity}</td>
                  <td data-label="Status">{statusWords(r)}</td>
                  <td data-label="Action" className="fo-receiving-queue__action-col">
                    {canCorrect && r.status !== "CANCELLED" && correctionKindsFor(r.sourceKind).length > 0 ? (
                      <Button type="button" variant="tertiary" onClick={() => setOpen(r)} aria-label={`Correct receipt ${r.receivingOrderNumber ?? ""}`.trim()}>
                        Correct…
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fo-receiving-queue__note fo-muted">
        <button type="button" className="fo-link-btn" onClick={() => setAttempt((n) => n + 1)}>Refresh receipts</button>
        {" · "}Shows the {LIST_LIMIT} most recent receipts in your warehouses
        {canCorrect ? "" : "; correcting a receipt needs the receipt-correction permission"}.
      </p>
      {open ? (
        <ReceiptCorrection
          key={open.receiptId}
          receipt={open}
          deps={deps}
          onClose={() => setOpen(null)}
          onCorrected={() => { setOpen(null); setAttempt((n) => n + 1); }}
        />
      ) : null}
    </div>
  );
}

function ReceiptCorrection({ receipt, deps, onClose, onCorrected }) {
  const send = deps?.correctReceipt ?? correctReceipt;
  const readLocations = deps?.fetchCorrectionLocations ?? fetchReceivingLocationOptions;
  const kinds = correctionKindsFor(receipt.sourceKind);
  const [kind, setKind] = useState(CORRECTION_KIND.VOID);
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState({ state: "IDLE", options: [] });
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  // ONE key per opened correction: a double press or a retry after a dropped answer is the same request, never a second correction.
  const keyRef = useRef(newKey());

  // The destinations are read ONCE, the first time CORRECTED is chosen (a mounted flag, not a per-effect cancel: toggling back to VOID mid-read
  // must not drop the answer).
  const mountedRef = useRef(true);
  const askedRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => {
    if (kind !== CORRECTION_KIND.CORRECTED || askedRef.current) return;
    askedRef.current = true;
    setLocations({ state: "LOADING", options: [] });
    Promise.resolve().then(() => readLocations(receipt.reorderRequestId))
      .then((res) => { if (mountedRef.current) setLocations({ state: "READY", options: Array.isArray(res?.options) ? res.options : [] }); })
      .catch((err) => { if (mountedRef.current) setLocations({ state: err?.code === "FORBIDDEN" ? "DENIED" : "FAILED", options: [] }); });
  }, [kind, readLocations, receipt.reorderRequestId]);

  const chosen = useMemo(() => locations.options.find((o) => o.locationId === locationId) ?? null, [locations.options, locationId]);
  const reasonOk = reason.trim() !== "" && reason.length <= 500;
  const canSend = reasonOk && !submitting && (kind === CORRECTION_KIND.VOID || chosen !== null);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setOutcome(null);
    const res = await send({
      sourceKind: receipt.sourceKind, receivingId: receipt.receiptId, kind, reason, idempotencyKey: keyRef.current,
      replacementLocation: kind === CORRECTION_KIND.CORRECTED && chosen ? { type: chosen.type, locationId: chosen.locationId } : null,
    });
    setSubmitting(false);
    setOutcome(res);
    if (res.ok) onCorrected?.();
  }, [send, receipt, kind, reason, chosen, onCorrected]);

  const title = receipt.receivingOrderNumber ?? "this receipt";
  return (
    <section className="fo-panel" aria-label="Correct a receipt">
      <h3>Correct {title}</h3>
      <p className="fo-muted">
        Use this when the receipt was <strong>recorded wrong</strong>. It is not a vendor return and not a stock count: the receipt is cancelled
        (never deleted), the stock it added is taken back out, and its cost consequence is reversed.
        {receipt.sourceKind === "PURCHASE_ORDER"
          ? " To record the right quantity, receive the order again afterwards: it counts only what is still outstanding."
          : ""}
      </p>
      {kinds.length > 1 && (
        <fieldset>
          <legend>What happened</legend>
          <label><input type="radio" name="rcv-kind" checked={kind === CORRECTION_KIND.VOID} onChange={() => setKind(CORRECTION_KIND.VOID)} /> It did not happen as recorded (void it)</label>
          <label><input type="radio" name="rcv-kind" checked={kind === CORRECTION_KIND.CORRECTED} onChange={() => setKind(CORRECTION_KIND.CORRECTED)} /> It went to the wrong place (void it and receive it again elsewhere)</label>
        </fieldset>
      )}
      {kind === CORRECTION_KIND.CORRECTED && (
        <div>
          {locations.state === "LOADING" && <p className="fo-muted">Loading receiving locations…</p>}
          {(locations.state === "DENIED" || locations.state === "FAILED") && (
            <p className="fo-warning" role="status">The receiving locations could not be read, so this cannot be re-received elsewhere right now.</p>
          )}
          {locations.state === "READY" && (
            <label className="scan-field">
              Receive it again into
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose a destination…</option>
                {locations.options.map((o) => <option key={o.locationId} value={o.locationId}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <label className="scan-field">
        Why (required)
        <textarea className="fo-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {outcome && !outcome.ok && <p className="fo-inline-error" role="alert">{outcome.message} Nothing was changed.</p>}
      <div className="fo-receive-actions">
        <Button type="button" variant="primary" loading={submitting} disabled={!canSend} onClick={submit}>
          {kind === CORRECTION_KIND.VOID ? "Void this receipt" : "Void and receive again"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </section>
  );
}

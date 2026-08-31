import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { RECEIVING_OUTCOME } from "../../domain/receivingTransport.js";
import { useWarehouseSubmit, WAREHOUSE_SUBMIT, PENDING_TEXT, NOT_DURABLE_TEXT } from "../../offline/useWarehouseSubmit.js";
import { captureReceive } from "../../offline/warehouseIntent.js";
import {
  createQueue, addScan, undoLastScan, removeEntry, setEntryQuantity, clearQueue,
  reconcile, buildSubmissionLines, ENTRY_STATE, ENTRY_STATE_REASON,
} from "../../domain/receivingScanQueue.js";
import {
  fetchReceivablePurchaseOrders,
  fetchPurchaseOrderProgress,
  fetchReceivingLocationOptions,
  submitCanonicalReceive,
} from "../../services/receivingCallableClient.js";

// MULTI-SCAN RECEIVING — the canonical warehouse journey.
//
//   pick a purchase order -> see its ordered lines and what remains -> scan continuously ->
//   reconcile expected against observed -> correct -> submit ONE governed receipt -> per-line result
//
// WHAT THIS SCREEN DOES NOT DO. It never decides what may be received. Every quantity it shows comes
// from the server's derivation, every rule it applies is a MIRROR of one the governed command
// enforces, and the command re-validates the whole batch inside its own transaction. The mirror
// exists so an operator is told before a round trip, not so the client can decide.
//
// SCANNING NEVER MOVES INVENTORY. A scan adds an observation to a local queue. Nothing leaves the
// browser until Submit, and submission is one atomic receipt against one purchase order.
//
// NOT HERE, DELIBERATELY: put-away, bins, transfers, returns, close-short, amendments. A line with
// remaining quantity stays open and a partially received order stays SENT — there is no control on
// this screen that could close one short, because no governed command exists to do it.
//
// The legacy reorder-PO workflow is untouched and lives beside this one (modules/inventory/
// Receiving.jsx composes both); this is not a replacement for it.

const FIELD_STATE = Object.freeze({ IDLE: "IDLE", LOADING: "LOADING", READY: "READY", UNAVAILABLE: "UNAVAILABLE", DENIED: "DENIED", FAILED: "FAILED" });

function statusToState(status) {
  if (status === RECEIVING_OUTCOME.READY) return FIELD_STATE.READY;
  if (status === RECEIVING_OUTCOME.DENIED) return FIELD_STATE.DENIED;
  if (status === RECEIVING_OUTCOME.UNAVAILABLE) return FIELD_STATE.UNAVAILABLE;
  return FIELD_STATE.FAILED;
}

function newIdempotencyKey() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `rcv-${uuid}`.slice(0, 200);
}

// ─────────────────────────────────────────────────────────── order picker

function OrderPicker({ deps, onPick }) {
  const [state, setState] = useState(FIELD_STATE.LOADING);
  const [orders, setOrders] = useState([]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await (deps?.fetchReceivablePurchaseOrders ?? fetchReceivablePurchaseOrders)();
      if (!live) return;
      setOrders(res.purchaseOrders ?? []);
      setState(statusToState(res.status));
    })();
    return () => { live = false; };
  }, [deps]);

  return (
    <section className="fo-panel" aria-label="Choose a purchase order">
      <h3>Scan or choose a purchase order</h3>
      <form
        className="fo-scanline"
        onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onPick(typed.trim()); }}
      >
        <label htmlFor="po-scan">Purchase order</label>
        <input
          id="po-scan"
          className="fo-input"
          type="text"
          autoComplete="off"
          value={typed}
          placeholder="Scan the order, or type its id"
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!typed.trim()}>Open</Button>
      </form>

      {state === FIELD_STATE.LOADING && <p className="fo-muted">Loading orders awaiting receipt…</p>}
      {/* UNAVAILABLE is not "no orders". Saying "none" here would assert something about the data
          that the screen has not read. */}
      {state === FIELD_STATE.UNAVAILABLE && (
        <p className="fo-warning" role="status">
          Receiving is built but not switched on in this environment, so the list of orders awaiting
          receipt cannot be read. This is not an empty list — it is an unread one.
        </p>
      )}
      {state === FIELD_STATE.DENIED && (
        <p className="fo-warning" role="status">You are not authorized to receive stock.</p>
      )}
      {state === FIELD_STATE.FAILED && (
        <p className="fo-inline-error" role="alert">The list of orders could not be loaded.</p>
      )}
      {state === FIELD_STATE.READY && orders.length === 0 && (
        <p className="fo-muted">No purchase orders are awaiting receipt.</p>
      )}
      {state === FIELD_STATE.READY && orders.length > 0 && (
        <ul className="fo-list">
          {orders.map((o) => (
            <li key={o.purchaseOrderId}>
              <button type="button" className="fo-link-btn" onClick={() => onPick(o.purchaseOrderId)}>
                {o.purchaseOrderId}
              </button>{" "}
              <span className="fo-muted">
                {o.storedStatus} · {o.lineCount} line{o.lineCount === 1 ? "" : "s"}
                {o.supplierId ? ` · ${o.supplierId}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────── reconciliation table

function ReconciliationTable({ lines }) {
  return (
    <div className="fo-table-scroll">
      <table className="fo-table" aria-label="Expected versus observed">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Part</th>
            <th scope="col">Ordered</th>
            <th scope="col">Already received</th>
            <th scope="col">Outstanding</th>
            <th scope="col">Scanned now</th>
            <th scope="col">Remaining after</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.lineId} className={l.observedNow > 0 ? "is-observed" : undefined}>
              <td>{l.lineId}</td>
              <td>
                {l.partId}
                {l.trackingMode === "SERIAL" && <span className="fo-muted"> · serialized</span>}
                {/* An unresolvable Part is stated, never defaulted to "no serial needed" -- the
                    receipt would be refused for a reason the screen had contradicted. */}
                {l.trackingMode === "UNKNOWN" && (
                  <span className="fo-warning" title="This part could not be resolved, so its serial requirement is unknown"> · unknown part</span>
                )}
              </td>
              <td>{l.orderedQuantity}</td>
              <td>{l.previouslyReceived}</td>
              <td>{l.remainingBefore}</td>
              <td><strong>{l.observedNow}</strong></td>
              <td>{l.remainingAfter}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── the scanning session

function ScanSession({ purchaseOrderId, deps, onDone }) {
  const [progressState, setProgressState] = useState(FIELD_STATE.LOADING);
  const [progress, setProgress] = useState(null);
  const [queue, setQueue] = useState(createQueue);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [typedScan, setTypedScan] = useState("");
  const [typedSerial, setTypedSerial] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Set when the receipt is held on this phone. NOT a receipt, and never rendered as one. */
  const [queuedNotice, setQueuedNotice] = useState(null);
  // ONE submit policy, shared with every other warehouse screen.
  const warehouse = useWarehouseSubmit({ offline: deps?.offline });
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);
  const scanRef = useRef(null);
  // Generated ONCE per submission intent and reused across a retry of that intent, so a
  // double-click or a reconnect cannot apply the same receipt twice.
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  const api = {
    fetchPurchaseOrderProgress: deps?.fetchPurchaseOrderProgress ?? fetchPurchaseOrderProgress,
    fetchReceivingLocationOptions: deps?.fetchReceivingLocationOptions ?? fetchReceivingLocationOptions,
    submitCanonicalReceive: deps?.submitCanonicalReceive ?? submitCanonicalReceive,
  };

  const loadProgress = useCallback(async () => {
    setProgressState(FIELD_STATE.LOADING);
    const res = await api.fetchPurchaseOrderProgress(purchaseOrderId);
    setProgress(res.progress);
    setProgressState(statusToState(res.status));
  }, [purchaseOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadProgress(); }, [loadProgress]);
  useEffect(() => {
    let live = true;
    (async () => {
      const res = await api.fetchReceivingLocationOptions();
      if (live) setLocations(res.options ?? []);
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reconciliation = useMemo(
    () => reconcile(queue, progress?.lines ?? []),
    [queue, progress],
  );

  const submitScan = (e) => {
    e.preventDefault();
    const partId = typedScan.trim();
    if (!partId) return;
    setQueue((q) => addScan(q, { partId, serialNo: typedSerial.trim() || null }));
    setTypedScan("");
    setTypedSerial("");
    // CONTINUOUS INPUT FOCUS. A hardware scanner behaves as a keyboard, so the field must be ready
    // for the next box without the operator touching anything.
    scanRef.current?.focus();
  };

  const submit = async () => {
    setError(null);
    const lines = buildSubmissionLines(reconciliation);
    if (lines === null || !locationId) return;
    const request = {
      source: { type: "PURCHASE_ORDER", purchaseOrderId },
      receivingLocation: { type: "WAREHOUSE", locationId },
      lines: lines.map((l) => ({ ...l })),
      idempotencyKey: idempotencyKeyRef.current,
      // Optimistic concurrency against the order the operator actually looked at. If someone else
      // received against it meanwhile, this is refused rather than applied against state the
      // operator never saw.
      expectedVersion: progress.version,
    };
    setSubmitting(true);
    try {
      const outcome = await warehouse.submit(
        async () => {
          const res = await api.submitCanonicalReceive(request);
          if (res.status === RECEIVING_OUTCOME.APPLIED || res.status === RECEIVING_OUTCOME.REPLAYED) {
            return { ok: true, serverIds: { receipt: res.receipt } };
          }
          // A transport that is not ready never reached anybody to be refused BY, so it stays
          // retryable and becomes queued work rather than an error the operator cannot act on.
          return res.status === RECEIVING_OUTCOME.UNAVAILABLE
            ? { ok: false, error: { code: "unavailable" } }
            : { ok: false, error: { code: "failed-precondition", details: res.status } };
        },
        // SERIALS INDIVIDUALLY. One serial is one physical unit; collapsing them into a count would
        // lose the identities the server needs to refuse a duplicate.
        (wasOffline) => captureReceive({
          principalUid: deps?.offline?.principalUid ?? "self",
          sourceId: purchaseOrderId,
          partId: lines[0]?.partId ?? lines[0]?.sku ?? null,
          quantity: lines.reduce((n, l) => n + (typeof l.quantity === "number" ? l.quantity : 0), 0) || null,
          serialNumbers: lines.flatMap((l) => (Array.isArray(l.serialNumbers) ? l.serialNumbers : [])),
          destinationId: locationId,
          captureKey: idempotencyKeyRef.current,
          at: Date.now(),
          offline: wasOffline,
        }),
      );

      if (outcome?.result === WAREHOUSE_SUBMIT.SENT) {
        setReceipt(outcome.serverIds?.receipt ?? null);
        setQueue(createQueue());
        // The intent is finished; a NEW receipt is a new intent and needs its own key.
        idempotencyKeyRef.current = newIdempotencyKey();
        await loadProgress();
      } else if (outcome?.result === WAREHOUSE_SUBMIT.QUEUED) {
        // NOTHING HAS BEEN RECEIVED. The queue holds an observation; the platform's remaining
        // quantity is untouched and will be re-derived at sync.
        setQueuedNotice(PENDING_TEXT.INVENTORY_RECEIVE);
        setQueue(createQueue());
        idempotencyKeyRef.current = newIdempotencyKey();
      } else if (outcome?.result === WAREHOUSE_SUBMIT.QUEUED_NOT_DURABLE) {
        // The scans STAY on screen -- this is the only copy that exists.
        setError(NOT_DURABLE_TEXT);
      } else {
        setError(outcome?.error?.details ?? outcome?.error?.code ?? "internal");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (progressState === FIELD_STATE.LOADING) return <p className="fo-muted">Loading {purchaseOrderId}…</p>;
  if (progressState === FIELD_STATE.UNAVAILABLE) {
    return (
      <p className="fo-warning" role="status">
        Receiving is built but not switched on in this environment, so this order cannot be read.
      </p>
    );
  }
  if (progressState === FIELD_STATE.DENIED) {
    return <p className="fo-warning" role="status">You are not authorized to receive stock.</p>;
  }
  if (progressState === FIELD_STATE.FAILED || progress === null) {
    return (
      <p className="fo-inline-error" role="alert">
        {purchaseOrderId} could not be loaded.{" "}
        <button type="button" className="fo-link-btn" onClick={loadProgress}>Retry</button>
      </p>
    );
  }

  const blocked = reconciliation.blocked;
  const canSubmit = reconciliation.submittable && !!locationId && !submitting;

  return (
    <>
      <section className="fo-panel" aria-label="Purchase order">
        <h3>{progress.purchaseOrderId}</h3>
        <p className="fo-muted">
          {/* DERIVED progress and STORED lifecycle are different facts and are shown as two. */}
          Receipt progress: <strong>{progress.derivedState.replace(/_/g, " ").toLowerCase()}</strong>
          {progress.storedStatus ? <> · order status {progress.storedStatus}</> : null}
          {progress.supplierName ? <> · {progress.supplierName}</> : null}
        </p>
        {!progress.receivable && (
          <p className="fo-warning" role="status">
            This order is not in a state that accepts a receipt.
          </p>
        )}
      </section>

      {/* HELD, NOT RECEIVED. Deliberately rendered ABOVE the receipt block and never inside it: the
          word "Received" belongs only to a receipt the platform actually returned. */}
      {queuedNotice && (
        <p className="fo-scan__notice fo-scan__notice--pending" role="status">{queuedNotice}</p>
      )}

      {receipt && (
        <section className="fo-panel fo-receipt" aria-label="Receipt" role="status">
          <h3>{receipt.outcome === "replayed" ? "Already recorded" : "Received"}</h3>
          <p className="fo-muted">Receipt {receipt.receivingId}</p>
          <ul className="fo-list">
            {receipt.lines.map((l) => (
              <li key={l.lineId}>
                {l.lineId} · {l.partId} — received {l.receivedNow}, {l.remainingQuantity} still outstanding
                {" "}({l.state.replace(/_/g, " ").toLowerCase()})
              </li>
            ))}
          </ul>
          <p className="fo-muted">
            Order is now <strong>{receipt.derivedState.replace(/_/g, " ").toLowerCase()}</strong>
            {receipt.storedStatus ? <> · status {receipt.storedStatus}</> : null}.
          </p>
          <Button type="button" variant="secondary" onClick={onDone}>Receive another order</Button>
        </section>
      )}

      <section className="fo-panel" aria-label="Scan">
        <h3>Scan</h3>
        <form className="fo-scanline" onSubmit={submitScan}>
          <label htmlFor="part-scan">Part</label>
          <input
            id="part-scan"
            ref={scanRef}
            className="fo-input"
            type="text"
            autoComplete="off"
            value={typedScan}
            placeholder="Scan a part"
            onChange={(e) => setTypedScan(e.target.value)}
          />
          <label htmlFor="serial-scan">Serial</label>
          <input
            id="serial-scan"
            className="fo-input"
            type="text"
            autoComplete="off"
            value={typedSerial}
            placeholder="Serial (serialized parts only)"
            onChange={(e) => setTypedSerial(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!typedScan.trim()}>Add</Button>
        </form>
        <p className="fo-muted">
          {reconciliation.scanCount} scan{reconciliation.scanCount === 1 ? "" : "s"} ·{" "}
          {reconciliation.totalQuantity} unit{reconciliation.totalQuantity === 1 ? "" : "s"} queued.
          Scanning records what you saw; nothing moves until you submit.
        </p>
        <div className="fo-chip-row">
          <Button type="button" variant="secondary" disabled={reconciliation.scanCount === 0} onClick={() => setQueue(undoLastScan)}>
            Undo last scan
          </Button>
          <Button type="button" variant="tertiary" disabled={reconciliation.scanCount === 0} onClick={() => setQueue(clearQueue)}>
            Clear queue
          </Button>
        </div>
      </section>

      <section className="fo-panel" aria-label="Expected versus observed">
        <h3>Expected versus observed</h3>
        <ReconciliationTable lines={reconciliation.lines} />
        {reconciliation.ambiguousParts.length > 0 && (
          <p className="fo-warning" role="status">
            {reconciliation.ambiguousParts.join(", ")} appears on more than one line. Scans are counted
            against the first, which may not be the line you mean — check before submitting.
          </p>
        )}
      </section>

      {blocked.length > 0 && (
        <section className="fo-panel" aria-label="Blocked scans">
          <h3>Needs attention ({blocked.length})</h3>
          <p className="fo-muted">
            A blocked scan is never silently dropped and never silently included. Resolve each one —
            remove it, or correct it — before this receipt can be submitted.
          </p>
          <ul className="fo-list">
            {blocked.map((e) => (
              <li key={e.entryId}>
                <strong>{e.partId}</strong>
                {e.serialNo ? ` · ${e.serialNo}` : ""} — {ENTRY_STATE_REASON[e.state]}{" "}
                <button type="button" className="fo-link-btn" onClick={() => setQueue((q) => removeEntry(q, e.entryId))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="fo-panel" aria-label="Queued scans">
        <h3>Queued scans</h3>
        {reconciliation.entries.length === 0 ? (
          <p className="fo-muted">Nothing scanned yet.</p>
        ) : (
          <ul className="fo-list">
            {reconciliation.entries.map((e) => (
              <li key={e.entryId} className={e.state === ENTRY_STATE.VALID ? undefined : "is-blocked"}>
                {e.partId}
                {e.serialNo ? <> · <code>{e.serialNo}</code></> : <> × {e.quantity}</>}
                {e.state !== ENTRY_STATE.VALID && <span className="fo-warning"> · {e.state.replace(/_/g, " ").toLowerCase()}</span>}
                {/* A serialized entry has no editable quantity: one serial is one unit. */}
                {e.serialNo === null && e.state === ENTRY_STATE.VALID && (
                  <>
                    {" "}
                    <button type="button" className="fo-link-btn" onClick={() => setQueue((q) => setEntryQuantity(q, e.entryId, e.quantity + 1))}>+1</button>
                    {e.quantity > 1 && (
                      <>
                        {" "}
                        <button type="button" className="fo-link-btn" onClick={() => setQueue((q) => setEntryQuantity(q, e.entryId, e.quantity - 1))}>−1</button>
                      </>
                    )}
                  </>
                )}
                {" "}
                <button type="button" className="fo-link-btn" onClick={() => setQueue((q) => removeEntry(q, e.entryId))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fo-panel" aria-label="Submit">
        <h3>Submit receipt</h3>
        <div className="fo-identifier-form__row">
          <label htmlFor="rcv-location">Receiving location</label>
          <select id="rcv-location" className="fo-input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Choose a destination…</option>
            {locations.map((o) => (
              <option key={o.locationId} value={o.locationId}>{o.label ?? o.locationId}</option>
            ))}
          </select>
        </div>
        {error === NOT_DURABLE_TEXT ? (
          // Not a refusal: the platform never saw this. The scans stay on screen because this is the
          // only copy of them that exists.
          <p className="fo-inline-error" role="alert">{NOT_DURABLE_TEXT}</p>
        ) : error ? (
          <p className="fo-inline-error" role="alert">
            The receipt was not accepted ({String(error).toLowerCase()}). Nothing was received — reload
            the order and try again.
          </p>
        ) : null}
        <Button
          type="button"
          variant={canSubmit ? "primary" : "protected"}
          disabled={!canSubmit}
          reason={
            !reconciliation.submittable
              ? blocked.length > 0
                ? "Resolve the blocked scans first."
                : "Scan at least one item."
              : !locationId
                ? "Choose a receiving location."
                : undefined
          }
          onClick={submit}
        >
          {submitting ? "Submitting…" : "Submit receipt"}
        </Button>
        <p className="fo-muted">
          One atomic receipt against this purchase order. Any line that is still short stays open —
          this screen cannot close a line short, and no governed command exists to do it.
        </p>
      </section>
    </>
  );
}

// `initialPurchaseOrderId` / `onExit` — Receiving North Star frame 1a entry seam. When the
// workspace's Awaiting-receipt queue (or its scan line) opens this journey, it already knows the
// order, so the session starts there and "choose a different order" returns to the QUEUE (onExit)
// instead of the internal picker — the queue IS the picker in that composition. Standalone use is
// byte-identical: no initial id, internal OrderPicker, unchanged behaviour. Presentation-only;
// the session, its reads and its submit path are untouched.
export default function MultiScanReceiving({ deps, initialPurchaseOrderId = null, onExit = null }) {
  const [purchaseOrderId, setPurchaseOrderId] = useState(initialPurchaseOrderId);
  const leave = onExit ?? (() => setPurchaseOrderId(null));
  if (purchaseOrderId === null) return <OrderPicker deps={deps} onPick={setPurchaseOrderId} />;
  return (
    <>
      <button type="button" className="fo-link-btn" onClick={leave}>
        ← Choose a different purchase order
      </button>
      <ScanSession
        key={purchaseOrderId}
        purchaseOrderId={purchaseOrderId}
        deps={deps}
        onDone={leave}
      />
    </>
  );
}

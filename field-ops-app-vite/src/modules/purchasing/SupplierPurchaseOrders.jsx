import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUPPLIER_PURCHASE_ORDER_GATE } from "../../access/shellCapabilityGates.js";
import { newIdempotencyKey, supplierPurchasingClient, SUPPLIER_PO_OUTCOME } from "../../services/eosSupplierPurchasingClient.js";
import { resolveActorDisplayName, useGovernedEmployeeDirectory } from "../../hooks/useGovernedEmployeeDirectory.js";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// Purchasing > Purchase Orders > Supplier purchase orders (P-1, DECISIONS #P-1; resolves OD-B3-1).
//
// THE MULTI-LINE ORDER A BUYER RAISES TO ONE SUPPLIER from the requests already assigned to them, reviewed, approved by someone else, and sent. It is a
// separate authority from the recorded Reorder purchase order beside it (PurchaseOrders.jsx): that one RECORDS an order already placed, one Part each;
// this one AUTHORS an order, one line per request. A request is on one or the other, never both.
//
// THE SERVER DECIDES, THE SCREEN OFFERS. Every control is shown only to a holder of the capability its command enforces (SUPPLIER_PURCHASE_ORDER_GATE),
// narrowed by the server's own `allowed` flags (status, and the creator never approving their own order). Nothing is computed here that the server
// does not state, and every call re-decides on the server. A refusal is shown in the server's own words; a failure the platform did not govern is a
// bounded sentence. Nothing here is optimistic: the order list is re-read after every change.
//
// MONEY: a price is optional, stored as whole minor units with its currency. A blank price is "unknown" and is shown as such -- never as zero. A
// default from the Part's supplier terms is shown as a default (and only to a caller who may read those terms), and the buyer may overwrite it.

const FILTERS = [
  { key: "open", label: "Open", statuses: ["DRAFT", "APPROVED", "SENT"] },
  { key: "received", label: "Received", statuses: ["RECEIVED"] },
  { key: "cancelled", label: "Cancelled", statuses: ["CANCELLED"] },
  { key: "all", label: "All", statuses: null },
];

const STATUS_LABEL = { DRAFT: "Draft", APPROVED: "Approved", SENT: "Sent", RECEIVED: "Received", CANCELLED: "Cancelled" };

/** A price in whole minor units + its currency, for a person. UNKNOWN (null) is said, never zero. */
export const formatMinorPrice = (minor, currency) =>
  minor === null || minor === undefined || !currency ? "Price not stated" : `${currency} ${(Number(minor) / 100).toFixed(2)}`;

/** "12.5" / "12.50" / "12" -> whole minor units; anything else -> null (refused, never rounded to something the buyer did not type). */
export function toMinorUnits(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
}

const sentence = (res, fallback) => (res.message ? res.message : (
  res.outcome === SUPPLIER_PO_OUTCOME.UNAUTHENTICATED ? "Sign in again to continue."
    : res.outcome === SUPPLIER_PO_OUTCOME.UNAVAILABLE ? fallback : fallback));

export default function SupplierPurchaseOrders({ hasCapability, client = supplierPurchasingClient }) {
  const can = useCallback((key) => typeof hasCapability === "function" && hasCapability(key) === true, [hasCapability]);
  const [filterKey, setFilterKey] = useState("open");
  const [list, setList] = useState({ state: "loading", orders: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState({ state: "idle", order: null });
  const [raising, setRaising] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadList = useCallback(async () => {
    const res = await client.listOrders({});
    setList(res.ok ? { state: "ready", orders: res.purchaseOrders }
      : { state: res.outcome === SUPPLIER_PO_OUTCOME.DENIED ? "denied" : "unavailable", orders: [], message: res.message });
  }, [client]);
  const loadDetail = useCallback(async (id) => {
    setDetail({ state: "loading", order: null });
    const res = await client.readOrder(id);
    setDetail(res.ok ? { state: "ready", order: res.order } : { state: "unavailable", order: null, message: res.message });
  }, [client]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail({ state: "idle", order: null }); }, [selectedId, loadDetail]);

  const actorIds = useMemo(() => {
    const ids = new Set(list.orders.map((o) => o.createdBy));
    for (const k of ["createdBy", "approvedBy", "sentBy", "cancelledBy"]) if (detail.order?.[k]) ids.add(detail.order[k]);
    return [...ids].filter(Boolean);
  }, [list.orders, detail.order]);
  const { byUserId } = useGovernedEmployeeDirectory({ actorIds });
  const nameOf = (id) => (id ? resolveActorDisplayName(id, byUserId) : "—");

  const active = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const rows = active.statuses ? list.orders.filter((o) => active.statuses.includes(o.status)) : list.orders;
  const filterOptions = FILTERS.map((f) => ({ key: f.key, label: f.label, count: f.statuses ? list.orders.filter((o) => f.statuses.includes(o.status)).length : list.orders.length }));

  const afterChange = async (id, message) => {
    setNotice(message);
    await loadList();
    if (id) { setSelectedId(id); await loadDetail(id); }
  };

  const raise = can(SUPPLIER_PURCHASE_ORDER_GATE.create) ? (
    <div className="fo-btn-row">
      <button type="button" className="fo-btn-secondary" onClick={() => setRaising((v) => !v)} aria-expanded={raising}>
        {raising ? "Close" : "Raise supplier purchase order"}
      </button>
    </div>
  ) : null;

  const header = (children) => (
    <WorkspaceIdentity
      crumb="Purchasing → Purchase Orders → Supplier purchase orders"
      title="Supplier Purchase Orders"
      count={list.state === "ready" ? list.orders.length : null}
      countLabel={list.orders.length === 1 ? "order" : "orders"}
    >
      <p className="fo-muted">
        Orders raised to one supplier, one line for each purchasing request. A draft is approved by someone other than the person who raised it, then marked as sent.
        Approved and sent orders are received in Inventory → Receiving; receiving a line completes its request.
      </p>
      {children}
    </WorkspaceIdentity>
  );

  if (list.state === "loading") return header(<LoadingState>Loading supplier purchase orders…</LoadingState>);
  if (list.state === "denied") {
    return header(<FailureState title="Supplier purchase orders unavailable" message="Your role does not include viewing supplier purchase orders." />);
  }
  if (list.state === "unavailable") {
    return header(<FailureState title="Supplier purchase orders unavailable" message="The supplier purchase orders could not be loaded. Try again shortly." />);
  }

  return header(
    <>
      {notice ? <p role="status" className="fo-muted">{notice}</p> : null}
      {raise}
      {raising && can(SUPPLIER_PURCHASE_ORDER_GATE.create) ? (
        <RaiseForm client={client} onDone={async (order) => { setRaising(false); await afterChange(order.purchaseOrderId, `Raised ${order.externalPoNumber} as a draft. It needs approval before it can be sent.`); }} />
      ) : null}
      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} label="Supplier purchase order views" />
      {list.orders.length === 0 ? (
        <EmptyState variant="database" title="No supplier purchase orders yet"
          message="A supplier purchase order is raised from purchasing requests that are assigned to you and in progress."
          guidance="Start purchasing on a request, then raise one order for all the requests you are buying from the same supplier for the same warehouse." />
      ) : rows.length === 0 ? (
        <EmptyState variant="filtered" title="No matching orders" message="No supplier purchase orders match this view." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table fo-table--stack ns-table" aria-label="Supplier purchase orders">
            <thead>
              <tr><th>PO #</th><th>Supplier</th><th>Status</th><th>Lines</th><th>Ordered</th><th>Received</th><th>Raised by</th></tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.purchaseOrderId} aria-selected={o.purchaseOrderId === selectedId}>
                  <td>
                    <button type="button" className="fo-link-btn" onClick={() => setSelectedId(o.purchaseOrderId === selectedId ? null : o.purchaseOrderId)}>
                      {o.externalPoNumber ?? "No number"}
                    </button>
                  </td>
                  <td>{o.supplierName ?? <span className="fo-muted">Supplier not resolved</span>}</td>
                  <td><span className={`fo-po-status fo-po-status--${o.status.toLowerCase()}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                  <td>{o.lineCount}</td>
                  <td>{o.orderedQuantity}</td>
                  <td>{o.receivedQuantity}</td>
                  <td>{nameOf(o.createdBy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedId ? (
        detail.state === "loading" ? <LoadingState>Loading the order…</LoadingState>
          : detail.state === "ready" ? <OrderDetail order={detail.order} can={can} client={client} nameOf={nameOf} onChanged={afterChange} />
            : <FailureState title="Order unavailable" message={detail.message ?? "This order could not be loaded."} />
      ) : null}
    </>,
  );
}

function OrderDetail({ order, can, client, nameOf, onChanged }) {
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // ONE key per attempt, held until the attempt is answered: a retry after a lost response is a replay, not a second action.
  const attemptKey = useRef(null);

  const act = async (action) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    attemptKey.current = attemptKey.current ?? newIdempotencyKey(`spo-${action.toLowerCase()}`);
    const res = await client.transitionOrder({
      purchaseOrderId: order.purchaseOrderId, action, expectedVersion: order.version, idempotencyKey: attemptKey.current, ...(action === "CANCEL" ? { reason } : {}),
    });
    setBusy(false);
    if (res.ok) {
      attemptKey.current = null;
      setCancelling(false);
      setReason("");
      await onChanged(order.purchaseOrderId, action === "APPROVE" ? `Approved ${order.externalPoNumber}.` : action === "SEND" ? `Marked ${order.externalPoNumber} as sent.` : `Cancelled ${order.externalPoNumber}. Its requests are back in purchasing.`);
      return;
    }
    // A definitive answer ends the attempt; only an unreachable / unavailable service keeps the key, so the retry is safe.
    if (res.outcome !== SUPPLIER_PO_OUTCOME.UNAVAILABLE) attemptKey.current = null;
    setError(sentence(res, "That did not go through. Nothing was changed; try again."));
  };

  const mayApprove = can(SUPPLIER_PURCHASE_ORDER_GATE.approve) && order.allowed.approve;
  const maySend = can(SUPPLIER_PURCHASE_ORDER_GATE.send) && order.allowed.send;
  const mayCancel = can(SUPPLIER_PURCHASE_ORDER_GATE.cancel) && order.allowed.cancel;

  return (
    <section aria-label={`Order ${order.externalPoNumber ?? order.purchaseOrderId}`} className="fo-panel">
      <h3>{order.externalPoNumber ?? "Order"} <span className="fo-muted">· {STATUS_LABEL[order.status] ?? order.status}</span></h3>
      <dl className="fo-po-receipt-desc">
        <div><dt>Supplier</dt><dd>{order.supplierName ?? "Supplier not resolved"}</dd></div>
        <div><dt>Receiving warehouse</dt><dd>{order.receivingWarehouseId ?? "Not stated"}</dd></div>
        <div><dt>Raised by</dt><dd>{nameOf(order.createdBy)}</dd></div>
        {order.approvedBy ? <div><dt>Approved by</dt><dd>{nameOf(order.approvedBy)}</dd></div> : null}
        {order.sentBy ? <div><dt>Sent by</dt><dd>{nameOf(order.sentBy)}</dd></div> : null}
        {order.cancelledBy ? <div><dt>Cancelled by</dt><dd>{nameOf(order.cancelledBy)} — {order.cancellationReason}</dd></div> : null}
      </dl>
      <div className="fo-table-scroll">
        <table className="fo-table fo-table--stack ns-table" aria-label="Order lines">
          <thead><tr><th>Part</th><th>Request</th><th>Ordered</th><th>Received</th><th>Unit price</th></tr></thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.lineId}>
                <td>{l.partId}</td>
                <td>{l.reorderRequestNumber ?? l.reorderRequestId ?? <span className="fo-muted">—</span>}{l.linkReleased ? <span className="fo-muted"> (released)</span> : null}</td>
                <td>{l.orderedQuantity}</td>
                <td>{l.receivedQuantity}</td>
                <td>{formatMinorPrice(l.unitPriceMinor, l.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.status === "DRAFT" && !mayApprove && can(SUPPLIER_PURCHASE_ORDER_GATE.approve) ? (
        <p className="fo-muted" role="note">You raised this order, so someone else approves it.</p>
      ) : null}
      {order.receivable ? <p className="fo-muted" role="note">This order can be received in Inventory → Receiving.</p> : null}
      {error ? <p role="alert" className="fo-error">{error}</p> : null}
      {mayApprove || maySend || mayCancel ? (
        <div className="fo-btn-row">
          {mayApprove ? <button type="button" disabled={busy} onClick={() => act("APPROVE")}>Approve</button> : null}
          {maySend ? <button type="button" disabled={busy} onClick={() => act("SEND")}>Mark as sent</button> : null}
          {mayCancel ? <button type="button" className="fo-btn-secondary" disabled={busy} onClick={() => setCancelling((v) => !v)}>{cancelling ? "Keep order" : "Cancel order"}</button> : null}
        </div>
      ) : null}
      {mayCancel && cancelling ? (
        <div className="fo-field">
          <label htmlFor="spo-cancel-reason">Why is this order cancelled?</label>
          <textarea id="spo-cancel-reason" className="fo-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          <div className="fo-btn-row">
            <button type="button" disabled={busy || reason.trim() === ""} onClick={() => act("CANCEL")}>Confirm cancellation</button>
          </div>
          <p className="fo-muted">Its requests return to purchasing so they can be ordered again.</p>
        </div>
      ) : null}
    </section>
  );
}

function RaiseForm({ client, onDone }) {
  const [supplierId, setSupplierId] = useState("");
  const [data, setData] = useState({ state: "loading", requests: [], suppliers: [] });
  const [chosen, setChosen] = useState({}); // requestId -> { quantity, price, currency }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const attemptKey = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await client.listPurchasable({ supplierId: supplierId || undefined });
      if (!live) return;
      setData(res.ok ? { state: "ready", requests: res.requests, suppliers: res.suppliers }
        : { state: res.outcome === SUPPLIER_PO_OUTCOME.DENIED ? "denied" : "unavailable", requests: [], suppliers: [] });
    })();
    return () => { live = false; };
  }, [client, supplierId]);

  const chosenIds = Object.keys(chosen);
  // One order is for ONE receiving warehouse: the first request picked fixes it, and the others in a different warehouse are unavailable.
  const warehouseId = chosenIds.length ? data.requests.find((r) => r.reorderRequestId === chosenIds[0])?.warehouseId ?? null : null;

  const toggle = (r) => setChosen((cur) => {
    const next = { ...cur };
    if (next[r.reorderRequestId]) delete next[r.reorderRequestId];
    else next[r.reorderRequestId] = { quantity: String(r.requestedQuantity > 0 ? r.requestedQuantity : ""), price: "", currency: r.defaultCurrency ?? "USD" };
    return next;
  });
  const patch = (id, p) => setChosen((cur) => ({ ...cur, [id]: { ...cur[id], ...p } }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const lines = [];
    for (const id of chosenIds) {
      const c = chosen[id];
      const quantity = Number(c.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) { setError("Every line needs a whole quantity above zero."); return; }
      const line = { reorderRequestId: id, orderedQuantity: quantity };
      if (c.price.trim() !== "") {
        const minor = toMinorUnits(c.price);
        if (minor === null || !/^[A-Z]{3}$/.test(c.currency)) { setError("A price is dollars and cents (for example 12.50) with a three-letter currency, or leave it blank."); return; }
        line.unitPriceMinor = minor;
        line.currency = c.currency;
      }
      lines.push(line);
    }
    setBusy(true);
    setError(null);
    attemptKey.current = attemptKey.current ?? newIdempotencyKey("spo-create");
    const res = await client.createOrder({ supplierId, receivingWarehouseId: warehouseId, lines, idempotencyKey: attemptKey.current });
    setBusy(false);
    if (res.ok) { attemptKey.current = null; await onDone(res.order); return; }
    if (res.outcome !== SUPPLIER_PO_OUTCOME.UNAVAILABLE) attemptKey.current = null;
    setError(sentence(res, "The order was not raised. Nothing was changed; try again."));
  };

  if (data.state === "loading") return <LoadingState>Loading your requests…</LoadingState>;
  if (data.state !== "ready") {
    return <FailureState title="Cannot raise an order" message={data.state === "denied" ? "Your role does not include raising supplier purchase orders." : "Your requests could not be loaded. Try again shortly."} />;
  }
  if (data.requests.length === 0) {
    return <EmptyState variant="filtered" title="Nothing to order" message="You have no requests in progress that are ready for a purchase order." />;
  }

  return (
    <form onSubmit={submit} aria-label="Raise a supplier purchase order" className="fo-panel">
      <div className="fo-field">
        <label htmlFor="spo-supplier">Supplier</label>
        <select id="spo-supplier" className="fo-input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
          <option value="">Choose a supplier</option>
          {data.suppliers.map((s) => <option key={s.supplierId} value={s.supplierId}>{s.name}</option>)}
        </select>
      </div>
      <fieldset className="fo-fieldset">
        <legend>Requests to order</legend>
        {data.requests.map((r) => {
          const on = Boolean(chosen[r.reorderRequestId]);
          const blocked = !on && warehouseId !== null && r.warehouseId !== warehouseId;
          return (
            <div key={r.reorderRequestId} className="fo-field">
              <label>
                <input type="checkbox" checked={on} disabled={blocked} onChange={() => toggle(r)} />{" "}
                {r.reorderRequestNumber ?? r.reorderRequestId} — {r.partId}, {r.requestedQuantity} requested, {r.warehouseName}
                {blocked ? " (another warehouse: order it separately)" : ""}
              </label>
              {on ? (
                <div className="fo-btn-row">
                  <label>Quantity <input className="fo-input" inputMode="numeric" aria-label={`Quantity for ${r.partId}`} value={chosen[r.reorderRequestId].quantity}
                    onChange={(e) => patch(r.reorderRequestId, { quantity: e.target.value })} /></label>
                  <label>Unit price <input className="fo-input" inputMode="decimal" aria-label={`Unit price for ${r.partId}`} value={chosen[r.reorderRequestId].price}
                    placeholder={r.defaultUnitPriceMinor !== null && r.defaultUnitPriceMinor !== undefined ? `${(r.defaultUnitPriceMinor / 100).toFixed(2)} (supplier terms)` : "Not stated"}
                    onChange={(e) => patch(r.reorderRequestId, { price: e.target.value })} /></label>
                  <label>Currency <input className="fo-input" aria-label={`Currency for ${r.partId}`} value={chosen[r.reorderRequestId].currency} maxLength={3}
                    onChange={(e) => patch(r.reorderRequestId, { currency: e.target.value.toUpperCase() })} /></label>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      {error ? <p role="alert" className="fo-error">{error}</p> : null}
      <div className="fo-btn-row">
        <button type="submit" disabled={busy || supplierId === "" || chosenIds.length === 0}>Raise order</button>
      </div>
      <p className="fo-muted">A blank price is saved as not stated, or taken from the supplier terms when you can read them. The order is a draft until someone else approves it.</p>
    </form>
  );
}

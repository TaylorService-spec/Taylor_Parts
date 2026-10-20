import { useCallback, useEffect, useRef, useState } from "react";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { salesOrderCommandClient } from "../../services/salesOrderCommandClient.js";

// STOCK ALLOCATION ON A SALES ORDER (S1c; DECISIONS #S1c). A hard reservation of one PART line's quantity at a warehouse the caller CHOOSES.
//
// THE CLIENT DECIDES NOTHING. This screen names no capability and trusts no flag it computed. Everything it offers comes from one server read
// (`readSalesOrderAllocations`): whether the caller may allocate (`canAllocate`: holds salesOrder.fulfill, the order is open, and there is a warehouse in
// the caller's scope), whether they may release (`canRelease`), the warehouses they may allocate from, and per line what is allocated and where. Every
// action re-decides on the server (capability, then company, then warehouse scope; the Part and quantity are bound to the line; a terminal order takes
// nothing) and a refusal is shown in the SERVER'S OWN WORDS. The company is the order's own, stated back to the server with the warehouse; neither is
// derived from the other.
//
// IDEMPOTENCY. One key per attempt (line, warehouse, quantity), kept across a failed attempt so a retry replays rather than reserving twice, and dropped
// when the attempt succeeds.
//
// NOT HERE: consuming stock, Work Order dispatch, creating a service order from an allocation (later lanes).

const newKey = () => `soalloc-${typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const GENERIC = Object.freeze({
  "permission-denied": "You are not authorized to allocate stock on this Sales Order.",
  "invalid-argument": "That request was not valid. Check the warehouse and quantity.",
  "not-found": "The Sales Order, line or warehouse could not be found. Reload the page.",
});
const refusalWords = (answer) => answer.message ?? GENERIC[answer.errorStatus] ?? "The request could not be completed. Try again.";

const OPEN_STATES = new Set(["CONFIRMED", "IN_FULFILLMENT"]);

/** @param {{ salesOrderId: string, client?: typeof salesOrderCommandClient, onChanged?: () => void }} props */
export default function SalesOrderAllocation({ salesOrderId, client = salesOrderCommandClient, onChanged }) {
  const [load, setLoad] = useState({ status: "loading", data: null });
  const [warehouseId, setWarehouseId] = useState("");
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const keys = useRef({});
  const scope = useRef(salesOrderId);
  if (scope.current !== salesOrderId) { scope.current = salesOrderId; keys.current = {}; } // a retained key never crosses to another order

  const refresh = useCallback(async () => {
    const answer = await client.readSalesOrderAllocations({ salesOrderId });
    if (scope.current !== salesOrderId) return;
    if (answer.errorStatus) {
      setLoad({ status: answer.errorStatus === "permission-denied" ? "denied" : "unavailable", data: null });
      return;
    }
    setLoad({ status: "ready", data: answer.result });
    setWarehouseId((prev) => (answer.result.warehouses.some((w) => w.warehouseId === prev && w.active) ? prev
      : (answer.result.warehouses.find((w) => w.active)?.warehouseId ?? "")));
  }, [client, salesOrderId]);

  useEffect(() => { setLoad({ status: "loading", data: null }); refresh(); }, [refresh]);

  const run = useCallback(async (kind, line) => {
    const raw = quantities[line.lineNumber];
    const quantity = raw === undefined || String(raw).trim() === "" ? undefined : Number(raw);
    const attempt = `${kind}|${line.lineNumber}|${warehouseId}|${quantity ?? "all"}`;
    keys.current[attempt] ??= newKey();
    setBusy(true); setError(null); setNotice(null);
    try {
      const base = { salesOrderId, lineNumber: line.lineNumber, operatingCompanyId: load.data.operatingCompanyId, warehouseId, idempotencyKey: keys.current[attempt] };
      const answer = kind === "allocate"
        ? await client.allocateSalesOrder({ ...base, partId: line.partId, quantity })
        : await client.releaseSalesOrderAllocation({ ...base, reason, ...(quantity === undefined ? {} : { quantity }) });
      if (answer.errorStatus) { setError(refusalWords(answer)); return; }
      delete keys.current[attempt]; // this attempt is finished -- the next click is a new intent
      setNotice(kind === "allocate" ? `Allocated ${quantity} to line ${line.lineNumber}.` : `Released the allocation on line ${line.lineNumber}.`);
      setQuantities((q) => ({ ...q, [line.lineNumber]: "" }));
      await refresh();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [client, load.data, onChanged, quantities, reason, refresh, salesOrderId, warehouseId]);

  if (load.status === "loading") return <RuledSection title="Allocation"><HonestState state={HONEST_STATE.LOADING} subject="allocations" /></RuledSection>;
  if (load.status === "denied") {
    return <RuledSection title="Allocation"><HonestState state={HONEST_STATE.DENIED} subject="Allocation" detail="You are not authorized to see the stock allocated to this Sales Order." /></RuledSection>;
  }
  if (load.status === "unavailable") {
    return (
      <RuledSection title="Allocation">
        <HonestState state={HONEST_STATE.UNAVAILABLE} detail="Allocation is currently unavailable."
          action={<button type="button" className="fo-button" onClick={refresh}>Try Again</button>} />
      </RuledSection>
    );
  }

  const data = load.data;
  const partLines = data.lines.filter((l) => l.kind === "PART");
  if (partLines.length === 0) return null; // nothing on this order is stock
  const holder = data.canRelease === true;
  const warehouses = data.warehouses.filter((w) => w.active);
  const chosen = warehouses.find((w) => w.warehouseId === warehouseId) ?? null;
  const open = OPEN_STATES.has(data.state);
  const atChosen = (line) => line.byWarehouse.find((b) => b.warehouseId === warehouseId)?.allocated ?? 0;
  const left = (line) => Math.max(0, line.orderedQty - line.allocatedTotal);

  return (
    <RuledSection title="Allocation" meta={<span className="ns-section__note">stock set aside for this order</span>}>
      {!holder ? (
        <p className="fo-muted" role="note">You can see what is allocated. Allocating stock needs the Sales Order fulfillment permission.</p>
      ) : !open ? (
        <p className="fo-muted" role="note">This order is not open to new allocations. You can still release what it holds.</p>
      ) : warehouses.length === 0 ? (
        <p className="fo-muted" role="note">None of your warehouses belong to this order's company, so you cannot allocate stock to it.</p>
      ) : null}

      {holder && warehouses.length > 0 ? (
        <div className="fo-field">
          <label htmlFor="so-alloc-warehouse">Warehouse</label>
          <select id="so-alloc-warehouse" className="fo-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={busy}>
            {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
          </select>
        </div>
      ) : null}

      <div className="ns-table-wrap">
        <table className="ns-table" aria-label="Allocation by line">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Item</th>
              <th scope="col" className="ns-num">Ordered</th>
              <th scope="col" className="ns-num">Allocated</th>
              <th scope="col" className="ns-num">{chosen ? `At ${chosen.name}` : "At warehouse"}</th>
              {holder ? <th scope="col">Quantity</th> : null}
            </tr>
          </thead>
          <tbody>
            {partLines.map((line) => (
              <tr key={line.lineNumber}>
                <td>{line.lineNumber}</td>
                <td>{line.partId}</td>
                <td className="ns-num">{line.orderedQty}</td>
                <td className="ns-num">
                  {line.allocatedTotal}
                  {line.heldOutsideYourScope > 0 ? <span className="fo-muted"> ({line.heldOutsideYourScope} at warehouses outside your scope)</span> : null}
                </td>
                <td className="ns-num">{chosen ? atChosen(line) : "—"}</td>
                {holder ? (
                  <td>
                    <input type="number" min="1" step="1" className="fo-input" aria-label={`Quantity for line ${line.lineNumber}`}
                      value={quantities[line.lineNumber] ?? ""} disabled={busy || !chosen}
                      onChange={(e) => setQuantities((q) => ({ ...q, [line.lineNumber]: e.target.value }))} />
                    <div className="fo-btn-row">
                      {data.canAllocate ? (
                        <button type="button" className="fo-btn-secondary" aria-label={`Allocate line ${line.lineNumber}`}
                          disabled={busy || !chosen || left(line) === 0 || !(Number(quantities[line.lineNumber]) > 0)} onClick={() => run("allocate", line)}>
                          Allocate
                        </button>
                      ) : null}
                      <button type="button" className="fo-btn-secondary" aria-label={`Release line ${line.lineNumber}`}
                        disabled={busy || !chosen || atChosen(line) === 0 || reason.trim() === ""} onClick={() => run("release", line)}>
                        Release
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {holder ? (
        <div className="fo-field">
          <label htmlFor="so-alloc-reason">Reason (required to release)</label>
          <input id="so-alloc-reason" type="text" className="fo-input" maxLength={200} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          <p className="fo-muted">Leave the quantity blank to release everything the line holds at this warehouse.</p>
        </div>
      ) : null}
      {notice ? <p role="status" className="fo-muted">{notice}</p> : null}
      {error ? <p role="alert" className="fo-error">{error}</p> : null}
    </RuledSection>
  );
}

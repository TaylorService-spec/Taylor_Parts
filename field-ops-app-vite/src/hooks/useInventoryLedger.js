import { useEffect, useState } from "react";
import { fetchInventoryMovements, fetchInventoryPosition } from "../services/partsOperationsReads.js";
import { generateInventoryHealthDashboard } from "../domain/inventoryAnalyticsEngine";
import { LEDGER_INTEGRITY_STATE } from "../domain/ledgerRowIntegrity.js";

// EOS CUTOVER (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01): "Replace useInventoryLedger -> Firestore
// inventory_transactions with EOS API -> PostgreSQL authoritative inventory state." The hook keeps its contract
// ({ transactions, healthEntries, loading, error, integrity }) and its consumers, but every figure now comes from the
// governed Operations reads:
//
//   STOCK      readInventoryOnHand -- the on-hand position DERIVED SERVER-SIDE from eos_ops.inventory_movements, the
//              sole quantity-mutating record. Not re-derived here: no client sign rule, no parallel stock truth, and an
//              EOS receipt is visible on the next read.
//   HISTORY    readInventoryMovements -- the same ledger rows (signed quantity_delta as recorded), newest first, for Part
//              detail's history and the usage-rate analytics, which run unchanged over them.
//   SCOPE      the server answers only for the caller's governed WAREHOUSE scope; no scope is an empty, honest answer.
//
// PostgreSQL movements are governed rows (typed, constrained), so the DQ-027 integrity state is COMPLETE; a read failure is
// a FAILED read (`error`), never a silent empty list.
const toLedgerTransaction = (m) => ({
  id: m.movementId,
  workOrderId: m.sourceKind === "WORK_ORDER" ? m.sourceId : null,
  partId: m.partId,
  type: m.movementType,
  quantity: m.quantityDelta,
  timestamp: Date.parse(m.occurredAt) || 0,
  locationType: m.locationType,
  locationId: m.locationId,
  warehouseId: m.warehouseId,
});

const COMPLETE = Object.freeze({ state: LEDGER_INTEGRITY_STATE.COMPLETE, reason: null, unavailablePartIds: Object.freeze([]), unreadableRows: 0, unattributableRows: 0 });

/**
 * The governed stock picture -- on-hand totals and movement history from the EOS reads, and the health analytics over
 * them -- as one pure loader, so every surface that shows inventory truth (this hook; the Operations dashboard) uses the
 * SAME reads and the SAME derivation. `{ transactions, healthEntries, integrity }`; rejects on a failed read.
 */
export async function loadEosInventoryHealth(deps = {}) {
  const position = deps.fetchInventoryPosition ?? fetchInventoryPosition;
  const movements = deps.fetchInventoryMovements ?? fetchInventoryMovements;
  const [onHand, history] = await Promise.all([position({}), movements({})]);
  const transactions = (history?.items ?? []).map(toLedgerTransaction);
  const stockSnapshots = (onHand?.totals ?? []).map((t) => ({ partId: t.partId, availableStock: t.onHand }));
  return { transactions, healthEntries: generateInventoryHealthDashboard(transactions, stockSnapshots), integrity: COMPLETE };
}

export function useInventoryLedger({ allowPartial = false, deps = {} } = {}) {
  void allowPartial; // the governed read is always COMPLETE; kept so existing callers need no change
  const [state, setState] = useState({ transactions: [], healthEntries: [], loading: true, error: null, integrity: null });
  const position = deps.fetchInventoryPosition ?? fetchInventoryPosition;
  const movements = deps.fetchInventoryMovements ?? fetchInventoryMovements;

  useEffect(() => {
    let cancelled = false;
    loadEosInventoryHealth({ fetchInventoryPosition: position, fetchInventoryMovements: movements })
      .then(({ transactions, healthEntries, integrity }) => {
        if (cancelled) return;
        setState({ transactions, healthEntries, loading: false, error: null, integrity });
      })
      .catch((err) => {
        if (!cancelled) setState({ transactions: [], healthEntries: [], loading: false, error: err, integrity: null });
      });
    return () => {
      cancelled = true;
    };
  }, [position, movements]);

  return state;
}

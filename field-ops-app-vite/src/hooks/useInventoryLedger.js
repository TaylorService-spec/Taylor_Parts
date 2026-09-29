import { useEffect, useState } from "react";
import { fetchInventoryTransactions } from "../services/operationsQueries";
import {
  normalizeLedgerTransaction,
  computeAvailableStockByPart,
  generateInventoryHealthDashboard,
} from "../domain/inventoryAnalyticsEngine";
import {
  partitionLedgerIntegrity,
  LedgerIntegrityError,
  LEDGER_INTEGRITY_STATE,
} from "../domain/ledgerRowIntegrity.js";

// Sprint 2.1.1 -- Inventory Domain Foundation. One-shot read of
// inventory_transactions (same fetchInventoryTransactions() call
// Operations.jsx already uses -- no new Firestore query), normalized
// and run through the same pure analytics functions Operations.jsx
// uses for its Inventory Health panel. Returns both the normalized
// transactions (for Part detail's per-part history) and the derived
// health entries (for stock-position/reorder-status display), so
// every consumer of this hook is guaranteed to see the same numbers
// Operations.jsx shows, computed the same way.
// DQ-027 (Controller ruling 2026-09-28): malformed ledger evidence is never silently omitted.
//
// The raw rows are partitioned FIRST (domain/ledgerRowIntegrity.js, pinned to the server's strict reader).
// A part named by an unreadable row gets NO figures -- it is reported in `integrity.unavailablePartIds`,
// never dropped, never zero. Every other part's figures are computed from its own readable rows only, so
// they stay truthful.
//
// The contract this hook ALWAYS had -- { transactions, healthEntries, loading, error } -- cannot say "some
// parts are unavailable". So a caller that has not opted in gets a FAILED read (`error`, a
// LedgerIntegrityError) whenever anything is unreadable, rather than a list that silently lacks the
// affected parts. A caller that renders the disclosure opts in with { allowPartial: true } and receives
// `integrity` beside the figures. An unreadable row naming NO part is UNAVAILABLE for everyone: nobody can
// say which part it would have moved.
export function useInventoryLedger({ allowPartial = false } = {}) {
  const [state, setState] = useState({ transactions: [], healthEntries: [], loading: true, error: null, integrity: null });

  useEffect(() => {
    let cancelled = false;

    fetchInventoryTransactions()
      .then((raw) => {
        if (cancelled) return;

        const integrity = partitionLedgerIntegrity(raw);
        if (integrity.state === LEDGER_INTEGRITY_STATE.UNAVAILABLE
          || (integrity.state === LEDGER_INTEGRITY_STATE.INCOMPLETE && !allowPartial)) {
          setState({ transactions: [], healthEntries: [], loading: false, error: new LedgerIntegrityError(integrity), integrity });
          return;
        }

        const transactions = integrity.readable.map(normalizeLedgerTransaction);
        const availableByPart = computeAvailableStockByPart(transactions);
        const stockSnapshots = [...availableByPart.entries()].map(([partId, availableStock]) => ({
          partId,
          availableStock,
        }));
        const healthEntries = generateInventoryHealthDashboard(transactions, stockSnapshots);

        setState({ transactions, healthEntries, loading: false, error: null, integrity });
      })
      .catch((err) => {
        if (!cancelled) setState({ transactions: [], healthEntries: [], loading: false, error: err, integrity: null });
      });

    return () => {
      cancelled = true;
    };
  }, [allowPartial]);

  return state;
}

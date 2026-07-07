import { useEffect, useState } from "react";
import { fetchInventoryTransactions } from "../services/operationsQueries";
import {
  normalizeLedgerTransaction,
  computeAvailableStockByPart,
  generateInventoryHealthDashboard,
} from "../domain/inventoryAnalyticsEngine";

// Sprint 2.1.1 -- Inventory Domain Foundation. One-shot read of
// inventory_transactions (same fetchInventoryTransactions() call
// Operations.jsx already uses -- no new Firestore query), normalized
// and run through the same pure analytics functions Operations.jsx
// uses for its Inventory Health panel. Returns both the normalized
// transactions (for Part detail's per-part history) and the derived
// health entries (for stock-position/reorder-status display), so
// every consumer of this hook is guaranteed to see the same numbers
// Operations.jsx shows, computed the same way.
export function useInventoryLedger() {
  const [state, setState] = useState({ transactions: [], healthEntries: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    fetchInventoryTransactions()
      .then((raw) => {
        if (cancelled) return;

        const transactions = raw.map(normalizeLedgerTransaction);
        const availableByPart = computeAvailableStockByPart(transactions);
        const stockSnapshots = [...availableByPart.entries()].map(([partId, availableStock]) => ({
          partId,
          availableStock,
        }));
        const healthEntries = generateInventoryHealthDashboard(transactions, stockSnapshots);

        setState({ transactions, healthEntries, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ transactions: [], healthEntries: [], loading: false, error: err });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

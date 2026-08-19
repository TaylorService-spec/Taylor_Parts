import { useEffect, useState } from "react";
import { fetchSuppliersPage } from "../services/operationsQueries";

// Purchasing > Suppliers -- read hook for the Suppliers registry workspace. REUSES the shared
// operationsQueries.fetchSuppliers read (the same `suppliers` read the Operations dashboard's
// ProcurementPanel uses) rather than a parallel Firestore read. It returns the raw supplier docs
// (id, name, status, vendorNumber, ...) the pure view needs; shaping stays in domain/suppliersView.js.
//
// Fail-closed: a denied/unavailable read resolves to an error code (never a partial list); the
// workspace renders a FailureState. One-shot fetch (suppliers change rarely and are write-closed to
// clients), re-run on accessVersion change (the inventory/purchasing access-freshness convention).
export function useSuppliers(accessVersion) {
  const [state, setState] = useState({ loading: true, error: null, suppliers: [], truncated: false });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    // BOUNDED (§9). Uses the PAGE variant, not the shared unbounded fetcher: that same
    // fetcher also feeds the Operations dashboard's netted totals, and capping it there
    // would make an aggregate mathematically false while still presenting it as complete.
    // The bound belongs at the call site for exactly that reason.
    fetchSuppliersPage()
      .then(({ items, truncated }) => {
        if (!cancelled) setState({ loading: false, error: null, suppliers: items, truncated });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err?.code ?? "unknown", suppliers: [], truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [accessVersion]);

  return state;
}

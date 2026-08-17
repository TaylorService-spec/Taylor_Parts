import { useEffect, useState } from "react";
import { fetchWarehousesPage } from "../services/operationsQueries";

// Inventory > Warehouses -- read hook for the Warehouses registry workspace. REUSES the shared
// operationsQueries.fetchWarehousesPage read -- a BOUNDED variant, deliberately NOT the
// same call the Operations dashboard uses (see the call-site note below)
// rather than a parallel Firestore read or the truck-management pick-list hook (useWarehouseOptions,
// which is a gated {value,label} picker, not the full governed docs). It returns the raw warehouse
// docs (id, name, status, ...) the pure view needs; shaping stays in domain/warehousesView.js.
//
// Fail-closed: a denied/unavailable read resolves to an error code (never a partial list); the
// workspace renders a FailureState. One-shot fetch (warehouses change rarely and are write-closed
// to clients), re-run on accessVersion change (the inventory access-freshness convention).
export function useWarehouses(accessVersion) {
  const [state, setState] = useState({ loading: true, error: null, warehouses: [], truncated: false });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    // BOUNDED (§9). Uses the PAGE variant, not the shared unbounded fetcher: that same
    // fetcher also feeds the Operations dashboard's netted totals, and capping it there
    // would make an aggregate mathematically false while still presenting it as complete.
    // The bound belongs at the call site for exactly that reason.
    fetchWarehousesPage()
      .then(({ items, truncated }) => {
        if (!cancelled) setState({ loading: false, error: null, warehouses: items, truncated });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err?.code ?? "unknown", warehouses: [], truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [accessVersion]);

  return state;
}

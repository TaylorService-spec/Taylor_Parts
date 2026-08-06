import { useEffect, useState } from "react";
import { fetchWarehouses } from "../services/operationsQueries";

// Inventory > Warehouses -- read hook for the Warehouses registry workspace. REUSES the shared
// operationsQueries.fetchWarehouses read (the same `warehouses` read the Operations dashboard uses)
// rather than a parallel Firestore read or the truck-management pick-list hook (useWarehouseOptions,
// which is a gated {value,label} picker, not the full governed docs). It returns the raw warehouse
// docs (id, name, status, ...) the pure view needs; shaping stays in domain/warehousesView.js.
//
// Fail-closed: a denied/unavailable read resolves to an error code (never a partial list); the
// workspace renders a FailureState. One-shot fetch (warehouses change rarely and are write-closed
// to clients), re-run on accessVersion change (the inventory access-freshness convention).
export function useWarehouses(accessVersion) {
  const [state, setState] = useState({ loading: true, error: null, warehouses: [] });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchWarehouses()
      .then((warehouses) => {
        if (!cancelled) setState({ loading: false, error: null, warehouses });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err?.code ?? "unknown", warehouses: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [accessVersion]);

  return state;
}

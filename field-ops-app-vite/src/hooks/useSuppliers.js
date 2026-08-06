import { useEffect, useState } from "react";
import { fetchSuppliers } from "../services/operationsQueries";

// Purchasing > Suppliers -- read hook for the Suppliers registry workspace. REUSES the shared
// operationsQueries.fetchSuppliers read (the same `suppliers` read the Operations dashboard's
// ProcurementPanel uses) rather than a parallel Firestore read. It returns the raw supplier docs
// (id, name, status, vendorNumber, ...) the pure view needs; shaping stays in domain/suppliersView.js.
//
// Fail-closed: a denied/unavailable read resolves to an error code (never a partial list); the
// workspace renders a FailureState. One-shot fetch (suppliers change rarely and are write-closed to
// clients), re-run on accessVersion change (the inventory/purchasing access-freshness convention).
export function useSuppliers(accessVersion) {
  const [state, setState] = useState({ loading: true, error: null, suppliers: [] });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchSuppliers()
      .then((suppliers) => {
        if (!cancelled) setState({ loading: false, error: null, suppliers });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err?.code ?? "unknown", suppliers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [accessVersion]);

  return state;
}

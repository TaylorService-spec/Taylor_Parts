import { useEffect, useState } from "react";
import { fetchTransferOrderDocs, fetchWarehouses } from "../services/operationsQueries";

// Inventory > Transfers -- read hook for the Transfers workspace. It REUSES the existing shared
// operationsQueries fetches (the same reads the Operations dashboard uses: transfer_orders +
// warehouses, both read-only / Admin-SDK-write-only collections) rather than issuing its own
// Firestore reads -- so there is one read path, not a parallel one. It returns the raw inputs the
// canonical view-model (modules/operations/transferOrdersViewModel.buildTransferOrdersView) needs;
// it does NOT itself shape rows (single source of truth stays with that view-model).
//
// Fail-closed: a denied/unavailable read resolves to an error code (never a partial/fabricated
// list); the workspace renders an honest FailureState. One-shot fetch (transfer_orders + warehouses
// change rarely and both are write-closed to clients), re-run when accessVersion changes -- the
// same access-freshness convention the Operations dashboard uses.
export function useTransferOrders(accessVersion) {
  const [state, setState] = useState({ loading: true, error: null, transferOrderDocs: [], warehouses: [] });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.all([fetchTransferOrderDocs(), fetchWarehouses()])
      .then(([transferOrderDocs, warehouses]) => {
        if (!cancelled) setState({ loading: false, error: null, transferOrderDocs, warehouses });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err?.code ?? "unknown", transferOrderDocs: [], warehouses: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [accessVersion]);

  return state;
}

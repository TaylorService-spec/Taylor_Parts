import { useEffect, useState } from "react";
import { fetchTransferOrderDocsPage, fetchWarehousesPage } from "../services/operationsQueries";

// Inventory > Transfers -- read hook for the Transfers workspace. It REUSES the existing shared
// operationsQueries BOUNDED page fetchers (transfer_orders + warehouses, both read-only /
// Admin-SDK-write-only collections) rather than issuing its own Firestore reads -- so there is
// one read path, not a parallel one. It returns the raw inputs the canonical view-model
// (modules/operations/transferOrdersViewModel.buildTransferOrdersView) needs; it does NOT itself
// shape rows (single source of truth stays with that view-model).
//
// BOUNDED (X-TRANSFER-ORDERS-UNBOUNDED-READ remediation). This hook previously called the
// UNBOUNDED fetchTransferOrderDocs/fetchWarehouses -- a plain getDocs over the whole collection,
// no cap, no truncated flag, nothing to disclose. It now calls the PAGE variants
// (fetchTransferOrderDocsPage/fetchWarehousesPage, both capped at operationsQueries.LIST_READ_CAP)
// and surfaces each read's own `truncated` flag separately as transferOrdersTruncated/
// warehousesTruncated, so a caller CAN disclose a capped list honestly. The unbounded originals
// are left untouched and still feed the Operations dashboard's WarehousePanel display -- capping
// the shared fetcher there was rejected (see operationsQueries.ts's fetchTransferOrderDocsPage
// comment); the bound belongs at this call site only.
//
// KNOWN GAP: as of this remediation, modules/inventory/Transfers.jsx (out of this lane's write
// scope) does not read transferOrdersTruncated/warehousesTruncated at all -- the flags are
// computed here and currently go unconsumed by the surface, the same "computed and discarded"
// defect already found and fixed for Suppliers (see modules/purchasing/Suppliers.jsx's
// TRUNCATION comment). Wiring an honest disclosure banner into Transfers.jsx is a follow-up.
//
// Fail-closed: a denied/unavailable read resolves to an error code (never a partial/fabricated
// list); the workspace renders an honest FailureState. One-shot fetch (transfer_orders + warehouses
// change rarely and both are write-closed to clients), re-run when accessVersion changes -- the
// same access-freshness convention the Operations dashboard uses.
// `refreshKey` is an OPTIONAL second trigger (e.g. bumped after a successful write from
// useTransferActions) so the workspace can re-fetch on demand without a full accessVersion churn.
// Omitted callers are unaffected -- undefined !== undefined is false, so the effect still only
// re-runs on an actual accessVersion change unless a caller opts in by bumping refreshKey.
export function useTransferOrders(accessVersion, refreshKey) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    transferOrderDocs: [],
    warehouses: [],
    transferOrdersTruncated: false,
    warehousesTruncated: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.all([fetchTransferOrderDocsPage(), fetchWarehousesPage()])
      .then(([transferOrdersPage, warehousesPage]) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            transferOrderDocs: transferOrdersPage.items,
            warehouses: warehousesPage.items,
            transferOrdersTruncated: transferOrdersPage.truncated,
            warehousesTruncated: warehousesPage.truncated,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: err?.code ?? "unknown",
            transferOrderDocs: [],
            warehouses: [],
            transferOrdersTruncated: false,
            warehousesTruncated: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessVersion, refreshKey]);

  return state;
}

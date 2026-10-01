import { useEffect, useState } from "react";
import { listTransferOrderDocs } from "../services/transferCommandClient.js";
import { fetchInventoryWarehouseOptions } from "../services/inventoryLocationClient.js";

// Inventory > Transfers -- read hook for the Transfers workspace and the transfer scan.
//
// THE READ MOVED TO EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). It used to page the
// Firestore `transfer_orders` and `warehouses` collections (operationsQueries); it now asks the governed PostgreSQL
// reads -- listTransferOrders (transfers whose origin or destination warehouse is in the caller's WAREHOUSE scope)
// and listInventoryWarehouses (the caller's governed warehouses, for endpoint names). There is no Firestore read and
// no merge of the two stores.
//
// It returns the SAME raw inputs the canonical view-model (modules/operations/transferOrdersViewModel.js) takes --
// transfer rows as { docId, data } and warehouses as { id, name } -- so there is one row shape, not a second one.
// Each read discloses its own cap: the transfer list states `truncated`; the warehouse list is the caller's whole
// scoped set, never capped.
//
// Fail-closed: a refused / unavailable read resolves to an error code (never a partial or fabricated list). The code
// is the transport code the screens already render (`permission-denied`, `unavailable`, ...). `refreshKey` is an
// optional second trigger bumped after a successful write.
export function useTransferOrders(accessVersion, refreshKey, deps = {}) {
  const listOrders = deps.listTransferOrderDocs ?? listTransferOrderDocs;
  const listWarehouses = deps.fetchWarehouseOptions ?? fetchInventoryWarehouseOptions;
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
    Promise.all([listOrders({}), listWarehouses()])
      .then(([orders, warehouses]) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            transferOrderDocs: orders.items,
            warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
            transferOrdersTruncated: orders.truncated === true,
            warehousesTruncated: false,
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
    // listOrders / listWarehouses are stable module functions unless a test injects them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessVersion, refreshKey]);

  return state;
}

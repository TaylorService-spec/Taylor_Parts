import { useEffect, useState } from "react";
import { listTransferOrderDocs } from "../services/transferCommandClient.js";
import { fetchCompanyWarehouseOptions, fetchInventoryWarehouseOptions, fetchTruckLabels } from "../services/inventoryLocationClient.js";
import { fetchPartsByIds } from "../services/partMasterQueries.js";

// Inventory > Transfers -- read hook for the Transfers workspace and the transfer scan.
//
// THE READ MOVED TO EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). It used to page the
// Firestore `transfer_orders` and `warehouses` collections (operationsQueries); it now asks the governed PostgreSQL
// reads -- listTransferOrders (transfers whose origin or destination is in the caller's reach) and listInventoryWarehouses.
// There is no Firestore read and no merge of the two stores.
//
// ISO inventory (2026-10-19). Every endpoint a transfer shows is NAMED from ONE company-wide warehouse read (`companyWide`: every warehouse of the
// caller's operating companies, `inScope` marking where the caller works), so an out-of-scope destination shows its name, not its id; the Part is
// named through the governed Catalog read (readPartsByIds, the ids the page holds -- never the whole catalogue) and a truck through the governed
// location names. All three are BEST EFFORT: a name that cannot be read leaves the id fallback, never a failed list and never a made-up name.
//
// It returns the SAME raw inputs the canonical view-model (modules/operations/transferOrdersViewModel.js) takes --
// transfer rows as { docId, data } and warehouses as { id, name } (+ status, inScope) -- so there is one row shape, not a second one.
// The transfer list discloses its own cap.
//
// Fail-closed: a refused / unavailable TRANSFER read resolves to an error code (never a partial or fabricated list). The code
// is the transport code the screens already render (`permission-denied`, `unavailable`, ...). `refreshKey` is an
// optional second trigger bumped after a successful write.
export function useTransferOrders(accessVersion, refreshKey, deps = {}) {
  const listOrders = deps.listTransferOrderDocs ?? listTransferOrderDocs;
  const listCompanyWarehouses = deps.fetchCompanyWarehouseOptions ?? fetchCompanyWarehouseOptions;
  const listScopedWarehouses = deps.fetchWarehouseOptions ?? fetchInventoryWarehouseOptions;
  const listTruckLabels = deps.fetchTruckLabels ?? fetchTruckLabels;
  const listParts = deps.fetchPartsByIds ?? fetchPartsByIds;
  const [state, setState] = useState({
    loading: true,
    error: null,
    transferOrderDocs: [],
    warehouses: [],
    partNames: {},
    truckNames: {},
    transferOrdersTruncated: false,
    warehousesTruncated: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      const orders = await listOrders({});
      // Names: company-wide first, the caller's scoped warehouses when that is refused, nothing when both are -- never a failed list.
      let warehouses;
      try { warehouses = await listCompanyWarehouses(); } catch {
        try { warehouses = (await listScopedWarehouses()).map((w) => ({ ...w, inScope: true })); } catch { warehouses = []; }
      }
      let truckNames = {};
      try { truckNames = Object.fromEntries((await listTruckLabels()).map((t) => [t.locationId, t.label])); } catch { truckNames = {}; }
      let partNames = {};
      try {
        const ids = [...new Set(orders.items.map((o) => o?.data?.partId).filter((id) => typeof id === "string" && id !== ""))];
        const res = await listParts(ids);
        if (res?.ok) partNames = Object.fromEntries((res.parts ?? []).filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name !== "").map((p) => [p.id, p.name]));
      } catch { partNames = {}; }
      return { orders, warehouses, truckNames, partNames };
    })()
      .then(({ orders, warehouses, truckNames, partNames }) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            transferOrderDocs: orders.items,
            warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, status: w.status ?? null, inScope: w.inScope !== false })),
            partNames,
            truckNames,
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
            partNames: {},
            truckNames: {},
            transferOrdersTruncated: false,
            warehousesTruncated: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // The readers are stable module functions unless a test injects them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessVersion, refreshKey]);

  return state;
}

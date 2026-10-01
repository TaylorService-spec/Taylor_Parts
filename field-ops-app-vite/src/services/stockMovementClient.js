// Stock relocation -- the EOS transport (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// WAS a thin httpsCallable transport over the Firebase `relocateStock` / `listStockMovementLocations` callables. The
// authority moved to PostgreSQL: POST /operations/relocation `relocateStock` (functions/src/eosOps/stockRelocationOperations.ts)
// decides custody, exact-source sufficiency, scope and idempotency; the screen's request shape is unchanged (the EOS
// validator mirrors the Firestore one). Warehouses come from eos_ops through listInventoryWarehouses.
//
// No Firebase fallback: a refusal (NOT_ACTIVATED included) is thrown as the platform's answer.
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";
import { fetchInventoryWarehouseOptions } from "./inventoryLocationClient.js";

export const STOCK_MOVEMENT_OPERATIONS = Object.freeze({ relocate: "relocateStock" });

export const stockMovementClient = Object.freeze({
  relocateStock: (request) => eosOperationOrThrow(EOS_OPERATIONS_ROUTES.RELOCATION, STOCK_MOVEMENT_OPERATIONS.relocate, request,
    { serviceLabel: "the stock movement service" }),
  /** The warehouses this operator may move stock in, from eos_ops (scope-filtered by the server). Shaped {id, name}. */
  listWarehouses: () => fetchInventoryWarehouseOptions().then((rows) => rows.map((w) => ({ id: w.id, name: w.name }))),
});

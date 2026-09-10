// Stock relocation -- thin httpsCallable transport over the BIN-P6 `relocateStock` command.
//
// Builds nothing and decides nothing: the server derives custody, checks the exact source and owns
// idempotency. `inventory.stock.relocate` is registered active:false and granted to no Role, so today
// every real call is refused server-side, and the screen renders that refusal as a refusal.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const STOCK_MOVEMENT_CALLABLES = Object.freeze({ relocate: "relocateStock", locations: "listStockMovementLocations" });

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

export const stockMovementClient = Object.freeze({
  relocateStock: (request) => call(STOCK_MOVEMENT_CALLABLES.relocate, request),
  /**
   * The warehouses this operator may move stock in -- from the server, not a client `warehouses` read
   * (Rules admit that read only for managers). Shaped as {id, name} for the screen's picker.
   */
  listWarehouses: () => call(STOCK_MOVEMENT_CALLABLES.locations, {})
    .then((res) => (res?.warehouses ?? []).map((w) => ({ id: w.warehouseId, name: w.name }))),
});

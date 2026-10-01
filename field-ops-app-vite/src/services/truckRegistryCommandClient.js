// TRUCK REGISTRY COMMANDS -- RETIRED from this workspace (Controller TRUCK INVENTORY ACTIVATION, 2026-10-01, OD-T7 / Package J).
//
// The nine Firebase truck callables (createTruckCallable .. deleteTruckCreatedInErrorCallable) are no longer called by this
// application. Truck and MOBILE-location registry administration is an Administration act on the governed PostgreSQL
// registry (Administration -> Warehouse racking -> Truck registry, gated on inventory.truckRegistry.manage), and who works
// from a truck is an Employee's MOBILE scope -- there is no truck "driver" field to assign any more (OD-T1).
//
// The client keeps its shape so the Truck Inventory workspace's (inert) management seam stays one code path: every
// command answers FAILED_PRECONDITION with the place the act now lives, and NOTHING is sent anywhere. No Firebase import.
import { fetchInventoryWarehouseOptions } from "./inventoryLocationClient.js";

export const TRUCK_REGISTRY_ADMINISTRATION_MOVED =
  "Truck registry changes are made in Administration → Warehouse racking → Truck registry. Truck assignment is an Employee's MOBILE scope.";

const moved = () => Promise.reject(Object.assign(new Error(TRUCK_REGISTRY_ADMINISTRATION_MOVED), { code: "failed-precondition" }));

export const truckRegistryCommandClient = Object.freeze({
  createTruck: moved,
  assignDriver: moved,
  reassignDriver: moved,
  unassignDriver: moved,
  changeStatus: moved,
  changeHomeWarehouse: moved,
  deactivateTruck: moved,
  reactivateTruck: moved,
  deleteTruckCreatedInError: moved,
});

/** Warehouse picker options from eos_ops (the caller's governed warehouses) -- `{ id, label }`, sorted by label. */
export async function fetchWarehouseOptions(call) {
  const rows = await fetchInventoryWarehouseOptions(call);
  return rows.map((w) => ({ id: w.id, label: w.name ?? w.id }))
    .filter((w) => typeof w.id === "string" && w.id !== "")
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

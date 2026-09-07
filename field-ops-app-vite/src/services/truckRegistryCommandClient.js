// EI Truck Registry (ADR-010 / Decision #60) -- the injectable CLIENT SEAM for the
// eight trusted write callables. Deliberately THIN (mirrors adminPasswordResetClient.js
// and reportExecutionSeam.js): it builds the EXACT request payload each merged callable
// expects and invokes it via httpsCallable, so `firebase` stays out of the unit tests
// and all outcome mapping stays in the pure domain (domain/truckManagement.js).
//
// Server-derived identity: actorUid is taken ONLY from request.auth.uid inside each
// callable -- it is NEVER part of any payload built here. There is NO generic "update"
// callable; each governed reason has its own command.
//
// NOT-DEPLOYED / FAIL-CLOSED: these callables are exported from functions/src/index.ts
// but not deployed. This client is only ever invoked when the write-readiness seam
// (config/truckManagementReadiness.js) is true; useTruckManagement guarantees ZERO
// invocations while readiness is false. This file performs no runtime probing.
import { httpsCallable } from "firebase/functions";
import { governedCollectionClient } from "../access/governedCollectionClient";
import { functions } from "../firebase/firebase";

// onCall export names (functions/src/index.ts), region bound by firebase.js.
export const TRUCK_CALLABLES = Object.freeze({
  create: "createTruckCallable",
  assign: "assignTruckDriverCallable",
  reassign: "reassignTruckDriverCallable",
  unassign: "unassignTruckDriverCallable",
  changeStatus: "changeTruckStatusCallable",
  changeHomeWarehouse: "changeTruckHomeWarehouseCallable",
  deactivate: "deactivateTruckCallable",
  reactivate: "reactivateTruckCallable",
  deleteCreatedInError: "deleteTruckCreatedInErrorCallable",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

// Each method sends ONLY the fields its callable reads (see truckRegistryCallables.ts).
// idempotencyKey + expectedVersion are supplied by the caller (useTruckManagement).
export const truckRegistryCommandClient = Object.freeze({
  createTruck: ({ idempotencyKey, truckId, locationId, homeWarehouseId, status, assignedDriverEmployeeId = null, displayLabel, vehicleNumber }) =>
    call(TRUCK_CALLABLES.create, { idempotencyKey, truckId, locationId, homeWarehouseId, status, assignedDriverEmployeeId, displayLabel, vehicleNumber }),

  assignDriver: ({ idempotencyKey, truckId, employeeId, expectedVersion }) =>
    call(TRUCK_CALLABLES.assign, { idempotencyKey, truckId, employeeId, expectedVersion }),

  reassignDriver: ({ idempotencyKey, truckId, employeeId, expectedVersion }) =>
    call(TRUCK_CALLABLES.reassign, { idempotencyKey, truckId, employeeId, expectedVersion }),

  unassignDriver: ({ idempotencyKey, truckId, expectedVersion }) =>
    call(TRUCK_CALLABLES.unassign, { idempotencyKey, truckId, expectedVersion }),

  changeStatus: ({ idempotencyKey, truckId, status, expectedVersion }) =>
    call(TRUCK_CALLABLES.changeStatus, { idempotencyKey, truckId, status, expectedVersion }),

  changeHomeWarehouse: ({ idempotencyKey, truckId, homeWarehouseId, expectedVersion }) =>
    call(TRUCK_CALLABLES.changeHomeWarehouse, { idempotencyKey, truckId, homeWarehouseId, expectedVersion }),

  deactivateTruck: ({ idempotencyKey, truckId, expectedVersion }) =>
    call(TRUCK_CALLABLES.deactivate, { idempotencyKey, truckId, expectedVersion }),

  reactivateTruck: ({ idempotencyKey, truckId, targetStatus, expectedVersion }) =>
    call(TRUCK_CALLABLES.reactivate, { idempotencyKey, truckId, targetStatus, expectedVersion }),

  // ADMIN-ONLY Created-in-Error hard delete. Sends the deletionReason; the trusted service
  // re-enforces admin-only + every safety check and fails closed on an unknown footprint.
  deleteTruckCreatedInError: ({ idempotencyKey, truckId, expectedVersion, deletionReason }) =>
    call(TRUCK_CALLABLES.deleteCreatedInError, { idempotencyKey, truckId, expectedVersion, deletionReason }),
});

// Bounded pick-list read for the home-warehouse selector: a governed read of the
// `warehouses` source, mapped to { id, label }. Only fetched when management is
// authorized AND write-ready (never in the current fail-closed production posture).
// Warehouse active/existence is authoritatively re-checked by the trusted service.
export async function fetchWarehouseOptions() {
  // GOVERNED, reusing the EXISTING warehouse.record.read -- already granted to the same population
  // the Rule admitted. No truck-flavoured capability: "may this person see the warehouses" does not
  // change because a truck form is what is asking.
  //
  // Paged to exhaustion. This is a selector: a truncated list silently removes warehouses a person
  // is entitled to choose, and the omission is invisible on screen.
  const options = [];
  let cursor = null;
  do {
    const outcome = await governedCollectionClient.readGovernedList({
      sourceId: "warehouseDirectory",
      pageSize: 200,
      cursor,
    });
    if (!outcome.ok) {
      // Throws like the getDocs it replaces, rather than returning [] -- an empty selector reads as
      // "this company has no warehouses" and would send someone looking for the wrong problem.
      const err = new Error("warehouse options read failed");
      err.code = outcome.result === "DENIED" ? "permission-denied" : "unavailable";
      throw err;
    }
    for (const row of outcome.items) options.push({ id: row.id, label: row?.name ?? row.id });
    cursor = outcome.nextCursor;
  } while (cursor);

  // Sorting stays CLIENT-SIDE and unchanged: the source orders by document id (what an unordered
  // Firestore read returned), and this selector has always sorted by label itself.
  return options
    .filter((w) => typeof w.id === "string" && w.id !== "")
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

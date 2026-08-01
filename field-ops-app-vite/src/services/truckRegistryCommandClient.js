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
import { collection, getDocs } from "firebase/firestore";
import { functions, db } from "../firebase/firebase";

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
});

// Bounded pick-list read for the home-warehouse selector: one-shot getDocs of the
// `warehouses` collection, mapped to { id, label }. Only fetched when management is
// authorized AND write-ready (never in the current fail-closed production posture).
// Warehouse active/existence is authoritatively re-checked by the trusted service.
export async function fetchWarehouseOptions() {
  const snap = await getDocs(collection(db, "warehouses"));
  return snap.docs
    .map((d) => ({ id: d.id, label: (d.data()?.name ?? d.id) }))
    .filter((w) => typeof w.id === "string" && w.id !== "")
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

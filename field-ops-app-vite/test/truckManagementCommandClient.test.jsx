// EI Truck Registry -- proves the thin command client sends the EXACT payload each merged
// callable reads, targets the right callable name, and NEVER includes actorUid (derived
// server-side from request.auth). firebase is fully mocked so no backend is touched.
import { describe, it, expect, beforeEach, vi } from "vitest";

const calls = [];
vi.mock("../src/firebase/firebase", () => ({ functions: {}, db: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions, name) => (payload) => {
    calls.push({ name, payload });
    return Promise.resolve({ data: { name } });
  },
}));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ name }),
  getDocs: async () => ({
    docs: [
      { id: "WH-2", data: () => ({ name: "Beta" }) },
      { id: "WH-1", data: () => ({ name: "Alpha" }) },
    ],
  }),
}));

import { truckRegistryCommandClient, fetchWarehouseOptions, TRUCK_CALLABLES } from "../src/services/truckRegistryCommandClient.js";

beforeEach(() => {
  calls.length = 0;
});

describe("truckRegistryCommandClient payloads", () => {
  it("createTruck -> createTruckCallable with the governed fields, actorUid never sent", async () => {
    await truckRegistryCommandClient.createTruck({
      idempotencyKey: "k", truckId: "T1", locationId: "L1", homeWarehouseId: "W1",
      status: "ACTIVE", displayLabel: "d", vehicleNumber: "v",
    });
    expect(calls[0].name).toBe(TRUCK_CALLABLES.create);
    expect(calls[0].payload).toEqual({
      idempotencyKey: "k", truckId: "T1", locationId: "L1", homeWarehouseId: "W1",
      status: "ACTIVE", assignedDriverEmployeeId: null, displayLabel: "d", vehicleNumber: "v",
    });
    expect("actorUid" in calls[0].payload).toBe(false);
  });

  it("mutation commands send truckId + expectedVersion (+ their governed arg) only", async () => {
    await truckRegistryCommandClient.assignDriver({ idempotencyKey: "k", truckId: "T", employeeId: "E", expectedVersion: 4 });
    expect(calls[0]).toEqual({ name: TRUCK_CALLABLES.assign, payload: { idempotencyKey: "k", truckId: "T", employeeId: "E", expectedVersion: 4 } });

    await truckRegistryCommandClient.unassignDriver({ idempotencyKey: "k", truckId: "T", expectedVersion: 4 });
    expect(calls[1]).toEqual({ name: TRUCK_CALLABLES.unassign, payload: { idempotencyKey: "k", truckId: "T", expectedVersion: 4 } });

    await truckRegistryCommandClient.changeStatus({ idempotencyKey: "k", truckId: "T", status: "IDLE", expectedVersion: 4 });
    expect(calls[2]).toEqual({ name: TRUCK_CALLABLES.changeStatus, payload: { idempotencyKey: "k", truckId: "T", status: "IDLE", expectedVersion: 4 } });

    await truckRegistryCommandClient.changeHomeWarehouse({ idempotencyKey: "k", truckId: "T", homeWarehouseId: "W2", expectedVersion: 4 });
    expect(calls[3]).toEqual({ name: TRUCK_CALLABLES.changeHomeWarehouse, payload: { idempotencyKey: "k", truckId: "T", homeWarehouseId: "W2", expectedVersion: 4 } });

    await truckRegistryCommandClient.deactivateTruck({ idempotencyKey: "k", truckId: "T", expectedVersion: 4 });
    expect(calls[4]).toEqual({ name: TRUCK_CALLABLES.deactivate, payload: { idempotencyKey: "k", truckId: "T", expectedVersion: 4 } });

    await truckRegistryCommandClient.reactivateTruck({ idempotencyKey: "k", truckId: "T", targetStatus: "ACTIVE", expectedVersion: 4 });
    expect(calls[5]).toEqual({ name: TRUCK_CALLABLES.reactivate, payload: { idempotencyKey: "k", truckId: "T", targetStatus: "ACTIVE", expectedVersion: 4 } });

    await truckRegistryCommandClient.deleteTruckCreatedInError({ idempotencyKey: "k", truckId: "T", expectedVersion: 4, deletionReason: "created in error" });
    expect(calls[6]).toEqual({ name: TRUCK_CALLABLES.deleteCreatedInError, payload: { idempotencyKey: "k", truckId: "T", expectedVersion: 4, deletionReason: "created in error" } });

    for (const c of calls) expect("actorUid" in c.payload).toBe(false);
  });

  it("fetchWarehouseOptions returns sorted { value/id, label } from a single read", async () => {
    const opts = await fetchWarehouseOptions();
    expect(opts).toEqual([
      { id: "WH-1", label: "Alpha" },
      { id: "WH-2", label: "Beta" },
    ]);
  });
});

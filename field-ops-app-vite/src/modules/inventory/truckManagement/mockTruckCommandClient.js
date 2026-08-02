// EI Truck Registry -- an in-memory MOCK of the trusted command client for the test-only
// visual preview and component tests. It imports NOTHING from firebase and can never reach
// production: it mutates a local store and mimics the governed invariants (version CAS ->
// conflict, duplicate id/location -> already-exists, missing truck -> not-found) so the UI's
// success and failure paths can be exercised without any backend. It is NEVER imported by
// the connected application (App.jsx wires the REAL truckRegistryCommandClient).
const INITIAL_VERSION = 1;

function fail(code) {
  // Shape mirrors a Firebase FunctionsError enough for domain/truckManagement's mapper
  // (which keys off the code suffix). `message` is intentionally sensitive-looking to prove
  // the UI never surfaces it.
  const err = new Error(`INTERNAL mock detail for ${code} — must never render`);
  err.code = `functions/${code}`;
  return err;
}

// A fresh mutable store. Seed with raw truck docs ({ docId, data }).
export function createTruckStore(seedTruckDocs = []) {
  const trucks = new Map();
  const locations = new Map();
  const claims = new Set();
  for (const doc of seedTruckDocs) {
    const data = { version: INITIAL_VERSION, ...doc.data };
    trucks.set(doc.docId, data);
    if (data.locationId) {
      locations.set(data.locationId, { locationId: data.locationId, type: "MOBILE", displayLabel: data.displayLabel ?? data.locationId, active: true });
      claims.add(data.locationId);
    }
  }
  return { trucks, locations, claims };
}

export function truckDocsFromStore(store) {
  return Array.from(store.trucks.entries()).map(([docId, data]) => ({ docId, data: { truckId: docId, ...data } }));
}

export function mobileLocationDocsFromStore(store) {
  return Array.from(store.locations.entries()).map(([docId, data]) => ({ docId, data }));
}

// Build the mock client bound to `store`. `options.forceError` (a code suffix) makes the
// NEXT command reject once -- used to demonstrate denied/unavailable/conflict states.
export function createMockTruckCommandClient(store, options = {}) {
  const state = { forceError: options.forceError ?? null };
  const maybeForce = () => {
    if (state.forceError) {
      const code = state.forceError;
      state.forceError = null;
      throw fail(code);
    }
  };
  const requireTruck = (truckId, expectedVersion) => {
    const data = store.trucks.get(truckId);
    if (!data) throw fail("not-found");
    if (typeof expectedVersion === "number" && data.version !== expectedVersion) throw fail("aborted");
    return data;
  };
  const bump = (truckId, patch) => {
    const data = store.trucks.get(truckId);
    const next = { ...data, ...patch, version: data.version + 1 };
    store.trucks.set(truckId, next);
    return { truckId, version: next.version };
  };

  return {
    setForceError: (code) => {
      state.forceError = code;
    },
    async createTruck({ truckId, locationId, homeWarehouseId, status, assignedDriverEmployeeId = null, displayLabel, vehicleNumber }) {
      maybeForce();
      if (store.trucks.has(truckId)) throw fail("already-exists");
      if (store.claims.has(locationId)) throw fail("already-exists");
      store.trucks.set(truckId, { version: INITIAL_VERSION, locationId, homeWarehouseId, status, assignedDriverEmployeeId, displayLabel, vehicleNumber });
      store.locations.set(locationId, { locationId, type: "MOBILE", displayLabel, active: true });
      store.claims.add(locationId);
      return { truckId, version: INITIAL_VERSION };
    },
    async assignDriver({ truckId, employeeId, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { assignedDriverEmployeeId: employeeId });
    },
    async reassignDriver({ truckId, employeeId, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { assignedDriverEmployeeId: employeeId });
    },
    async unassignDriver({ truckId, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { assignedDriverEmployeeId: null });
    },
    async changeStatus({ truckId, status, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { status });
    },
    async changeHomeWarehouse({ truckId, homeWarehouseId, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { homeWarehouseId });
    },
    async deactivateTruck({ truckId, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { status: "OUT_OF_SERVICE" });
    },
    async reactivateTruck({ truckId, targetStatus, expectedVersion }) {
      maybeForce();
      requireTruck(truckId, expectedVersion);
      return bump(truckId, { status: targetStatus });
    },
  };
}

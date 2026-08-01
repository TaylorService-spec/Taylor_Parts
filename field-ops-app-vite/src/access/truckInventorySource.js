// EI-P1d-1 -- the injectable read seam for the Truck Inventory workspace. It authors NO
// persistence, NO stock authority, NO reads of operationsQueries or any Firestore
// collection, and NO stock calculation. The governed Truck Inventory view (fleet + per-
// truck inventory/manifest/reconciliation/activity) is an Enterprise Inventory concern that
// does NOT exist yet, so the DEFAULT source is INERT: it reports an honest "not connected"
// state and returns no trucks -- never fabricated production inventory. When the governed
// view ships (a later, separately authorized gate) a real source is injected here with no
// change to the consuming UI, which composes view-models via the pure truckInventoryView.
//
// Mirrors the serializedAssetSource seam (INV-EQ-P1b) exactly.

export const TRUCK_INVENTORY_SOURCE_STATUS = Object.freeze({
  UNAVAILABLE: "unavailable", // no governed Truck Inventory view connected yet (the honest default today)
  DENIED: "denied",
  READY: "ready",
});

// The inert default. `connected: false` is what the workspace renders as the honest
// not-yet-connected surface; `trucks: []` guarantees no fabricated inventory.
export const inertTruckInventorySource = Object.freeze({
  connected: false,
  status: TRUCK_INVENTORY_SOURCE_STATUS.UNAVAILABLE,
  trucks: [],
});

// Normalize any injected source (or the inert default) into a stable shape the workspace
// can consume. Fail-closed: an unknown/missing source, or a READY claim without the
// connected flag, is treated as unavailable and yields no trucks.
export function readTruckInventorySource(source = inertTruckInventorySource) {
  if (!source || typeof source !== "object") {
    return { ...inertTruckInventorySource };
  }
  const status = Object.values(TRUCK_INVENTORY_SOURCE_STATUS).includes(source.status)
    ? source.status
    : TRUCK_INVENTORY_SOURCE_STATUS.UNAVAILABLE;
  const connected = source.connected === true && status === TRUCK_INVENTORY_SOURCE_STATUS.READY;
  const trucks = connected && Array.isArray(source.trucks) ? source.trucks : [];
  return { connected, status, trucks };
}

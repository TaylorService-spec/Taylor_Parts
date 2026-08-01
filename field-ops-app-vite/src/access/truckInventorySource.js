// EI-P1d-1 -- the injectable read seam for the Truck Inventory workspace. It authors NO
// persistence, NO stock authority, NO reads of operationsQueries or any Firestore
// collection, and NO stock calculation. The governed Truck Inventory view (fleet + per-
// truck inventory/manifest/reconciliation/activity + governed pick-lists) is an Enterprise
// Inventory concern that does NOT exist yet, so the DEFAULT source is INERT: it reports an
// honest "not connected" state and returns no trucks -- never fabricated production
// inventory. When the governed view ships (a later, separately authorized gate) a real
// source is injected here with no change to the consuming UI, which composes view-models
// via the pure truckInventoryView.
//
// Mirrors the serializedAssetSource seam (INV-EQ-P1b), extended with LOADING/ERROR states
// and an access-version boundary key.

export const TRUCK_INVENTORY_SOURCE_STATUS = Object.freeze({
  UNAVAILABLE: "unavailable", // no governed Truck Inventory view connected yet (the honest default today)
  LOADING: "loading", // a governed read is in flight (or a prior-version READY is being re-scoped)
  ERROR: "error", // the governed read failed -- a SANITIZED, message-less state
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
// consumes. Fail-closed on every axis:
//   * an unknown/missing source or status -> unavailable;
//   * an ERROR source is reduced to a message-less state (no raw error is ever surfaced);
//   * a READY claim without `connected: true` -> unavailable;
//   * BOUNDARY KEY: a READY source tagged for a DIFFERENT access version than `boundaryKey`
//     is stale and becomes LOADING -- so prior-scope fleet/detail data disappears
//     synchronously on an access change and cannot reappear until a source for the current
//     access version is supplied.
export function readTruckInventorySource(source = inertTruckInventorySource, boundaryKey) {
  if (!source || typeof source !== "object") {
    return { connected: false, status: TRUCK_INVENTORY_SOURCE_STATUS.UNAVAILABLE, trucks: [], options: null };
  }
  const status = Object.values(TRUCK_INVENTORY_SOURCE_STATUS).includes(source.status)
    ? source.status
    : TRUCK_INVENTORY_SOURCE_STATUS.UNAVAILABLE;
  const options = source.options && typeof source.options === "object" ? source.options : null;

  if (status === TRUCK_INVENTORY_SOURCE_STATUS.LOADING) {
    return { connected: false, status, trucks: [], options };
  }
  if (status === TRUCK_INVENTORY_SOURCE_STATUS.ERROR) {
    // Never carry a raw error object/message forward.
    return { connected: false, status, trucks: [], options: null };
  }
  if (status === TRUCK_INVENTORY_SOURCE_STATUS.DENIED) {
    return { connected: false, status, trucks: [], options };
  }
  if (status === TRUCK_INVENTORY_SOURCE_STATUS.READY) {
    if (boundaryKey !== undefined && source.accessVersion !== boundaryKey) {
      // Stale READY data for a prior access version -> loading until a matching source arrives.
      return { connected: false, status: TRUCK_INVENTORY_SOURCE_STATUS.LOADING, trucks: [], options };
    }
    if (source.connected !== true) {
      return { connected: false, status: TRUCK_INVENTORY_SOURCE_STATUS.UNAVAILABLE, trucks: [], options };
    }
    return { connected: true, status, trucks: Array.isArray(source.trucks) ? source.trucks : [], options };
  }
  return { connected: false, status: TRUCK_INVENTORY_SOURCE_STATUS.UNAVAILABLE, trucks: [], options };
}

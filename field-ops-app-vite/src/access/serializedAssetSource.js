// INV-EQ-P1b -- the injectable read seam for Available Equipment (Serialized Assets
// available for assignment). It authors NO persistence, NO stock authority, and NO
// Serialized Asset store. The registry is an Enterprise Inventory Phase 1/2 concern
// that does NOT exist yet, so the DEFAULT source is INERT: it reports an honest
// "not connected" state and returns no assets -- never fabricated inventory. When the
// registry ships (a later, separately authorized gate) a real source is injected here
// with no change to the consuming UI (which composes rows via the merged pure P1a
// selectAvailableSerializedAssets).

export const SERIALIZED_ASSET_SOURCE_STATUS = Object.freeze({
  UNAVAILABLE: "unavailable", // no registry connected yet (the honest default today)
  DENIED: "denied",
  READY: "ready",
});

// The inert default. `connected: false` is what the tab renders as the honest
// not-yet-connected surface; `assets: []` guarantees no fabricated inventory.
export const inertSerializedAssetSource = Object.freeze({
  connected: false,
  status: SERIALIZED_ASSET_SOURCE_STATUS.UNAVAILABLE,
  assets: [],
});

// Normalize any injected source (or the inert default) into a stable shape the tab
// can consume. Fail-closed: an unknown/missing source is treated as unavailable.
export function readSerializedAssetSource(source = inertSerializedAssetSource) {
  if (!source || typeof source !== "object") {
    return { ...inertSerializedAssetSource };
  }
  const status = Object.values(SERIALIZED_ASSET_SOURCE_STATUS).includes(source.status)
    ? source.status
    : SERIALIZED_ASSET_SOURCE_STATUS.UNAVAILABLE;
  const connected = source.connected === true && status === SERIALIZED_ASSET_SOURCE_STATUS.READY;
  const assets = connected && Array.isArray(source.assets) ? source.assets : [];
  return { connected, status, assets };
}

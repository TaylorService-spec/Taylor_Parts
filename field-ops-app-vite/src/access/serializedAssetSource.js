// INV-EQ-P1b -- the injectable read seam for Available Equipment (Serialized Assets
// available for assignment). It authors NO persistence, NO stock authority, and NO
// Serialized Asset store.
//
// Sandbox-fidelity fix (Part 3): the registry now EXISTS -- the trusted
// `getAvailableEquipment` callable (functions/src/serializedAsset/serializedAssetReadService.ts)
// and SERIAL receiving both shipped in Wave 7. hooks/useAvailableEquipmentSource.js is the REAL
// default source: it invokes that governed read (services/serializedAssetReadCallableClient.js) and
// maps the result through this same {connected, status, assets} shape. `inertSerializedAssetSource`
// below is now TEST-ONLY (see its own comment) -- normal runtime never falls back to it silently; a
// denied or unavailable governed read renders its own honest DENIED/UNAVAILABLE state instead.
export const SERIALIZED_ASSET_SOURCE_STATUS = Object.freeze({
  LOADING: "loading", // the governed read is in flight
  UNAVAILABLE: "unavailable", // the governed read failed for a reason other than denial (fail closed)
  DENIED: "denied",
  READY: "ready",
});

// TEST-ONLY. Not used as the live default anywhere in normal runtime (see
// hooks/useAvailableEquipmentSource.js) -- kept only so domain/render tests can exercise the
// UNAVAILABLE/empty-inventory path without a network call. `connected: false` is what the tab
// renders as its honest not-connected surface; `assets: []` guarantees no fabricated inventory.
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

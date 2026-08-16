// PART 11A -- the injectable read seam for the location-DISPLAY resolver (id -> { type, label }).
// Mirrors access/serializedAssetSource.js exactly. It authors NO persistence, NO location authority,
// and NO fabricated label/type -- it only normalizes an injected governed-read result (or the inert
// default) into a stable shape.
export const LOCATION_DISPLAY_SOURCE_STATUS = Object.freeze({
  LOADING: "loading", // the governed read is in flight
  UNAVAILABLE: "unavailable", // the governed read failed for a reason other than denial (fail closed)
  DENIED: "denied",
  READY: "ready",
});

// The inert default. `connected: false` is what a consumer renders as the honest not-connected
// surface; `displayMap: empty Map` guarantees no fabricated location label.
export const inertLocationDisplaySource = Object.freeze({
  connected: false,
  status: LOCATION_DISPLAY_SOURCE_STATUS.UNAVAILABLE,
  displayMap: new Map(),
});

// Normalize any injected source (or the inert default) into a stable shape. Fail-closed: an
// unknown/missing source, or a READY source not carrying `connected: true`, is treated as
// unavailable; `displayMap` is always a Map (never trusted from an untyped injected value).
export function readLocationDisplaySource(source = inertLocationDisplaySource) {
  if (!source || typeof source !== "object") {
    return { connected: false, status: LOCATION_DISPLAY_SOURCE_STATUS.UNAVAILABLE, displayMap: new Map() };
  }
  const status = Object.values(LOCATION_DISPLAY_SOURCE_STATUS).includes(source.status)
    ? source.status
    : LOCATION_DISPLAY_SOURCE_STATUS.UNAVAILABLE;
  const connected = source.connected === true && status === LOCATION_DISPLAY_SOURCE_STATUS.READY;
  const displayMap = connected && source.displayMap instanceof Map ? source.displayMap : new Map();
  return { connected, status, displayMap };
}

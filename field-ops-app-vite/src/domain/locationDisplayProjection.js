// PART 11A -- pure domain layer resolving the raw `currentLocationId` scalars Available Equipment's
// governed projection surfaces (see domain/availableEquipmentGovernedProjection.js's header: "no
// friendly label/type exists" at that layer) into a governed display label, via the trusted
// getLocationDisplay read (functions/src/inventoryLocation/locationDisplayReadService.ts).
// PURE: no firebase, no persistence, no network. Node-importable and unit-tested directly.
//
// `type` is NEVER fabricated here (mirrors the backend service's own invariant): a location id the
// resolver could not place in WAREHOUSE or MOBILE stays UNRESOLVED with label null, and this module
// never guesses a friendlier value for it.
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export const LOCATION_DISPLAY_TYPES = Object.freeze(["WAREHOUSE", "MOBILE", "UNRESOLVED"]);

export const LOCATION_DISPLAY_STATE = Object.freeze({
  LOADING: "loading", // the governed read is in flight
  UNAVAILABLE: "unavailable", // the governed read failed for a reason other than denial (fail closed)
  DENIED: "denied",
  EMPTY: "empty", // connected, but NONE of the requested ids resolved to a real WAREHOUSE/MOBILE label
  READY: "ready", // connected, at least one id resolved to a real label
});

// Distinct, non-null raw location ids present on the (already-mapped) Available Equipment asset
// rows (domain/availableEquipmentGovernedProjection.js's `location` field) -- the exact, bounded set
// this module needs to resolve. Never over-requests: only ids actually present on today's rows.
export function distinctLocationIds(assets) {
  if (!Array.isArray(assets)) return [];
  const seen = new Set();
  for (const asset of assets) {
    if (isPlainObject(asset) && isNonEmptyString(asset.location)) seen.add(asset.location);
  }
  return [...seen];
}

// Maps ONE raw entry from the callable's envelope ({ locationId, type, label }) into a validated
// { type, label } pair, or null if malformed -- fail closed, never fabricated. `type` must be one of
// the three governed values; WAREHOUSE/MOBILE require a non-empty label; UNRESOLVED requires label
// to be exactly null (never a fabricated string).
function normalizeDisplayEntry(entry) {
  if (!isPlainObject(entry) || !isNonEmptyString(entry.locationId)) return null;
  if (!LOCATION_DISPLAY_TYPES.includes(entry.type)) return null;
  if (entry.type === "UNRESOLVED") {
    return entry.label === null ? { locationId: entry.locationId, type: "UNRESOLVED", label: null } : null;
  }
  return isNonEmptyString(entry.label) ? { locationId: entry.locationId, type: entry.type, label: entry.label } : null;
}

// Maps the callable's raw envelope ({ status: "ready", locations: [...] }) into a
// Map<locationId, { type, label }>. A non-"ready" status, missing/malformed envelope, or non-array
// `locations` yields an EMPTY map (fail closed) -- never throws, never fabricates an entry.
export function mapLocationDisplayResultToMap(rawResult) {
  const out = new Map();
  if (!isPlainObject(rawResult) || rawResult.status !== "ready" || !Array.isArray(rawResult.locations)) return out;
  for (const raw of rawResult.locations) {
    const entry = normalizeDisplayEntry(raw);
    if (entry) out.set(entry.locationId, entry);
  }
  return out;
}

// Merge resolved display labels onto the (already-mapped) asset rows. Sets `locationLabel` ONLY when
// the row's raw `location` id resolved to a governed WAREHOUSE/MOBILE label; an UNRESOLVED or
// unresolved-at-all id leaves the row exactly as it was (composeAvailableRow's existing fallback to
// the raw id keeps rendering it -- never blanked, never guessed). Pure: returns a NEW array, never
// mutates the input rows.
export function applyLocationDisplay(assets, displayMap) {
  if (!Array.isArray(assets)) return [];
  const map = displayMap instanceof Map ? displayMap : new Map();
  return assets.map((asset) => {
    if (!isPlainObject(asset) || !isNonEmptyString(asset.location)) return asset;
    const entry = map.get(asset.location);
    if (!entry || entry.type === "UNRESOLVED") return asset;
    return { ...asset, locationLabel: entry.label };
  });
}

// Coarse render state from the injected source status + the resolved/requested counts (fail-closed;
// mirrors availableEquipmentCatalogView.js's deriveAvailableState convention). `requestedCount` is
// the number of distinct location ids that needed resolving; `resolvedCount` is how many resolved to
// a real (non-UNRESOLVED) label. Zero requested ids (no assets carry a location at all) is READY --
// this module simply had nothing to resolve, which is not a failure.
export function deriveLocationDisplayState({ sourceStatus = LOCATION_DISPLAY_STATE.UNAVAILABLE, requestedCount = 0, resolvedCount = 0 } = {}) {
  if (requestedCount === 0) return LOCATION_DISPLAY_STATE.READY;
  if (sourceStatus === LOCATION_DISPLAY_STATE.LOADING) return LOCATION_DISPLAY_STATE.LOADING;
  if (sourceStatus === LOCATION_DISPLAY_STATE.DENIED) return LOCATION_DISPLAY_STATE.DENIED;
  if (sourceStatus !== LOCATION_DISPLAY_STATE.READY) return LOCATION_DISPLAY_STATE.UNAVAILABLE;
  return resolvedCount > 0 ? LOCATION_DISPLAY_STATE.READY : LOCATION_DISPLAY_STATE.EMPTY;
}

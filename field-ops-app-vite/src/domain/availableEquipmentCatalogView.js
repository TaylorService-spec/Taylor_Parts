// INV-EQ-P1b -- pure, node-testable catalog-style filter composition for the
// Available Equipment tab (Serialized Assets available for assignment). Mirrors the
// Parts-catalog search/filter shape over GOVERNED available-asset fields: internal
// identifier, type/category, manufacturer, model, condition/status, and warehouse/
// truck location. There is deliberately NO customer/account filter here -- Available
// Equipment is company inventory, not customer-installed. PURE: no firebase, no
// persistence; it only filters/derives over an injected array of available-asset
// records (the inert default source yields none). "Available" is first established by
// the merged pure P1a selectAvailableSerializedAssets, so an installed or non-
// available unit can never appear regardless of filters.
import { selectAvailableSerializedAssets } from "./serializedAssetInstallation.js";

// Filters/search apply to available inventory only; NO customer filter exists here.
export const AVAILABLE_FILTER_NOTE =
  "Search and filters apply to available inventory. Available Equipment has no customer filter.";

export const AVAILABLE_FILTER_KEYS = Object.freeze(["term", "category", "manufacturer", "model", "status", "location"]);

export const AVAILABLE_STATE = Object.freeze({
  UNAVAILABLE: "unavailable", // registry not connected (honest default)
  DENIED: "denied",
  EMPTY: "empty", // connected, but nothing available (or filters exclude all)
  READY: "ready",
});

function str(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// Safe display row for one available asset. Internal identifier prefers an explicit
// internalPartNumber, falling back to partId; condition/status accepts either field.
// (Available Equipment is an internal admin/dispatcher surface, so internal
// identifiers are appropriate here; no supplier identifiers are exposed.)
export function composeAvailableRow(asset) {
  return {
    serialNo: asset.serialNo,
    internalIdentifier: str(asset.internalPartNumber) || str(asset.partId),
    category: str(asset.category) || str(asset.type),
    manufacturer: str(asset.manufacturer),
    model: str(asset.model),
    status: str(asset.status) || str(asset.condition),
    location: str(asset.locationLabel) || str(asset.location),
  };
}

// Only genuinely-available serials become rows (P1a gate first), then compose.
export function composeAvailableRows(assets) {
  return selectAvailableSerializedAssets(Array.isArray(assets) ? assets : []).map(composeAvailableRow);
}

// Distinct, sorted option lists for the select filters -- built from the LOADED
// available rows (never a global catalog).
export function buildAvailableFilterOptions(assets) {
  const rows = composeAvailableRows(assets);
  const distinct = (key) => Array.from(new Set(rows.map((r) => r[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return {
    categories: distinct("category"),
    manufacturers: distinct("manufacturer"),
    models: distinct("model"),
    statuses: distinct("status"),
    locations: distinct("location"),
  };
}

// Combined AND filtering over available rows. Equality on category/manufacturer/model/
// status/location; `term` is a case-insensitive substring over internal identifier,
// serial, model, and manufacturer. An unknown filter key is ignored (never broadens).
export function applyAvailableFilters(assets, filters = {}) {
  let rows = composeAvailableRows(assets);
  const f = filters && typeof filters === "object" ? filters : {};
  for (const key of ["category", "manufacturer", "model", "status", "location"]) {
    const want = str(f[key]);
    if (want) rows = rows.filter((r) => r[key] === want);
  }
  const term = str(f.term);
  if (term) {
    const t = term.toLowerCase();
    rows = rows.filter((r) =>
      [r.internalIdentifier, r.serialNo, r.model, r.manufacturer].some(
        (x) => typeof x === "string" && x.toLowerCase().includes(t),
      ),
    );
  }
  return rows;
}

// Whether any filter is active (for clear/remove affordances).
export function anyAvailableFilterActive(filters = {}) {
  const f = filters && typeof filters === "object" ? filters : {};
  return AVAILABLE_FILTER_KEYS.some((k) => str(f[k]) !== null);
}

// Coarse render state from the injected source status + counts (fail-closed).
export function deriveAvailableState({ sourceStatus = AVAILABLE_STATE.UNAVAILABLE, totalAvailable = 0, filteredCount = 0 } = {}) {
  if (sourceStatus === AVAILABLE_STATE.DENIED) return AVAILABLE_STATE.DENIED;
  if (sourceStatus !== AVAILABLE_STATE.READY) return AVAILABLE_STATE.UNAVAILABLE;
  if (totalAvailable === 0) return AVAILABLE_STATE.EMPTY;
  if (filteredCount === 0) return AVAILABLE_STATE.EMPTY;
  return AVAILABLE_STATE.READY;
}

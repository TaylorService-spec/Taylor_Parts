// Pure view helpers over the trusted getManufacturerCatalog read result. No Firebase, no I/O.

export const MANUFACTURER_CATALOG_VIEW_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  READY: "READY",
});

// Honest state classification, mirroring domain/salesOrderView.js's pattern: DENIED and
// UNAVAILABLE are distinct from a genuinely empty catalog, and never collapse to it.
export function manufacturerCatalogViewState({ loading, errorStatus, result }) {
  if (loading) return MANUFACTURER_CATALOG_VIEW_STATE.LOADING;
  if (errorStatus === "denied") return MANUFACTURER_CATALOG_VIEW_STATE.DENIED;
  if (errorStatus === "unavailable" || !result) return MANUFACTURER_CATALOG_VIEW_STATE.UNAVAILABLE;
  return MANUFACTURER_CATALOG_VIEW_STATE.READY;
}

// A lookup map (manufacturerId -> name) for display purposes -- e.g. Part Detail showing a
// Manufacturer NAME instead of the opaque manufacturerId. Empty when the read isn't READY;
// callers degrade to the raw id (never fabricate a name from an unresolved read).
export function manufacturerNameById(manufacturers) {
  const map = new Map();
  if (!Array.isArray(manufacturers)) return map;
  for (const m of manufacturers) {
    if (m && typeof m.manufacturerId === "string" && typeof m.name === "string") {
      map.set(m.manufacturerId, m.name);
    }
  }
  return map;
}

// Options for a governed Manufacturer picker (id -> label), sorted by name. Only ACTIVE
// manufacturers are offered for NEW selection (a part may still reference an INACTIVE one
// it was already linked to -- that's a display concern, not a picker-options concern).
export function manufacturerPickerOptions(manufacturers) {
  if (!Array.isArray(manufacturers)) return [];
  return manufacturers
    .filter((m) => m && m.status === "ACTIVE")
    .map((m) => ({ value: m.manufacturerId, label: m.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

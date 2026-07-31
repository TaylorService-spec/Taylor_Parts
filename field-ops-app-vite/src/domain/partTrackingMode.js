// Enterprise Inventory -- EI-P1a pure Part TRACKING-MODE contract.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no ledger, no
// quantities. It only classifies HOW a Part's physical units are tracked, which
// gates whether a Serialized Asset identity may exist at all (see
// serializedAssetIdentity.js). Node-importable and unit-tested directly
// (test/partTrackingMode.test.mjs), matching this repo's "pure logic lives in
// domain/" convention (equipmentModel.js, serializedAssetInstallation.js).
//
// FAIL CLOSED: a missing or unknown tracking mode is NEVER silently coerced, and
// in particular NEVER implicitly becomes SERIAL -- the strictest posture, so a
// malformed Part can never mint serialized assets by accident. Only the exact
// canonical uppercase tokens are valid; lowercase, padded, or foreign values are
// treated as unknown and rejected (no case/format coercion that could mask bad data).
//
// This is the Part-classification contract only. It is NOT the richer Part Master
// controlType field (partMasterView.js) and it authors no descriptive Part authority.

// The three tracking modes. NONE = untracked/bulk (no unit identity); SERIAL = each
// physical unit is uniquely serialized; LOT = units are grouped by lot/batch.
export const PART_TRACKING_MODES = Object.freeze(["NONE", "SERIAL", "LOT"]);

// Exact, canonical membership. Anything that is not one of the frozen tokens above
// -- including undefined, null, numbers, "serial", " SERIAL ", or "SERIALIZED" -- is
// unknown and fails closed.
export function isTrackingMode(value) {
  return typeof value === "string" && PART_TRACKING_MODES.includes(value);
}

// Normalize to the canonical mode, or null when unknown/missing. This performs NO
// coercion (no trim, no upper-casing): it only accepts a value that is ALREADY the
// exact contract token, so an unrecognized value can never be normalized into validity.
export function normalizeTrackingMode(value) {
  return isTrackingMode(value) ? value : null;
}

// Structured validation result mirroring equipmentModel.js: { valid, value, reason }.
// `value` is the canonical mode on success and null on failure.
export function validateTrackingMode(value) {
  return isTrackingMode(value)
    ? { valid: true, value, reason: null }
    : { valid: false, value: null, reason: value === undefined || value === null ? "missing" : "unknown" };
}

// True ONLY for an exact SERIAL mode. Missing/unknown -> false (never assumed serial).
// This is the single gate the Serialized Asset identity contract consults.
export function isSerialTracked(value) {
  return normalizeTrackingMode(value) === "SERIAL";
}

// True ONLY for an exact LOT mode. Missing/unknown -> false.
export function isLotTracked(value) {
  return normalizeTrackingMode(value) === "LOT";
}

// True ONLY for an exact NONE mode. Missing/unknown -> false (unknown is NOT "none").
export function isUntracked(value) {
  return normalizeTrackingMode(value) === "NONE";
}

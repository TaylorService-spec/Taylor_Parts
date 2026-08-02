// EI-P2a -- pure, deterministic, persistence-NEUTRAL contract for a LEDGER-DERIVED serialized-asset
// current-state row, plus a MOBILE-location projection adapter feeding the merged
// mobileLocationInventoryProjection serializedAssets section.
//
// GOVERNANCE (Owner ratified B2): the single append-only Inventory Ledger is the SOLE movement
// authority. This module defines the DERIVED read-model row shape + a pure adapter only -- it does
// NOT persist, read, write, move, reserve, calculate availability, infer custody, or mutate. No
// collection, document key, trusted command, Rules, or index is decided here (persistence naming and
// keys are DEFERRED -- see the PR/report). Equipment/{id} remains the customer-installation authority
// and is never touched: an INSTALLED (currentEquipmentId-linked) asset is customer equipment, NOT
// truck inventory, and is excluded here.
//
// The row reuses the merged pure contracts: validateSerializedAssetIdentity (identity + SERIAL
// eligibility against the injected Part authority + ledger-derived lifecycle state + INSTALLED<->link
// coupling) and validateLocationRef (the canonical { type, locationId } inventory-location reference).
// It carries lifecycle `state` ONLY (SERIALIZED_ASSET_STATES); NO Condition field/enum and NO second
// generic status are introduced in this slice.

import { validateSerializedAssetIdentity, SERIALIZED_ASSET_STATES } from "./serializedAssetIdentity.js";
import { validateLocationRef } from "./inventoryLocation.js";

const MOBILE = "MOBILE";

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Re-exported for callers composing the projection with governed lifecycle-state gating.
export { SERIALIZED_ASSET_STATES };

// Validate one LEDGER-DERIVED serialized-asset current-state row for INVENTORY use, against the
// injected Part authority. Returns { valid, value, reason }. `value` carries ONLY the governed,
// ledger-derived facts needed to place the unit as inventory:
//   { serialNo, partId, inventoryLocation: { type, locationId }, state }
// Fails closed on: any identity failure (unknown field incl. a smuggled `condition`, invalid
// serial/part, non-SERIAL Part, invalid location ref, invalid/unknown lifecycle state, or a
// contradictory INSTALLED<->link read) AND on an INSTALLED or currently-linked unit (that is
// customer-installed equipment, never truck inventory).
export function validateSerializedAssetInventoryRow(asset, part) {
  const id = validateSerializedAssetIdentity(asset, part);
  if (!id.valid) return { valid: false, value: null, reason: id.reason };
  // Canonical inventory-location reference (explicit; identity already applied validateLocationRef).
  const loc = validateLocationRef(id.value.currentLocation);
  if (!loc.valid) return { valid: false, value: null, reason: "inventory_location_invalid" };
  // Separation: INSTALLED / currently-linked units are customer equipment, not truck inventory.
  if (id.value.state === "INSTALLED" || id.value.currentEquipmentId !== null) {
    return { valid: false, value: null, reason: "installed_not_inventory" };
  }
  return {
    valid: true,
    value: {
      serialNo: id.value.serialNo,
      partId: id.value.partId,
      inventoryLocation: loc.value, // { type, locationId } -- ledger-derived reference only
      state: id.value.state, // ledger-derived lifecycle state (never INSTALLED here)
    },
    reason: null,
  };
}

export function isSerializedAssetInventoryRow(asset, part) {
  return validateSerializedAssetInventoryRow(asset, part).valid;
}

// Map a validated inventory row to the merged serializedAssets section item shape consumed by
// mobileLocationInventoryProjection's normalizeSerializedRow. The lifecycle `state` is placed in the
// single governed `status` slot (gated downstream against the injected SERIALIZED_ASSET_STATES
// pick-list); NO condition is set (it is never invented). Descriptive Part fields (internalSku /
// manufacturer / model) are a separate Part-authority join and are left null in this slice.
function toSectionItem(row) {
  return {
    assetId: null,
    internalSku: null,
    manufacturer: null,
    model: null,
    serial: row.serialNo,
    status: row.state, // lifecycle state == the governed status; NOT a second status field
    currentLocation: null,
  };
}

// Pure MOBILE serialized-assets projection adapter. From INJECTED records only (each a
// { asset, part } pair), produce the serializedAssets SOURCE shape
// { status, accessVersion, locationId, items } that mobileLocationInventoryProjection consumes.
// Includes ONLY valid, non-INSTALLED assets whose ledger-derived inventoryLocation is exactly the
// requested MOBILE location. Fails closed: a malformed request (blank locationId/accessVersion) ->
// an ERROR source with null items; malformed / installed / linked / wrong-location records are
// dropped and can never surface. Performs NO reads, writes, movement, availability calc, custody
// inference, or mutation, and does not mutate its inputs.
export function projectMobileSerializedAssets({ records, locationId, accessVersion, status = "ready" } = {}) {
  const accessVersionOk = isNonEmptyString(accessVersion);
  if (!isNonEmptyString(locationId) || !accessVersionOk) {
    return { status: "error", accessVersion: accessVersionOk ? accessVersion : null, locationId: null, items: null };
  }
  const list = Array.isArray(records) ? records : [];
  const items = [];
  for (const rec of list) {
    if (!isPlainObject(rec)) continue;
    const row = validateSerializedAssetInventoryRow(rec.asset, rec.part);
    if (!row.valid) continue; // malformed / installed / linked dropped
    const loc = row.value.inventoryLocation;
    if (loc.type !== MOBILE || loc.locationId !== locationId) continue; // wrong-location never surfaces
    items.push(toSectionItem(row.value));
  }
  return { status, accessVersion, locationId, items };
}

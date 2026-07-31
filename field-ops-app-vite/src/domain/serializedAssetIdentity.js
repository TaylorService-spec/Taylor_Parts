// Enterprise Inventory -- EI-P1a pure Serialized Asset IDENTITY contract + the
// Available Equipment PROJECTION composition.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no quantities, no
// availability CALCULATION, no ledger. It only (1) validates the governed identity of
// one serialized unit -- whose Part must be SERIAL-tracked per the INJECTED Part
// authority -- and (2) composes the read-only Available Equipment projection from
// injected authorities whose ids must agree. Node-importable and unit-tested directly
// (test/serializedAssetIdentity.test.mjs).
//
// GOVERNANCE (durable): the Serialized Asset lifecycle states below are the Rev 6
// Specification set (docs/specifications/serialized-asset-equipment-installation.md,
// ADR-010 + DECISIONS #59). EI-P1a neither adds, renames, nor removes lifecycle states,
// and it introduces NO condition/disposition enum -- that is a separate, later business
// decision and is deliberately absent here.
//
// AUTHORITY SEPARATION (the core invariant this contract enforces):
//   * Serialized Asset identity holds ONLY governed unit fields: serialNo, partId, a
//     ledger-derived Location REFERENCE (currentLocation), the ledger-derived lifecycle
//     `state`, and the nullable active Equipment link. It NEVER stores Part authority
//     (trackingMode / internalPartNumber / category / type / manufacturer / model) nor
//     any availability/reservation read decision.
//   * SERIAL eligibility is validated AGAINST the injected Part authority (which owns
//     trackingMode) -- it is never copied onto the asset.
//   * Availability (availableForAssignment) is a ledger/reservation-DERIVED read
//     decision. It is accepted as an explicitly injected input that GATES the Available
//     Equipment projection; it is never a canonical identity field.
//   * The Available Equipment projection is a DERIVED read view that MAY combine the
//     authorities, but only after requiring their ids to match; any mismatch, malformed
//     input, or absent availability fails closed rather than fabricating a joined row.
import { isSerialTracked, isTrackingMode } from "./partTrackingMode.js";
import { validateLocationRef, isLocationType } from "./inventoryLocation.js";

// Rev 6 Specification lifecycle STATE of a serialized unit (a ledger-derived read, not a
// quantity and not the availability decision). Bounded, ordered as the spec lists them,
// and fail-closed. Note AVAILABLE (a lifecycle state) is distinct from the separately
// injected availableForAssignment reservation decision.
export const SERIALIZED_ASSET_STATES = Object.freeze([
  "RECEIVED",
  "AVAILABLE",
  "RESERVED",
  "STAGED",
  "LOADED",
  "IN_TRANSIT",
  "DELIVERED",
  "INSTALLED",
]);

// The exact governed fields the identity contract owns. Extras are rejected so Part
// authority or a read decision can never be smuggled onto a Serialized Asset.
const IDENTITY_FIELDS = new Set(["serialNo", "partId", "currentLocation", "state", "currentEquipmentId"]);

// The descriptive fields Part Master SUPPLIES to the projection (keyed by partId).
// trackingMode is Part authority and is required so SERIAL eligibility can be validated
// against it -- it is consumed here, never stored on the asset.
const PART_FIELDS = new Set(["partId", "trackingMode", "internalPartNumber", "category", "type", "manufacturer", "model"]);

// The fields the Location authority SUPPLIES to the projection (keyed by locationId).
const LOCATION_DISPLAY_FIELDS = new Set(["locationId", "type", "label"]);

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// currentEquipmentId is NULLABLE: null/undefined (not installed) OR a non-empty string
// (the active installation). Anything else (number, "", object) is malformed.
function isNullableEquipmentRef(value) {
  return value === null || value === undefined || isNonEmptyString(value);
}

// An OPTIONAL descriptive string: absent (null/undefined) OR a non-empty string. A
// wrong-typed value (number, object, "") is malformed and fails closed.
function isOptionalString(value) {
  return value === null || value === undefined || isNonEmptyString(value);
}

// ---------------------------------------------------------------------------
// Part authority (injected). Validates the Part Master contract the Serialized Asset
// references and the projection consumes. trackingMode is Part authority (required, a
// valid mode); internalPartNumber is required; category/type/manufacturer/model are
// optional descriptive strings that fail closed only when wrong-typed. { valid, value, reason }.
// ---------------------------------------------------------------------------
export function validatePart(part) {
  if (!isPlainObject(part)) return { valid: false, value: null, reason: "part_not_object" };
  if (Object.keys(part).some((k) => !PART_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "part_unknown_field" };
  }
  if (!isNonEmptyString(part.partId)) return { valid: false, value: null, reason: "part_id_invalid" };
  if (!isTrackingMode(part.trackingMode)) return { valid: false, value: null, reason: "tracking_mode_invalid" };
  if (!isNonEmptyString(part.internalPartNumber)) return { valid: false, value: null, reason: "internal_part_number_invalid" };
  for (const field of ["category", "type", "manufacturer", "model"]) {
    if (!isOptionalString(part[field])) return { valid: false, value: null, reason: `${field}_invalid` };
  }
  return {
    valid: true,
    value: {
      partId: part.partId,
      trackingMode: part.trackingMode,
      internalPartNumber: part.internalPartNumber,
      category: part.category ?? null,
      type: part.type ?? null,
      manufacturer: part.manufacturer ?? null,
      model: part.model ?? null,
    },
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Serialized Asset identity (fail-closed). SERIAL eligibility is validated AGAINST the
// injected Part authority; trackingMode is never stored on the returned identity.
// ---------------------------------------------------------------------------
// Returns { valid, value, reason }. `value` carries ONLY governed unit identity -- a
// ledger-derived Location REFERENCE and lifecycle state -- never Part authority or an
// availability read decision.
export function validateSerializedAssetIdentity(input, part) {
  if (!isPlainObject(input)) return { valid: false, value: null, reason: "not_object" };
  if (Object.keys(input).some((k) => !IDENTITY_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "unknown_field" };
  }
  if (!isNonEmptyString(input.serialNo)) return { valid: false, value: null, reason: "serial_no_invalid" };
  if (!isNonEmptyString(input.partId)) return { valid: false, value: null, reason: "part_id_invalid" };
  const location = validateLocationRef(input.currentLocation);
  if (!location.valid) return { valid: false, value: null, reason: "current_location_invalid" };
  if (!SERIALIZED_ASSET_STATES.includes(input.state)) return { valid: false, value: null, reason: "state_invalid" };
  if (!isNullableEquipmentRef(input.currentEquipmentId)) {
    return { valid: false, value: null, reason: "current_equipment_id_invalid" };
  }
  // SERIAL eligibility comes from the injected Part authority (which owns trackingMode).
  // The identity must reference exactly that Part, and that Part must be SERIAL-tracked.
  if (!isPlainObject(part) || !isNonEmptyString(part.partId)) {
    return { valid: false, value: null, reason: "part_invalid" };
  }
  if (part.partId !== input.partId) return { valid: false, value: null, reason: "part_mismatch" };
  if (!isSerialTracked(part.trackingMode)) return { valid: false, value: null, reason: "not_serial_tracked" };

  const currentEquipmentId = isNonEmptyString(input.currentEquipmentId) ? input.currentEquipmentId : null;
  // State <-> link coupling: INSTALLED iff there is an active Equipment link. INSTALLED
  // with no link, or any non-INSTALLED state carrying a link, is a contradictory read
  // and fails closed (the two ledger-derived facts may never disagree).
  if (input.state === "INSTALLED" && currentEquipmentId === null) {
    return { valid: false, value: null, reason: "installed_requires_link" };
  }
  if (input.state !== "INSTALLED" && currentEquipmentId !== null) {
    return { valid: false, value: null, reason: "link_requires_installed" };
  }
  return {
    valid: true,
    value: {
      serialNo: input.serialNo,
      partId: input.partId,
      currentLocation: location.value, // ledger-derived reference only: { type, locationId }
      state: input.state, // ledger-derived lifecycle state
      currentEquipmentId,
    },
    reason: null,
  };
}

export function isSerializedAssetIdentity(input, part) {
  return validateSerializedAssetIdentity(input, part).valid;
}

// Validate the Location descriptive record the projection consumes (keyed by
// locationId). Distinct from the minimal reference in inventoryLocation.js in that it
// additionally supplies the display `label`. { valid, value, reason }.
function validateLocationDisplay(location) {
  if (!isPlainObject(location)) return { valid: false, value: null, reason: "location_not_object" };
  if (Object.keys(location).some((k) => !LOCATION_DISPLAY_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "location_unknown_field" };
  }
  if (!isNonEmptyString(location.locationId)) return { valid: false, value: null, reason: "location_id_invalid" };
  if (!isLocationType(location.type)) return { valid: false, value: null, reason: "location_type_invalid" };
  if (!isNonEmptyString(location.label)) return { valid: false, value: null, reason: "location_label_invalid" };
  return {
    valid: true,
    value: { locationId: location.locationId, type: location.type, label: location.label },
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Available Equipment projection (fail-closed) -- composed from injected authorities
// whose ids MUST match, gated by an explicitly injected availability read decision.
// ---------------------------------------------------------------------------
//   * serializedAsset -> governed identity, ledger-derived state + location reference
//   * part            -> SERIAL eligibility + internalPartNumber, category/type,
//                        manufacturer, model
//   * location        -> display label + type (must match the asset's location ref)
//   * availability    -> the ledger/reservation-DERIVED read decision that this unit is
//                        available for assignment (injected, never computed here)
// A unit projects ONLY when availability === true AND it is not installed. Any malformed
// input, id mismatch, or absent availability fails closed; a joined row is never fabricated.
export function composeAvailableEquipment({ serializedAsset, part, location, availability } = {}) {
  const partView = validatePart(part);
  if (!partView.valid) return { valid: false, value: null, reason: partView.reason };

  const asset = validateSerializedAssetIdentity(serializedAsset, part);
  if (!asset.valid) return { valid: false, value: null, reason: `asset:${asset.reason}` };

  // Availability is the INJECTED derived read decision, combined with the not-installed
  // link state. This module never infers availability from stock or reservations. The
  // INSTALLED-state check is defensive and redundant with the identity coupling above,
  // but ensures an installed unit can never enter Available Equipment.
  if (availability !== true || asset.value.state === "INSTALLED" || asset.value.currentEquipmentId !== null) {
    return { valid: false, value: null, reason: "unavailable" };
  }

  const locationView = validateLocationDisplay(location);
  if (!locationView.valid) return { valid: false, value: null, reason: locationView.reason };
  if (locationView.value.locationId !== asset.value.currentLocation.locationId) {
    return { valid: false, value: null, reason: "location_mismatch" };
  }
  if (locationView.value.type !== asset.value.currentLocation.type) {
    return { valid: false, value: null, reason: "location_type_mismatch" };
  }

  return {
    valid: true,
    value: {
      serialNo: asset.value.serialNo,
      partId: asset.value.partId,
      state: asset.value.state,
      availableForAssignment: true, // the injected read decision that gated inclusion
      currentEquipmentId: asset.value.currentEquipmentId, // null (available => not installed)
      // Part Master descriptive authority (supplied, not owned by the asset):
      internalPartNumber: partView.value.internalPartNumber,
      category: partView.value.category,
      type: partView.value.type,
      manufacturer: partView.value.manufacturer,
      model: partView.value.model,
      // Location descriptive authority (supplied, not owned by the asset):
      location: {
        locationId: locationView.value.locationId,
        type: locationView.value.type,
        label: locationView.value.label,
      },
    },
    reason: null,
  };
}

// Enterprise Inventory -- EI-P1a pure Serialized Asset IDENTITY contract + the
// Available Equipment PROJECTION composition.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no quantities, no
// availability CALCULATION, no ledger. It only (1) validates the identity of one
// serialized unit -- which exists ONLY for a SERIAL-tracked Part -- and (2) composes
// the read-only Available Equipment projection from three INJECTED authorities whose
// ids must agree. Node-importable and unit-tested directly
// (test/serializedAssetIdentity.test.mjs).
//
// AUTHORITY SEPARATION (the core invariant this contract enforces):
//   * The Serialized Asset identity holds ONLY unit-scoped facts: serialNo, partId,
//     tracking mode, a Location REFERENCE, inventory state/condition, the availability
//     flag, and the nullable active Equipment link. It NEVER copies descriptive Part
//     authority (internalPartNumber/category/type/manufacturer/model) or Location
//     descriptive authority (display label) -- those live in Part Master and Location.
//   * The Available Equipment projection is a DERIVED read view that MAY combine all
//     three, but only after requiring their ids to match; any mismatch or malformed
//     input fails closed rather than fabricating a joined row.
//
// FAIL CLOSED throughout: unknown enum values, a non-SERIAL/absent tracking mode, a
// bad Location reference, mismatched ids, or malformed injected records are rejected.
import { isSerialTracked } from "./partTrackingMode.js";
import { validateLocationRef, isLocationType } from "./inventoryLocation.js";

// Inventory lifecycle STATE of a serialized unit (not a computed availability, and not
// a quantity). RETIRED is terminal. Bounded and fail-closed.
export const SERIALIZED_ASSET_STATES = Object.freeze([
  "IN_STOCK",
  "RESERVED",
  "IN_TRANSIT",
  "INSTALLED",
  "RETIRED",
]);

// Physical CONDITION grade of the unit. Bounded and fail-closed.
export const SERIALIZED_ASSET_CONDITIONS = Object.freeze([
  "NEW",
  "USED",
  "REFURBISHED",
  "DAMAGED",
]);

// The exact fields the identity contract owns -- extras are rejected so descriptive
// Part/Location authority can never be smuggled onto a Serialized Asset.
const IDENTITY_FIELDS = new Set([
  "serialNo",
  "partId",
  "trackingMode",
  "currentLocation",
  "state",
  "condition",
  "availableForAssignment",
  "currentEquipmentId",
]);

// The descriptive fields Part Master SUPPLIES to the projection (keyed by partId).
const PART_FIELDS = new Set(["partId", "internalPartNumber", "category", "type", "manufacturer", "model"]);

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
// Serialized Asset identity (fail-closed). Requires a SERIAL-tracked Part.
// ---------------------------------------------------------------------------
// Returns { valid, value, reason }. `value` carries ONLY unit-scoped identity -- never
// descriptive Part/Location authority -- and a validated Location REFERENCE.
export function validateSerializedAssetIdentity(input) {
  if (!isPlainObject(input)) return { valid: false, value: null, reason: "not_object" };
  if (Object.keys(input).some((k) => !IDENTITY_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "unknown_field" };
  }
  // A serialized unit exists ONLY for a SERIAL-tracked Part. Missing/NONE/LOT/unknown
  // fails closed here (partTrackingMode never assumes SERIAL).
  if (!isSerialTracked(input.trackingMode)) return { valid: false, value: null, reason: "not_serial_tracked" };
  if (!isNonEmptyString(input.serialNo)) return { valid: false, value: null, reason: "serial_no_invalid" };
  if (!isNonEmptyString(input.partId)) return { valid: false, value: null, reason: "part_id_invalid" };
  const location = validateLocationRef(input.currentLocation);
  if (!location.valid) return { valid: false, value: null, reason: "current_location_invalid" };
  if (!SERIALIZED_ASSET_STATES.includes(input.state)) return { valid: false, value: null, reason: "state_invalid" };
  if (!SERIALIZED_ASSET_CONDITIONS.includes(input.condition)) return { valid: false, value: null, reason: "condition_invalid" };
  if (typeof input.availableForAssignment !== "boolean") {
    return { valid: false, value: null, reason: "availability_invalid" };
  }
  if (!isNullableEquipmentRef(input.currentEquipmentId)) {
    return { valid: false, value: null, reason: "current_equipment_id_invalid" };
  }
  const currentEquipmentId = isNonEmptyString(input.currentEquipmentId) ? input.currentEquipmentId : null;
  // INVARIANT: a unit may never be simultaneously installed AND available stock.
  if (currentEquipmentId !== null && input.availableForAssignment === true) {
    return { valid: false, value: null, reason: "installed_and_available" };
  }
  return {
    valid: true,
    value: {
      serialNo: input.serialNo,
      partId: input.partId,
      trackingMode: "SERIAL",
      currentLocation: location.value, // reference only: { type, locationId }
      state: input.state,
      condition: input.condition,
      availableForAssignment: input.availableForAssignment,
      currentEquipmentId,
    },
    reason: null,
  };
}

export function isSerializedAssetIdentity(input) {
  return validateSerializedAssetIdentity(input).valid;
}

// Validate the Part Master descriptive record the projection consumes (keyed by
// partId). internalPartNumber is required (the internal identifier the projection must
// surface); category/type/manufacturer/model are optional descriptive strings, but a
// wrong-typed value fails closed. { valid, value, reason }.
function validatePartProjection(part) {
  if (!isPlainObject(part)) return { valid: false, value: null, reason: "part_not_object" };
  if (Object.keys(part).some((k) => !PART_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "part_unknown_field" };
  }
  if (!isNonEmptyString(part.partId)) return { valid: false, value: null, reason: "part_id_invalid" };
  if (!isNonEmptyString(part.internalPartNumber)) return { valid: false, value: null, reason: "internal_part_number_invalid" };
  for (const field of ["category", "type", "manufacturer", "model"]) {
    if (!isOptionalString(part[field])) return { valid: false, value: null, reason: `${field}_invalid` };
  }
  return {
    valid: true,
    value: {
      partId: part.partId,
      internalPartNumber: part.internalPartNumber,
      category: part.category ?? null,
      type: part.type ?? null,
      manufacturer: part.manufacturer ?? null,
      model: part.model ?? null,
    },
    reason: null,
  };
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
// Available Equipment projection (fail-closed) -- composed from three injected
// authorities whose ids MUST match.
// ---------------------------------------------------------------------------
//   1. serializedAsset -> identity, condition/state, availability, location reference
//   2. part            -> internalPartNumber, category/type, manufacturer, model
//   3. location        -> display label + type (must match the asset's location ref)
// The asset must be genuinely available (flag true, not installed). Any malformed
// input or id mismatch fails closed; a joined row is never fabricated.
export function composeAvailableEquipment({ serializedAsset, part, location } = {}) {
  const asset = validateSerializedAssetIdentity(serializedAsset);
  if (!asset.valid) return { valid: false, value: null, reason: `asset:${asset.reason}` };
  // "Available Equipment" surfaces only genuinely-available units. Availability is the
  // INJECTED flag (never computed here) combined with the not-installed link state.
  if (asset.value.availableForAssignment !== true || asset.value.currentEquipmentId !== null) {
    return { valid: false, value: null, reason: "unavailable" };
  }

  const partView = validatePartProjection(part);
  if (!partView.valid) return { valid: false, value: null, reason: partView.reason };
  if (partView.value.partId !== asset.value.partId) {
    return { valid: false, value: null, reason: "part_mismatch" };
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
      condition: asset.value.condition,
      availableForAssignment: asset.value.availableForAssignment,
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

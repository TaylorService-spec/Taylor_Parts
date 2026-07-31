// Enterprise Inventory -- EI-P1a pure Inventory LOCATION-TYPE + reference contract.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no custody/quantity/
// ledger authority. It only names the bounded set of inventory location TYPES and
// validates a minimal, discriminated Location REFERENCE (the pointer other contracts
// carry), not a full Location document. The Location collection, its labels, and its
// custody remain their own authority (Enterprise Inventory); this contract consumes a
// location only as a `{ type, locationId }` reference. Node-importable and unit-tested
// directly (test/inventoryLocation.test.mjs).
//
// FAIL CLOSED: an unknown type, a missing/blank authoritative id, an array, or any
// non-plain-object reference is rejected -- never normalized into validity.

// The bounded inventory location types. WAREHOUSE = a stocking facility; BIN = a
// sub-location within a warehouse; MOBILE = a truck/van rolling stock location;
// VENDOR = supplier-held; CUSTOMER = installed/consigned at a customer; VIRTUAL =
// non-physical (in-transit / adjustment / scrap holding).
export const INVENTORY_LOCATION_TYPES = Object.freeze([
  "WAREHOUSE",
  "BIN",
  "MOBILE",
  "VENDOR",
  "CUSTOMER",
  "VIRTUAL",
]);

const REFERENCE_FIELDS = new Set(["type", "locationId"]);

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Exact, canonical membership for a location TYPE. Anything else fails closed.
export function isLocationType(value) {
  return typeof value === "string" && INVENTORY_LOCATION_TYPES.includes(value);
}

// Validate a minimal, discriminated Location REFERENCE: a plain object carrying a
// canonical `type` (the discriminant) and a non-empty authoritative `locationId`.
// Extra fields are rejected so a reference can never smuggle Location descriptive
// authority (labels, address, custody) through this pointer. { valid, value, reason }.
export function validateLocationRef(ref) {
  if (!isPlainObject(ref)) return { valid: false, value: null, reason: "not_object" };
  if (Object.keys(ref).some((k) => !REFERENCE_FIELDS.has(k))) {
    return { valid: false, value: null, reason: "unknown_field" };
  }
  if (!isLocationType(ref.type)) return { valid: false, value: null, reason: "type_invalid" };
  if (!isNonEmptyString(ref.locationId)) return { valid: false, value: null, reason: "location_id_invalid" };
  return { valid: true, value: { type: ref.type, locationId: ref.locationId }, reason: null };
}

// Boolean convenience predicate over the same fail-closed rules.
export function isLocationRef(ref) {
  return validateLocationRef(ref).valid;
}

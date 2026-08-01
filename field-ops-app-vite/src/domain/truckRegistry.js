// EI-P1d-2-1 -- pure, node-testable Truck / MOBILE Location REGISTRY contract.
//
// PURE and DETERMINISTIC: no Firebase, no persistence, no reads, no writes. It defines and
// validates the governed registry that resolves a MOBILE inventory locationId to a truck,
// and composes the governed payload the merged Truck Inventory workspace (EI-P1d-1) consumes.
//
// GOVERNANCE (authorized EI-P1d-2-1 decisions, aligned with ADR-010 §36/§39):
//   * TWO separate authorities linked 1:1 -- NEVER merged:
//       - a MOBILE inventory Location record  (the custody POSITION; inventory key = locationId);
//       - a Truck business record (ADR-010's optional Vehicle record; business key = truckId).
//     The Truck record is explicitly NOT a stock/quantity/custody/movement authority: WHAT is on
//     a truck comes from the single ledger + serialized-asset authority, never from here.
//   * assignedDriverEmployeeId links an Employee and NEVER changes inventory custody.
//   * Fleet statuses are ACTIVE / IDLE / OUT_OF_SERVICE. equipmentStatus reuses the merged
//     SERIALIZED_ASSET_STATES. equipmentCondition is DEFERRED -- no condition enum is invented
//     here; its options stay whatever governed list is injected (empty by default).
//   * Composed metrics (value / counts / discrepancies / last reconciliation) remain NULL --
//     they are ledger/reconciliation authority, not computed here.
//
// BOUNDARIES: no persistence, collections, Rules, indexes, Functions, capabilities, writes,
// fixtures, or stock math.
import { validateLocationRef } from "./inventoryLocation.js";
import { SERIALIZED_ASSET_STATES } from "./serializedAssetIdentity.js";

// Governed fleet-status enum (the Truck registry owns this).
export const TRUCK_STATUSES = Object.freeze(["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);

const MOBILE_LOCATION_FIELDS = new Set(["locationId", "type", "displayLabel", "active"]);
const TRUCK_FIELDS = new Set(["truckId", "locationId", "vehicleNumber", "displayLabel", "status", "homeWarehouseId", "assignedDriverEmployeeId"]);

function isPlainObject(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
// Nullable link/id: null/undefined OR a non-empty string. Anything else is malformed.
function isNullableString(v) {
  return v === null || v === undefined || isNonEmptyString(v);
}
function fail(reason) {
  return { valid: false, value: null, reason };
}
// Validate an injected option list into a deduped array of non-empty strings.
function validateOptionList(v) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === "string" && x.trim() !== "" && !seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// validateMobileLocation(docId, data) -- one MOBILE inventory Location record. The document
// id IS the authoritative inventory locationId (never trust a stored id). { valid, value, reason }.
// ---------------------------------------------------------------------------
export function validateMobileLocation(docId, data) {
  if (!isNonEmptyString(docId)) return fail("doc_id_invalid");
  if (!isPlainObject(data)) return fail("not_object");
  if (data.id !== undefined && data.id !== docId) return fail("stored_id_conflict");
  if (Object.keys(data).some((k) => k !== "id" && !MOBILE_LOCATION_FIELDS.has(k))) return fail("unknown_field");
  const ref = validateLocationRef({ type: data.type, locationId: data.locationId });
  if (!ref.valid) return fail("location_ref_invalid");
  if (ref.value.type !== "MOBILE") return fail("not_mobile");
  if (ref.value.locationId !== docId) return fail("location_id_mismatch"); // the doc id IS the locationId
  if (!isNonEmptyString(data.displayLabel)) return fail("display_label_invalid");
  if (typeof data.active !== "boolean") return fail("active_invalid");
  return { valid: true, value: { locationId: ref.value.locationId, type: "MOBILE", displayLabel: data.displayLabel, active: data.active }, reason: null };
}

// ---------------------------------------------------------------------------
// validateTruckRecord(docId, data, { mobileLocation }) -- one Truck business record. The
// document id IS the authoritative truckId. `mobileLocation` is a VALIDATED MOBILE Location
// value (from validateMobileLocation); the 1:1 link requires it to exist and match
// data.locationId. Carries NO stock/quantity/custody. { valid, value, reason }.
// ---------------------------------------------------------------------------
export function validateTruckRecord(docId, data, { mobileLocation } = {}) {
  if (!isNonEmptyString(docId)) return fail("doc_id_invalid");
  if (!isPlainObject(data)) return fail("not_object");
  if (data.id !== undefined && data.id !== docId) return fail("stored_id_conflict");
  if (Object.keys(data).some((k) => k !== "id" && !TRUCK_FIELDS.has(k))) return fail("unknown_field");
  if (!isNonEmptyString(data.truckId)) return fail("truck_id_invalid");
  if (data.truckId !== docId) return fail("truck_id_mismatch"); // the doc id IS the truckId
  if (!isNonEmptyString(data.locationId)) return fail("location_id_invalid");
  if (!isNonEmptyString(data.vehicleNumber)) return fail("vehicle_number_invalid");
  if (!isNonEmptyString(data.displayLabel)) return fail("display_label_invalid");
  if (!TRUCK_STATUSES.includes(data.status)) return fail("status_invalid");
  if (!isNonEmptyString(data.homeWarehouseId)) return fail("home_warehouse_invalid");
  if (!isNullableString(data.assignedDriverEmployeeId)) return fail("driver_invalid");
  // 1:1 MOBILE Location link: the injected location must be a valid MOBILE Location value
  // whose locationId matches this truck's locationId.
  if (!isPlainObject(mobileLocation) || mobileLocation.type !== "MOBILE" || !isNonEmptyString(mobileLocation.locationId)) {
    return fail("mobile_location_missing");
  }
  if (mobileLocation.locationId !== data.locationId) return fail("mobile_location_mismatch");
  return {
    valid: true,
    value: {
      truckId: data.truckId,
      locationId: data.locationId,
      vehicleNumber: data.vehicleNumber,
      displayLabel: data.displayLabel,
      status: data.status,
      homeWarehouseId: data.homeWarehouseId,
      assignedDriverEmployeeId: isNonEmptyString(data.assignedDriverEmployeeId) ? data.assignedDriverEmployeeId : null,
    },
    reason: null,
  };
}

function asPairs(list) {
  return Array.isArray(list) ? list.filter((p) => isPlainObject(p) && isNonEmptyString(p.docId)) : [];
}

// ---------------------------------------------------------------------------
// composeTruckFleet -- build the governed payload the EI-P1d-1 workspace consumes: the fleet
// summary rows + the governed pick-list options. Only valid trucks with a valid, matched
// MOBILE Location link appear. Driver display is resolved via an INJECTED resolver (the
// registry never reads Employees). Metrics stay NULL (ledger/reconciliation authority).
//
//   composeTruckFleet({ mobileLocations, trucks, resolveDriverName?, equipmentConditionOptions? })
//     -> { trucks: [summary], options: { fleetStatus, equipmentStatus, equipmentCondition } }
// ---------------------------------------------------------------------------
export function composeTruckFleet({ mobileLocations = [], trucks = [], resolveDriverName, equipmentConditionOptions = [] } = {}) {
  const locationById = new Map();
  for (const { docId, data } of asPairs(mobileLocations)) {
    const r = validateMobileLocation(docId, data);
    if (r.valid) locationById.set(r.value.locationId, r.value);
  }

  // Pass 1: validate each truck against its own MOBILE Location link.
  const valid = [];
  for (const { docId, data } of asPairs(trucks)) {
    const locId = isPlainObject(data) && typeof data.locationId === "string" ? data.locationId : undefined;
    const mobileLocation = locId !== undefined ? locationById.get(locId) : undefined;
    const r = validateTruckRecord(docId, data, { mobileLocation });
    if (r.valid) valid.push({ truck: r.value, mobileLocation });
  }

  // Enforce the FLEET-LEVEL 1:1 invariant: one MOBILE Location resolves to exactly one truck
  // (and one truckId to exactly one record). Any locationId (or truckId) claimed by more than
  // one otherwise-valid record makes EVERY conflicting record fail closed -- never first-wins,
  // so the drop is order-independent.
  const byLocation = new Map();
  const byTruck = new Map();
  for (const v of valid) {
    byLocation.set(v.truck.locationId, (byLocation.get(v.truck.locationId) || 0) + 1);
    byTruck.set(v.truck.truckId, (byTruck.get(v.truck.truckId) || 0) + 1);
  }

  const summaries = [];
  for (const { truck: t, mobileLocation } of valid) {
    if (byLocation.get(t.locationId) !== 1) continue; // conflicting MOBILE Location -> drop all
    if (byTruck.get(t.truckId) !== 1) continue; // duplicate truck record -> drop all
    const driverName = typeof resolveDriverName === "function" && t.assignedDriverEmployeeId ? resolveDriverName(t.assignedDriverEmployeeId) : null;
    summaries.push({
      id: t.truckId,
      technician: isNonEmptyString(driverName) ? driverName : null, // resolved driver display, or null
      location: mobileLocation.displayLabel,
      homeWarehouse: t.homeWarehouseId,
      status: t.status,
      // Metrics are ledger/reconciliation authority -- never computed in the registry.
      metrics: { inventoryValue: null, serializedCount: null, partsCount: null, discrepancies: null, lastReconciliation: null },
    });
  }
  summaries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    trucks: summaries,
    options: {
      fleetStatus: [...TRUCK_STATUSES],
      equipmentStatus: [...SERIALIZED_ASSET_STATES],
      equipmentCondition: validateOptionList(equipmentConditionOptions), // deferred: empty unless governed list injected
    },
  };
}

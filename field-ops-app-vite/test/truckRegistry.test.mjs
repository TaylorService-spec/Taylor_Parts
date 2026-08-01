// EI-P1d-2-1 -- deterministic pure unit tests for the Truck / MOBILE Location registry
// contract (src/domain/truckRegistry.js). Proves fail-closed record validation, the
// authoritative doc-id keys (locationId / truckId), the 1:1 Truck ⇄ MOBILE-Location link,
// the governed pick-lists (fleetStatus / equipmentStatus reused / equipmentCondition
// deferred), and that composed metrics stay null (no stock/custody authority here).
//
// Run: node test/truckRegistry.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { TRUCK_STATUSES, validateMobileLocation, validateTruckRecord, composeTruckFleet } from "../src/domain/truckRegistry.js";
import { SERIALIZED_ASSET_STATES } from "../src/domain/serializedAssetIdentity.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const LOC_ID = "MLOC-204";
const loc = (over = {}) => ({ locationId: LOC_ID, type: "MOBILE", displayLabel: "Truck 204", active: true, ...over });
const locValue = validateMobileLocation(LOC_ID, loc()).value; // a validated MOBILE Location value
const truck = (over = {}) => ({ truckId: "TRK-204", locationId: LOC_ID, vehicleNumber: "204", displayLabel: "Truck 204", status: "ACTIVE", homeWarehouseId: "WH-MAIN", assignedDriverEmployeeId: "emp-mb", ...over });

// --- enum ---
ok("fleet statuses are exactly the governed set (frozen)", () => {
  assert.deepEqual(TRUCK_STATUSES, ["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
  assert.equal(Object.isFrozen(TRUCK_STATUSES), true);
});

// --- MOBILE Location record ---
ok("validateMobileLocation: valid; doc id IS the locationId", () => {
  assert.deepEqual(validateMobileLocation(LOC_ID, loc()), { valid: true, value: { locationId: LOC_ID, type: "MOBILE", displayLabel: "Truck 204", active: true }, reason: null });
});

ok("validateMobileLocation: fail-closed", () => {
  assert.equal(validateMobileLocation("", loc()).reason, "doc_id_invalid");
  assert.equal(validateMobileLocation(LOC_ID, null).reason, "not_object");
  assert.equal(validateMobileLocation(LOC_ID, loc({ id: "OTHER" })).reason, "stored_id_conflict");
  assert.equal(validateMobileLocation(LOC_ID, loc({ extra: 1 })).reason, "unknown_field");
  assert.equal(validateMobileLocation(LOC_ID, loc({ type: "WAREHOUSE" })).reason, "not_mobile");
  assert.equal(validateMobileLocation(LOC_ID, loc({ type: "NOPE" })).reason, "location_ref_invalid");
  assert.equal(validateMobileLocation("DIFF", loc()).reason, "location_id_mismatch"); // docId != locationId
  assert.equal(validateMobileLocation(LOC_ID, loc({ displayLabel: "" })).reason, "display_label_invalid");
  assert.equal(validateMobileLocation(LOC_ID, loc({ active: "yes" })).reason, "active_invalid");
});

// --- Truck record + 1:1 link ---
ok("validateTruckRecord: valid with a matched MOBILE Location; driver kept", () => {
  const r = validateTruckRecord("TRK-204", truck(), { mobileLocation: locValue });
  assert.deepEqual(r.value, { truckId: "TRK-204", locationId: LOC_ID, vehicleNumber: "204", displayLabel: "Truck 204", status: "ACTIVE", homeWarehouseId: "WH-MAIN", assignedDriverEmployeeId: "emp-mb" });
});

ok("validateTruckRecord: driver is nullable but never malformed", () => {
  assert.equal(validateTruckRecord("TRK-204", truck({ assignedDriverEmployeeId: undefined }), { mobileLocation: locValue }).value.assignedDriverEmployeeId, null);
  assert.equal(validateTruckRecord("TRK-204", truck({ assignedDriverEmployeeId: null }), { mobileLocation: locValue }).value.assignedDriverEmployeeId, null);
  assert.equal(validateTruckRecord("TRK-204", truck({ assignedDriverEmployeeId: "" }), { mobileLocation: locValue }).reason, "driver_invalid");
});

ok("validateTruckRecord: fail-closed field + identity guards", () => {
  assert.equal(validateTruckRecord("TRK-204", truck({ id: "OTHER" }), { mobileLocation: locValue }).reason, "stored_id_conflict");
  assert.equal(validateTruckRecord("TRK-204", truck({ extra: 1 }), { mobileLocation: locValue }).reason, "unknown_field");
  assert.equal(validateTruckRecord("DIFF", truck(), { mobileLocation: locValue }).reason, "truck_id_mismatch");
  assert.equal(validateTruckRecord("TRK-204", truck({ vehicleNumber: "" }), { mobileLocation: locValue }).reason, "vehicle_number_invalid");
  assert.equal(validateTruckRecord("TRK-204", truck({ status: "MOVING" }), { mobileLocation: locValue }).reason, "status_invalid");
  assert.equal(validateTruckRecord("TRK-204", truck({ homeWarehouseId: "" }), { mobileLocation: locValue }).reason, "home_warehouse_invalid");
});

ok("validateTruckRecord: the 1:1 MOBILE link is required and must match", () => {
  assert.equal(validateTruckRecord("TRK-204", truck(), {}).reason, "mobile_location_missing");
  assert.equal(validateTruckRecord("TRK-204", truck(), { mobileLocation: { type: "WAREHOUSE", locationId: LOC_ID } }).reason, "mobile_location_missing");
  assert.equal(validateTruckRecord("TRK-204", truck(), { mobileLocation: { type: "MOBILE", locationId: "OTHER-LOC" } }).reason, "mobile_location_mismatch");
});

// --- composeTruckFleet ---
ok("composeTruckFleet: valid trucks -> summaries; metrics NULL; location from MOBILE label", () => {
  const out = composeTruckFleet({
    mobileLocations: [{ docId: LOC_ID, data: loc() }],
    trucks: [{ docId: "TRK-204", data: truck() }],
    resolveDriverName: (id) => (id === "emp-mb" ? "Marcus Bell" : null),
  });
  assert.equal(out.trucks.length, 1);
  assert.deepEqual(out.trucks[0], {
    id: "TRK-204", technician: "Marcus Bell", location: "Truck 204", homeWarehouse: "WH-MAIN", status: "ACTIVE",
    metrics: { inventoryValue: null, serializedCount: null, partsCount: null, discrepancies: null, lastReconciliation: null },
  });
});

ok("composeTruckFleet: governed options (fleetStatus + reused equipmentStatus; equipmentCondition deferred)", () => {
  const out = composeTruckFleet({});
  assert.deepEqual(out.trucks, []);
  assert.deepEqual(out.options.fleetStatus, ["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
  assert.deepEqual(out.options.equipmentStatus, [...SERIALIZED_ASSET_STATES]);
  assert.deepEqual(out.options.equipmentCondition, []); // deferred by default
  // an injected governed condition list is validated + deduped
  assert.deepEqual(composeTruckFleet({ equipmentConditionOptions: ["New", "New", "", 5, "Used"] }).options.equipmentCondition, ["New", "Used"]);
});

ok("composeTruckFleet: fail-closed drops -- unmatched link / invalid records / bad status", () => {
  const out = composeTruckFleet({
    mobileLocations: [{ docId: LOC_ID, data: loc() }, { docId: "BAD", data: { type: "WAREHOUSE" } }],
    trucks: [
      { docId: "TRK-204", data: truck() }, // valid
      { docId: "TRK-NOLOC", data: truck({ truckId: "TRK-NOLOC", locationId: "MISSING" }) }, // link not found -> dropped
      { docId: "TRK-BAD", data: truck({ truckId: "TRK-BAD", status: "ZOOM" }) }, // invalid -> dropped
      null,
    ],
    resolveDriverName: () => null,
  });
  assert.equal(out.trucks.length, 1);
  assert.equal(out.trucks[0].id, "TRK-204");
  assert.equal(out.trucks[0].technician, null); // resolver returned null
});

ok("composeTruckFleet: deterministic order by truckId", () => {
  const mk = (id) => ({ docId: id, data: truck({ truckId: id }) });
  const out = composeTruckFleet({ mobileLocations: [{ docId: LOC_ID, data: loc() }], trucks: [mk("TRK-3"), mk("TRK-1"), mk("TRK-2")] });
  assert.deepEqual(out.trucks.map((t) => t.id), ["TRK-1", "TRK-2", "TRK-3"]);
});

ok("composeTruckFleet: does not mutate inputs", () => {
  const mobileLocations = [{ docId: LOC_ID, data: loc() }];
  const trucks = [{ docId: "TRK-204", data: truck() }];
  const sl = structuredClone(mobileLocations), st = structuredClone(trucks);
  composeTruckFleet({ mobileLocations, trucks });
  assert.deepEqual(mobileLocations, sl);
  assert.deepEqual(trucks, st);
});

console.log(`\n${passed} passed`);

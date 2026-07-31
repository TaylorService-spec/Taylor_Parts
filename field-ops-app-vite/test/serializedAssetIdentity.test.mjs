// Enterprise Inventory -- EI-P1a. Deterministic pure unit tests for the Serialized
// Asset identity contract and the Available Equipment projection composition
// (src/domain/serializedAssetIdentity.js). Proves fail-closed identity validation,
// the SERIAL-tracked-Part gate, strict authority separation (no descriptive
// Part/Location fields on the identity), and id-matched three-authority composition.
//
// Run: node test/serializedAssetIdentity.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  SERIALIZED_ASSET_STATES,
  SERIALIZED_ASSET_CONDITIONS,
  validateSerializedAssetIdentity,
  isSerializedAssetIdentity,
  composeAvailableEquipment,
} from "../src/domain/serializedAssetIdentity.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

// A valid, AVAILABLE serialized-asset identity fixture (not installed).
const asset = (over) => ({
  serialNo: "SN-100",
  partId: "PART-1",
  trackingMode: "SERIAL",
  currentLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  state: "IN_STOCK",
  condition: "NEW",
  availableForAssignment: true,
  currentEquipmentId: null,
  ...over,
});
const part = (over) => ({
  partId: "PART-1",
  internalPartNumber: "IPN-42",
  category: "PUMP",
  type: "HYDRAULIC",
  manufacturer: "Taylor",
  model: "C713",
  ...over,
});
const location = (over) => ({ locationId: "WH-1", type: "WAREHOUSE", label: "Main Warehouse", ...over });

// --- enums ---
ok("state/condition enums are the bounded frozen sets", () => {
  assert.deepEqual(SERIALIZED_ASSET_STATES, ["IN_STOCK", "RESERVED", "IN_TRANSIT", "INSTALLED", "RETIRED"]);
  assert.deepEqual(SERIALIZED_ASSET_CONDITIONS, ["NEW", "USED", "REFURBISHED", "DAMAGED"]);
  assert.equal(Object.isFrozen(SERIALIZED_ASSET_STATES), true);
  assert.equal(Object.isFrozen(SERIALIZED_ASSET_CONDITIONS), true);
});

// --- identity: happy path + shape ---
ok("valid identity: normalized value carries ONLY unit-scoped identity", () => {
  const r = validateSerializedAssetIdentity(asset());
  assert.equal(r.valid, true);
  assert.equal(r.reason, null);
  assert.deepEqual(Object.keys(r.value).sort(), [
    "availableForAssignment", "condition", "currentEquipmentId", "currentLocation",
    "partId", "serialNo", "state", "trackingMode",
  ]);
  // Location is a REFERENCE only (no label); no descriptive Part authority present.
  assert.deepEqual(r.value.currentLocation, { type: "WAREHOUSE", locationId: "WH-1" });
  for (const forbidden of ["internalPartNumber", "manufacturer", "model", "category", "label"]) {
    assert.equal(forbidden in r.value, false, `identity must not carry ${forbidden}`);
  }
});

ok("installed (but not available) identity is valid; currentEquipmentId retained", () => {
  const r = validateSerializedAssetIdentity(asset({ state: "INSTALLED", availableForAssignment: false, currentEquipmentId: "EQ-9" }));
  assert.equal(r.valid, true);
  assert.equal(r.value.currentEquipmentId, "EQ-9");
});

ok("isSerializedAssetIdentity mirrors validity", () => {
  assert.equal(isSerializedAssetIdentity(asset()), true);
  assert.equal(isSerializedAssetIdentity({}), false);
});

// --- identity: fail-closed ---
ok("not_object", () => {
  for (const v of [null, undefined, "x", 5, []]) {
    assert.equal(validateSerializedAssetIdentity(v).reason, "not_object", String(v));
  }
});

ok("unknown_field rejected (no descriptive smuggling onto identity)", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ manufacturer: "Taylor" })).reason, "unknown_field");
  assert.equal(validateSerializedAssetIdentity(asset({ label: "Main" })).reason, "unknown_field");
});

ok("requires a SERIAL-tracked Part -- NONE/LOT/missing/unknown all fail closed", () => {
  for (const trackingMode of ["NONE", "LOT", undefined, null, "serial", "SERIALIZED", ""]) {
    assert.equal(
      validateSerializedAssetIdentity(asset({ trackingMode })).reason,
      "not_serial_tracked",
      `trackingMode=${String(trackingMode)}`,
    );
  }
});

ok("serialNo / partId must be non-empty strings", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ serialNo: "" })).reason, "serial_no_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ serialNo: 100 })).reason, "serial_no_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ partId: "  " })).reason, "part_id_invalid");
});

ok("currentLocation must be a valid discriminated reference", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: null })).reason, "current_location_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: { type: "TRUCK", locationId: "T-1" } })).reason, "current_location_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: { type: "WAREHOUSE", locationId: "" } })).reason, "current_location_invalid");
  // A location reference may NOT carry a label here (that is Location display authority).
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: { type: "WAREHOUSE", locationId: "WH-1", label: "x" } })).reason, "current_location_invalid");
});

ok("state / condition must be canonical enum members", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ state: "in_stock" })).reason, "state_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ state: undefined })).reason, "state_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ condition: "MINT" })).reason, "condition_invalid");
});

ok("availableForAssignment must be a real boolean", () => {
  for (const v of ["true", 1, 0, null, undefined]) {
    assert.equal(validateSerializedAssetIdentity(asset({ availableForAssignment: v, currentEquipmentId: null })).reason, "availability_invalid", String(v));
  }
});

ok("currentEquipmentId is nullable but never malformed", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ currentEquipmentId: "" })).reason, "current_equipment_id_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentEquipmentId: 5 })).reason, "current_equipment_id_invalid");
  // undefined is an allowed "not installed" value.
  assert.equal(validateSerializedAssetIdentity(asset({ currentEquipmentId: undefined })).valid, true);
});

ok("INVARIANT: installed AND available fails closed", () => {
  assert.equal(
    validateSerializedAssetIdentity(asset({ currentEquipmentId: "EQ-1", availableForAssignment: true })).reason,
    "installed_and_available",
  );
});

ok("validation does not mutate input", () => {
  const input = asset();
  const snapshot = structuredClone(input);
  validateSerializedAssetIdentity(input);
  assert.deepEqual(input, snapshot);
});

// --- projection: happy path ---
ok("composeAvailableEquipment: id-matched three-authority join", () => {
  const r = composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location() });
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, {
    serialNo: "SN-100",
    partId: "PART-1",
    state: "IN_STOCK",
    condition: "NEW",
    availableForAssignment: true,
    currentEquipmentId: null,
    internalPartNumber: "IPN-42",
    category: "PUMP",
    type: "HYDRAULIC",
    manufacturer: "Taylor",
    model: "C713",
    location: { locationId: "WH-1", type: "WAREHOUSE", label: "Main Warehouse" },
  });
});

ok("projection: optional Part descriptive fields default to null (not fabricated)", () => {
  const r = composeAvailableEquipment({
    serializedAsset: asset(),
    part: { partId: "PART-1", internalPartNumber: "IPN-42" },
    location: location(),
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.manufacturer, null);
  assert.equal(r.value.model, null);
  assert.equal(r.value.category, null);
  assert.equal(r.value.type, null);
});

// --- projection: fail-closed ---
ok("projection: asset failure propagates with asset: prefix", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: null, part: part(), location: location() }).reason, "asset:not_object");
  assert.equal(composeAvailableEquipment({ serializedAsset: {}, part: part(), location: location() }).reason, "asset:not_serial_tracked");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset({ trackingMode: "LOT" }), part: part(), location: location() }).reason, "asset:not_serial_tracked");
});

ok("projection: unavailable asset (flag false) fails closed", () => {
  const r = composeAvailableEquipment({ serializedAsset: asset({ availableForAssignment: false }), part: part(), location: location() });
  assert.equal(r.reason, "unavailable");
});

ok("projection: installed asset can never appear in Available Equipment", () => {
  // installed + not-available is a valid identity, but it is NOT available -> excluded.
  const installed = asset({ state: "INSTALLED", availableForAssignment: false, currentEquipmentId: "EQ-9" });
  assert.equal(composeAvailableEquipment({ serializedAsset: installed, part: part(), location: location() }).reason, "unavailable");
});

ok("projection: malformed Part fails closed", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: null, location: location() }).reason, "part_not_object");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part({ secret: "x" }), location: location() }).reason, "part_unknown_field");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part({ internalPartNumber: "" }), location: location() }).reason, "internal_part_number_invalid");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part({ manufacturer: 5 }), location: location() }).reason, "manufacturer_invalid");
});

ok("projection: Part id must match the asset's partId", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part({ partId: "OTHER" }), location: location() }).reason, "part_mismatch");
});

ok("projection: malformed Location fails closed", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: null }).reason, "location_not_object");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ extra: 1 }) }).reason, "location_unknown_field");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ label: "" }) }).reason, "location_label_invalid");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ type: "TRUCK" }) }).reason, "location_type_invalid");
});

ok("projection: Location id and type must match the asset's location reference", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ locationId: "WH-2" }) }).reason, "location_mismatch");
  // A location whose id matches but whose type disagrees with the reference fails closed.
  const a = asset({ currentLocation: { type: "BIN", locationId: "WH-1" } });
  assert.equal(composeAvailableEquipment({ serializedAsset: a, part: part(), location: location() }).reason, "location_type_mismatch");
});

ok("projection: missing argument object fails closed (no throw)", () => {
  assert.equal(composeAvailableEquipment().reason, "asset:not_object");
  assert.equal(composeAvailableEquipment({}).reason, "asset:not_object");
});

console.log(`\n${passed} passed`);

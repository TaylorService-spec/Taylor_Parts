// Enterprise Inventory -- EI-P1a. Deterministic pure unit tests for the Serialized
// Asset identity contract and the Available Equipment projection composition
// (src/domain/serializedAssetIdentity.js). Proves: fail-closed identity validation;
// SERIAL eligibility validated AGAINST the injected Part authority (trackingMode never
// stored on the asset); Rev 6 lifecycle states; NO condition enum; availability as an
// explicitly injected derived read input that gates the projection only; and id-matched
// three-authority composition.
//
// Run: node test/serializedAssetIdentity.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  SERIALIZED_ASSET_STATES,
  validatePart,
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

// A valid governed identity fixture (no trackingMode, no condition, no availability).
const asset = (over) => ({
  serialNo: "SN-100",
  partId: "PART-1",
  currentLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  state: "AVAILABLE",
  currentEquipmentId: null,
  ...over,
});
// The injected Part authority. trackingMode is Part authority (SERIAL here).
const part = (over) => ({
  partId: "PART-1",
  trackingMode: "SERIAL",
  internalPartNumber: "IPN-42",
  category: "PUMP",
  type: "HYDRAULIC",
  manufacturer: "Taylor",
  model: "C713",
  ...over,
});
const location = (over) => ({ locationId: "WH-1", type: "WAREHOUSE", label: "Main Warehouse", ...over });

// --- governance: Rev 6 states, NO condition enum ---
ok("state enum is exactly the durable Rev 6 set (ordered, frozen)", () => {
  assert.deepEqual(SERIALIZED_ASSET_STATES, [
    "RECEIVED", "AVAILABLE", "RESERVED", "STAGED", "LOADED", "IN_TRANSIT", "DELIVERED", "INSTALLED",
  ]);
  assert.equal(Object.isFrozen(SERIALIZED_ASSET_STATES), true);
});

ok("no condition enum/authority is exported by EI-P1a", async () => {
  const mod = await import("../src/domain/serializedAssetIdentity.js");
  assert.equal("SERIALIZED_ASSET_CONDITIONS" in mod, false);
});

// --- Part authority contract ---
ok("validatePart: valid Part authority, trackingMode retained on the Part (not the asset)", () => {
  const r = validatePart(part());
  assert.equal(r.valid, true);
  assert.equal(r.value.trackingMode, "SERIAL");
  assert.equal(r.value.internalPartNumber, "IPN-42");
});

ok("validatePart: fail-closed on shape/tracking/identifier", () => {
  assert.equal(validatePart(null).reason, "part_not_object");
  assert.equal(validatePart(part({ secret: "x" })).reason, "part_unknown_field");
  assert.equal(validatePart(part({ partId: "" })).reason, "part_id_invalid");
  assert.equal(validatePart(part({ trackingMode: "serial" })).reason, "tracking_mode_invalid");
  assert.equal(validatePart(part({ trackingMode: undefined })).reason, "tracking_mode_invalid");
  assert.equal(validatePart(part({ internalPartNumber: "" })).reason, "internal_part_number_invalid");
  assert.equal(validatePart(part({ manufacturer: 5 })).reason, "manufacturer_invalid");
});

ok("validatePart: optional descriptive fields default to null (not fabricated)", () => {
  const r = validatePart({ partId: "PART-1", trackingMode: "SERIAL", internalPartNumber: "IPN-42" });
  assert.equal(r.valid, true);
  assert.deepEqual([r.value.category, r.value.type, r.value.manufacturer, r.value.model], [null, null, null, null]);
});

// --- identity: happy path + authority separation ---
ok("valid identity: value carries ONLY governed unit fields (no Part/availability authority)", () => {
  const r = validateSerializedAssetIdentity(asset(), part());
  assert.equal(r.valid, true);
  assert.equal(r.reason, null);
  assert.deepEqual(Object.keys(r.value).sort(), ["currentEquipmentId", "currentLocation", "partId", "serialNo", "state"]);
  assert.deepEqual(r.value.currentLocation, { type: "WAREHOUSE", locationId: "WH-1" }); // reference only
  for (const forbidden of ["trackingMode", "condition", "availableForAssignment", "internalPartNumber", "manufacturer", "model", "category", "label"]) {
    assert.equal(forbidden in r.value, false, `identity must not carry ${forbidden}`);
  }
});

ok("installed identity is valid; currentEquipmentId retained", () => {
  const r = validateSerializedAssetIdentity(asset({ state: "INSTALLED", currentEquipmentId: "EQ-9" }), part());
  assert.equal(r.valid, true);
  assert.equal(r.value.currentEquipmentId, "EQ-9");
});

ok("isSerializedAssetIdentity mirrors validity (with Part authority)", () => {
  assert.equal(isSerializedAssetIdentity(asset(), part()), true);
  assert.equal(isSerializedAssetIdentity({}, part()), false);
});

// --- identity: state <-> link coupling (INSTALLED iff active link) ---
ok("INSTALLED requires a nonempty currentEquipmentId", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ state: "INSTALLED", currentEquipmentId: null }), part()).reason, "installed_requires_link");
  assert.equal(validateSerializedAssetIdentity(asset({ state: "INSTALLED", currentEquipmentId: undefined }), part()).reason, "installed_requires_link");
});

ok("any non-INSTALLED state requires currentEquipmentId null", () => {
  for (const state of ["RECEIVED", "AVAILABLE", "RESERVED", "STAGED", "LOADED", "IN_TRANSIT", "DELIVERED"]) {
    assert.equal(validateSerializedAssetIdentity(asset({ state, currentEquipmentId: "EQ-1" }), part()).reason, "link_requires_installed", state);
  }
});

ok("the two consistent shapes remain valid", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ state: "AVAILABLE", currentEquipmentId: null }), part()).valid, true);
  assert.equal(validateSerializedAssetIdentity(asset({ state: "INSTALLED", currentEquipmentId: "EQ-9" }), part()).valid, true);
});

// --- identity: SERIAL eligibility validated AGAINST the injected Part ---
ok("SERIAL eligibility comes from the injected Part, not the asset", () => {
  // A NONE/LOT/missing/unknown Part is not SERIAL-eligible -> fail closed.
  for (const trackingMode of ["NONE", "LOT", undefined, null, "serial", "SERIALIZED"]) {
    assert.equal(validateSerializedAssetIdentity(asset(), part({ trackingMode })).reason, "not_serial_tracked", `trackingMode=${String(trackingMode)}`);
  }
});

ok("identity must reference exactly the injected Part (id match)", () => {
  assert.equal(validateSerializedAssetIdentity(asset(), part({ partId: "OTHER" })).reason, "part_mismatch");
  assert.equal(validateSerializedAssetIdentity(asset(), null).reason, "part_invalid");
  assert.equal(validateSerializedAssetIdentity(asset(), {}).reason, "part_invalid");
});

ok("trackingMode may NOT be stored on the asset (unknown_field)", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ trackingMode: "SERIAL" }), part()).reason, "unknown_field");
});

// --- identity: fail-closed field validation ---
ok("not_object", () => {
  for (const v of [null, undefined, "x", 5, []]) {
    assert.equal(validateSerializedAssetIdentity(v, part()).reason, "not_object", String(v));
  }
});

ok("unknown_field rejected (no availability/condition smuggling onto identity)", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ availableForAssignment: true }), part()).reason, "unknown_field");
  assert.equal(validateSerializedAssetIdentity(asset({ condition: "NEW" }), part()).reason, "unknown_field");
  assert.equal(validateSerializedAssetIdentity(asset({ label: "Main" }), part()).reason, "unknown_field");
});

ok("serialNo / partId must be non-empty strings", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ serialNo: "" }), part()).reason, "serial_no_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ serialNo: 100 }), part()).reason, "serial_no_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ partId: "  " }), part()).reason, "part_id_invalid");
});

ok("currentLocation must be a valid discriminated reference", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: null }), part()).reason, "current_location_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: { type: "TRUCK", locationId: "T-1" } }), part()).reason, "current_location_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: { type: "WAREHOUSE", locationId: "" } }), part()).reason, "current_location_invalid");
  // A location reference may NOT carry a label here (that is Location display authority).
  assert.equal(validateSerializedAssetIdentity(asset({ currentLocation: { type: "WAREHOUSE", locationId: "WH-1", label: "x" } }), part()).reason, "current_location_invalid");
});

ok("state must be a canonical Rev 6 member; old states rejected", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ state: "available" }), part()).reason, "state_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ state: undefined }), part()).reason, "state_invalid");
  // Pre-correction states no longer exist.
  assert.equal(validateSerializedAssetIdentity(asset({ state: "IN_STOCK" }), part()).reason, "state_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ state: "RETIRED" }), part()).reason, "state_invalid");
});

ok("currentEquipmentId is nullable but never malformed", () => {
  assert.equal(validateSerializedAssetIdentity(asset({ currentEquipmentId: "" }), part()).reason, "current_equipment_id_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentEquipmentId: 5 }), part()).reason, "current_equipment_id_invalid");
  assert.equal(validateSerializedAssetIdentity(asset({ currentEquipmentId: undefined }), part()).valid, true);
});

ok("validation does not mutate inputs", () => {
  const a = asset(), p = part();
  const sa = structuredClone(a), sp = structuredClone(p);
  validateSerializedAssetIdentity(a, p);
  assert.deepEqual(a, sa);
  assert.deepEqual(p, sp);
});

// --- projection: happy path ---
ok("composeAvailableEquipment: id-matched join gated by injected availability", () => {
  const r = composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location(), availability: true });
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, {
    serialNo: "SN-100",
    partId: "PART-1",
    state: "AVAILABLE",
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
    part: { partId: "PART-1", trackingMode: "SERIAL", internalPartNumber: "IPN-42" },
    location: location(),
    availability: true,
  });
  assert.equal(r.valid, true);
  assert.deepEqual([r.value.manufacturer, r.value.model, r.value.category, r.value.type], [null, null, null, null]);
});

// --- projection: availability is an explicitly injected derived gate ---
ok("projection: absent/false availability fails closed (never inferred)", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location() }).reason, "unavailable");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location(), availability: false }).reason, "unavailable");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location(), availability: "true" }).reason, "unavailable");
});

ok("projection: installed unit can never appear even if availability=true is injected (defensive INSTALLED reject)", () => {
  const installed = asset({ state: "INSTALLED", currentEquipmentId: "EQ-9" });
  assert.equal(composeAvailableEquipment({ serializedAsset: installed, part: part(), location: location(), availability: true }).reason, "unavailable");
});

ok("projection: contradictory INSTALLED + null link + availability true is rejected at identity", () => {
  const contradictory = asset({ state: "INSTALLED", currentEquipmentId: null });
  assert.equal(composeAvailableEquipment({ serializedAsset: contradictory, part: part(), location: location(), availability: true }).reason, "asset:installed_requires_link");
});

// --- projection: fail-closed inputs ---
ok("projection: malformed Part fails closed (part checked first)", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: null, location: location(), availability: true }).reason, "part_not_object");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part({ internalPartNumber: "" }), location: location(), availability: true }).reason, "internal_part_number_invalid");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part({ trackingMode: "LOT" }), location: location(), availability: true }).reason, "asset:not_serial_tracked");
});

ok("projection: asset failure propagates with asset: prefix", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: null, part: part(), location: location(), availability: true }).reason, "asset:not_object");
  assert.equal(composeAvailableEquipment({ serializedAsset: {}, part: part(), location: location(), availability: true }).reason, "asset:serial_no_invalid");
});

ok("projection: Part id must match the asset's partId", () => {
  // Part is internally consistent but references a different part than the asset.
  const otherPart = part({ partId: "OTHER" });
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: otherPart, location: location(), availability: true }).reason, "asset:part_mismatch");
});

ok("projection: malformed Location fails closed", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: null, availability: true }).reason, "location_not_object");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ extra: 1 }), availability: true }).reason, "location_unknown_field");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ label: "" }), availability: true }).reason, "location_label_invalid");
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ type: "TRUCK" }), availability: true }).reason, "location_type_invalid");
});

ok("projection: Location id and type must match the asset's location reference", () => {
  assert.equal(composeAvailableEquipment({ serializedAsset: asset(), part: part(), location: location({ locationId: "WH-2" }), availability: true }).reason, "location_mismatch");
  const a = asset({ currentLocation: { type: "BIN", locationId: "WH-1" } });
  assert.equal(composeAvailableEquipment({ serializedAsset: a, part: part(), location: location(), availability: true }).reason, "location_type_mismatch");
});

ok("projection: missing argument object fails closed (no throw)", () => {
  assert.equal(composeAvailableEquipment().reason, "part_not_object");
  assert.equal(composeAvailableEquipment({}).reason, "part_not_object");
});

console.log(`\n${passed} passed`);

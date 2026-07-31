// Enterprise Inventory -- EI-P1a. Deterministic pure unit tests for the inventory
// location-type + reference contract (src/domain/inventoryLocation.js). Proves the
// bounded type set and the fail-closed discriminated reference validation.
//
// Run: node test/inventoryLocation.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  INVENTORY_LOCATION_TYPES,
  isLocationType,
  validateLocationRef,
  isLocationRef,
} from "../src/domain/inventoryLocation.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

ok("exactly six canonical types, frozen", () => {
  assert.deepEqual(INVENTORY_LOCATION_TYPES, ["WAREHOUSE", "BIN", "MOBILE", "VENDOR", "CUSTOMER", "VIRTUAL"]);
  assert.equal(Object.isFrozen(INVENTORY_LOCATION_TYPES), true);
});

ok("isLocationType: exact canonical membership only", () => {
  for (const t of INVENTORY_LOCATION_TYPES) assert.equal(isLocationType(t), true);
  for (const v of ["warehouse", "Bin", " MOBILE", "TRUCK", "", null, undefined, 3, {}]) {
    assert.equal(isLocationType(v), false, `expected reject: ${String(v)}`);
  }
});

ok("validateLocationRef: accepts a minimal discriminated reference", () => {
  const r = validateLocationRef({ type: "WAREHOUSE", locationId: "WH-1" });
  assert.deepEqual(r, { valid: true, value: { type: "WAREHOUSE", locationId: "WH-1" }, reason: null });
});

ok("validateLocationRef: every canonical type is a valid discriminant", () => {
  for (const type of INVENTORY_LOCATION_TYPES) {
    assert.equal(validateLocationRef({ type, locationId: "L-1" }).valid, true, type);
  }
});

ok("validateLocationRef: non-object fails closed", () => {
  for (const v of [null, undefined, "WH-1", 5, true]) {
    assert.equal(validateLocationRef(v).reason, "not_object", `expected not_object: ${String(v)}`);
  }
  // Arrays are not plain-object references.
  assert.equal(validateLocationRef([]).reason, "not_object");
  assert.equal(validateLocationRef(["WAREHOUSE", "WH-1"]).reason, "not_object");
});

ok("validateLocationRef: unknown type fails closed", () => {
  assert.equal(validateLocationRef({ type: "TRUCK", locationId: "T-1" }).reason, "type_invalid");
  assert.equal(validateLocationRef({ type: "warehouse", locationId: "WH-1" }).reason, "type_invalid");
  assert.equal(validateLocationRef({ locationId: "WH-1" }).reason, "type_invalid");
});

ok("validateLocationRef: missing/blank authoritative id fails closed", () => {
  assert.equal(validateLocationRef({ type: "WAREHOUSE", locationId: "" }).reason, "location_id_invalid");
  assert.equal(validateLocationRef({ type: "WAREHOUSE", locationId: "   " }).reason, "location_id_invalid");
  assert.equal(validateLocationRef({ type: "WAREHOUSE", locationId: 7 }).reason, "location_id_invalid");
  assert.equal(validateLocationRef({ type: "WAREHOUSE" }).reason, "location_id_invalid");
});

ok("validateLocationRef: extra fields rejected (no descriptive-authority smuggling)", () => {
  assert.equal(
    validateLocationRef({ type: "WAREHOUSE", locationId: "WH-1", label: "Main" }).reason,
    "unknown_field",
  );
});

ok("validateLocationRef: does not mutate input", () => {
  const input = { type: "MOBILE", locationId: "TRUCK-7" };
  const snapshot = structuredClone(input);
  const out = validateLocationRef(input);
  assert.notEqual(out.value, input); // fresh object
  assert.deepEqual(input, snapshot);
});

ok("isLocationRef: boolean mirror of validation", () => {
  assert.equal(isLocationRef({ type: "BIN", locationId: "B-9" }), true);
  assert.equal(isLocationRef({ type: "BIN" }), false);
  assert.equal(isLocationRef(null), false);
});

console.log(`\n${passed} passed`);

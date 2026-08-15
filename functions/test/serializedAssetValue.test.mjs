// Serialized Asset -- OFFLINE tests for the PURE persistence-contract validator, imported from compiled
// lib. No emulator/Firebase/network. Proves the §D identity contract (docs/specifications/
// serialized-asset-equipment-installation.md), the exact field allowlist, the INSTALLED<->link invariant
// (§L: "no state is both INSTALLED and AVAILABLE"; `currentEquipmentId` single-valued), and the
// Available-Equipment selector (§I: Available = serial stock with null `currentEquipmentId`).
//
// Prerequisite: `npm run build` in functions/ first (this test imports the compiled lib/ output).
import test from "node:test";
import assert from "node:assert/strict";
import {
  SERIALIZED_ASSET_STATES,
  SERIALIZED_ASSET_OWNERSHIP_TYPES,
  validateSerializedAssetValue,
  isSerializedAssetValue,
  isAvailableForEquipmentRead,
} from "../lib/serializedAsset/types.js";

function baseValue(overrides = {}) {
  return {
    serialNo: "SN-1001",
    partId: "PART-1",
    currentLocationId: "WH-MAIN",
    inventoryState: "AVAILABLE",
    currentEquipmentId: null,
    ownership: "COMPANY",
    ...overrides,
  };
}

test("SERIALIZED_ASSET_STATES is the exact 8-value Rev 6 lifecycle set, matching the existing pure client module", () => {
  assert.deepEqual(SERIALIZED_ASSET_STATES, [
    "RECEIVED", "AVAILABLE", "RESERVED", "STAGED", "LOADED", "IN_TRANSIT", "DELIVERED", "INSTALLED",
  ]);
});

test("SERIALIZED_ASSET_OWNERSHIP_TYPES names only the two §D-parenthetical values", () => {
  assert.deepEqual(SERIALIZED_ASSET_OWNERSHIP_TYPES, ["COMPANY", "VENDOR_CONSIGNMENT"]);
});

test("validateSerializedAssetValue accepts a well-formed AVAILABLE, unlinked asset", () => {
  const result = validateSerializedAssetValue(baseValue());
  assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result.value).sort(), [
    "currentEquipmentId", "currentLocationId", "inventoryState", "ownership", "partId", "serialNo",
  ]);
});

test("validateSerializedAssetValue accepts a well-formed INSTALLED, linked asset", () => {
  const result = validateSerializedAssetValue(baseValue({ inventoryState: "INSTALLED", currentEquipmentId: "EQ-1" }));
  assert.equal(result.valid, true);
  assert.equal(result.value.currentEquipmentId, "EQ-1");
});

test("validateSerializedAssetValue rejects a non-object input", () => {
  assert.equal(validateSerializedAssetValue(null).valid, false);
  assert.equal(validateSerializedAssetValue("not-an-object").valid, false);
  assert.equal(validateSerializedAssetValue([]).valid, false);
});

test("validateSerializedAssetValue fails closed on an unknown/foreign field -- never smuggled through", () => {
  const result = validateSerializedAssetValue(baseValue({ availableForAssignment: true }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unknown_field");
});

test("validateSerializedAssetValue rejects a blank/missing serialNo or partId", () => {
  assert.equal(validateSerializedAssetValue(baseValue({ serialNo: "" })).valid, false);
  assert.equal(validateSerializedAssetValue(baseValue({ serialNo: undefined })).valid, false);
  assert.equal(validateSerializedAssetValue(baseValue({ partId: "" })).valid, false);
});

test("validateSerializedAssetValue rejects a blank/missing currentLocationId", () => {
  assert.equal(validateSerializedAssetValue(baseValue({ currentLocationId: "" })).valid, false);
  assert.equal(validateSerializedAssetValue(baseValue({ currentLocationId: undefined })).valid, false);
});

test("validateSerializedAssetValue rejects an unrecognized inventoryState -- never trusted/guessed", () => {
  const result = validateSerializedAssetValue(baseValue({ inventoryState: "BOGUS" }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, "inventory_state_invalid");
});

test("validateSerializedAssetValue rejects an unrecognized ownership value", () => {
  const result = validateSerializedAssetValue(baseValue({ ownership: "CUSTOMER_OWNED" }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, "ownership_invalid");
});

test("validateSerializedAssetValue rejects a malformed currentEquipmentId (number, empty string, object)", () => {
  assert.equal(validateSerializedAssetValue(baseValue({ currentEquipmentId: 42 })).valid, false);
  assert.equal(validateSerializedAssetValue(baseValue({ currentEquipmentId: "" })).valid, false);
  assert.equal(validateSerializedAssetValue(baseValue({ currentEquipmentId: {} })).valid, false);
});

// --- §L invariant: no state is both INSTALLED and AVAILABLE; currentEquipmentId is single-valued and the
// state<->link coupling is enforced at the document level. ---
test("validateSerializedAssetValue rejects INSTALLED with no currentEquipmentId (installed_requires_link)", () => {
  const result = validateSerializedAssetValue(baseValue({ inventoryState: "INSTALLED", currentEquipmentId: null }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, "installed_requires_link");
});

test("validateSerializedAssetValue rejects a non-INSTALLED state carrying a currentEquipmentId (link_requires_installed)", () => {
  for (const state of SERIALIZED_ASSET_STATES.filter((s) => s !== "INSTALLED")) {
    const result = validateSerializedAssetValue(baseValue({ inventoryState: state, currentEquipmentId: "EQ-1" }));
    assert.equal(result.valid, false, `state ${state} must not be permitted to carry a link`);
    assert.equal(result.reason, "link_requires_installed");
  }
});

test("isSerializedAssetValue is a boolean convenience wrapper over the same rules", () => {
  assert.equal(isSerializedAssetValue(baseValue()), true);
  assert.equal(isSerializedAssetValue(baseValue({ inventoryState: "BOGUS" })), false);
});

// --- §I selector: Available = serial stock with null currentEquipmentId (state AVAILABLE specifically,
// not merely "any not-installed state"). ---
test("isAvailableForEquipmentRead is true only for state AVAILABLE with a null link", () => {
  assert.equal(isAvailableForEquipmentRead(validateSerializedAssetValue(baseValue()).value), true);
});

test("isAvailableForEquipmentRead is false for every other lifecycle state, even though none carry a link", () => {
  for (const state of SERIALIZED_ASSET_STATES.filter((s) => s !== "AVAILABLE" && s !== "INSTALLED")) {
    const value = validateSerializedAssetValue(baseValue({ inventoryState: state })).value;
    assert.equal(isAvailableForEquipmentRead(value), false, `state ${state} must not read as Available Equipment`);
  }
});

test("isAvailableForEquipmentRead is false for INSTALLED (both installed-and-available is impossible; INSTALLED is never AVAILABLE)", () => {
  const value = validateSerializedAssetValue(baseValue({ inventoryState: "INSTALLED", currentEquipmentId: "EQ-1" })).value;
  assert.equal(isAvailableForEquipmentRead(value), false);
});

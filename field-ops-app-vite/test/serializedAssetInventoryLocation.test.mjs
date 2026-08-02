// EI-P2a -- deterministic pure unit tests for the ledger-derived serialized-asset inventory-location
// row contract (src/domain/serializedAssetInventoryLocation.js), its MOBILE projection adapter, and
// the inert access seam (src/access/mobileSerializedAssetsSource.js). Proves: equipment authority is
// untouched (no equipment/installation fields, INSTALLED excluded), SERIAL Part eligibility required,
// MOBILE location + accessVersion binding, wrong-location assets never surface, INSTALLED/linked
// assets never surface, unknown lifecycle state fails closed, NO Condition enum/value invented, no
// quantity/value/custody/driver/GPS inference, deterministic + non-mutating output; and end-to-end
// through the merged mobileLocationInventoryProjection (locationId + accessVersion binding still govern).
//
// Run: node test/serializedAssetInventoryLocation.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import * as mod from "../src/domain/serializedAssetInventoryLocation.js";
import {
  validateSerializedAssetInventoryRow,
  isSerializedAssetInventoryRow,
  projectMobileSerializedAssets,
  SERIALIZED_ASSET_STATES,
} from "../src/domain/serializedAssetInventoryLocation.js";
import { inertMobileSerializedAssetsSource } from "../src/access/mobileSerializedAssetsSource.js";
import { composeMobileLocationInventory, MOBILE_INVENTORY_SECTION_STATE as S } from "../src/domain/mobileLocationInventoryProjection.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const PART = { partId: "PART-1", trackingMode: "SERIAL", internalPartNumber: "IPN-1" };
const mobileAsset = (over = {}) => ({ serialNo: "SN-100", partId: "PART-1", currentLocation: { type: "MOBILE", locationId: "1" }, state: "LOADED", currentEquipmentId: null, ...over });
const rec = (over = {}) => ({ asset: mobileAsset(over.asset), part: over.part || PART });

// ---- row validator: happy path + shape ----------------------------------------------------------
ok("valid non-installed MOBILE asset -> row carries only ledger-derived facts (no equipment fields)", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset(), PART);
  assert.equal(r.valid, true);
  assert.deepEqual(Object.keys(r.value).sort(), ["inventoryLocation", "partId", "serialNo", "state"]);
  assert.deepEqual(r.value.inventoryLocation, { type: "MOBILE", locationId: "1" });
  assert.equal(r.value.state, "LOADED");
  assert.ok(!("currentEquipmentId" in r.value) && !("equipmentId" in r.value) && !("condition" in r.value));
});

// ---- SERIAL Part eligibility --------------------------------------------------------------------
ok("SERIAL Part eligibility is required (non-SERIAL Part -> invalid)", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset(), { partId: "PART-1", trackingMode: "QUANTITY", internalPartNumber: "IPN-1" });
  assert.equal(r.valid, false);
  assert.equal(r.reason, "not_serial_tracked");
  assert.equal(isSerializedAssetInventoryRow(mobileAsset(), PART), true);
});

// ---- equipment authority untouched: INSTALLED / linked never counts as truck inventory ----------
ok("INSTALLED (equipment-linked) asset is excluded as truck inventory", () => {
  const installed = mobileAsset({ state: "INSTALLED", currentEquipmentId: "EQ-9" });
  const r = validateSerializedAssetInventoryRow(installed, PART);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "installed_not_inventory");
});

ok("a non-installed state carrying an equipment link fails closed (contradictory read)", () => {
  const linked = mobileAsset({ state: "LOADED", currentEquipmentId: "EQ-9" });
  const r = validateSerializedAssetInventoryRow(linked, PART);
  assert.equal(r.valid, false); // identity's link_requires_installed coupling
});

// ---- unknown lifecycle state --------------------------------------------------------------------
ok("unknown lifecycle state fails closed", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset({ state: "FLYING" }), PART);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "state_invalid");
});

// ---- NO Condition invented ----------------------------------------------------------------------
ok("a smuggled Condition field is rejected; no Condition enum is exported", () => {
  const withCondition = { ...mobileAsset(), condition: "New" };
  const r = validateSerializedAssetInventoryRow(withCondition, PART);
  assert.equal(r.valid, false); // identity rejects unknown fields
  assert.equal(r.reason, "unknown_field");
  assert.equal("SERIALIZED_ASSET_CONDITIONS" in mod, false);
  assert.equal("CONDITIONS" in mod, false);
});

// ---- adapter: MOBILE location + accessVersion binding -------------------------------------------
ok("adapter includes a valid non-installed asset at the requested MOBILE location", () => {
  const src = projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "v1" });
  assert.deepEqual({ status: src.status, accessVersion: src.accessVersion, locationId: src.locationId }, { status: "ready", accessVersion: "v1", locationId: "1" });
  assert.equal(src.items.length, 1);
  assert.equal(src.items[0].serial, "SN-100");
  assert.equal(src.items[0].status, "LOADED"); // lifecycle state placed in the single status slot
  assert.ok(!("condition" in src.items[0]));
});

ok("adapter fails closed on a malformed request (blank locationId or accessVersion)", () => {
  assert.deepEqual(projectMobileSerializedAssets({ records: [rec()], locationId: "", accessVersion: "v1" }), { status: "error", accessVersion: "v1", locationId: null, items: null });
  assert.deepEqual(projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "" }), { status: "error", accessVersion: null, locationId: null, items: null });
});

ok("wrong-location assets never surface", () => {
  const other = rec({ asset: { currentLocation: { type: "MOBILE", locationId: "2" } } });
  const src = projectMobileSerializedAssets({ records: [other], locationId: "1", accessVersion: "v1" });
  assert.deepEqual(src.items, []);
});

ok("non-MOBILE (e.g. WAREHOUSE) assets never surface in a MOBILE projection", () => {
  const wh = rec({ asset: { currentLocation: { type: "WAREHOUSE", locationId: "1" }, state: "AVAILABLE" } });
  const src = projectMobileSerializedAssets({ records: [wh], locationId: "1", accessVersion: "v1" });
  assert.deepEqual(src.items, []);
});

ok("adapter drops malformed / installed / linked records but keeps valid ones", () => {
  const records = [
    rec(), // valid
    rec({ asset: { state: "INSTALLED", currentEquipmentId: "EQ-1" } }), // installed
    rec({ asset: { serialNo: "SN-200", currentLocation: { type: "MOBILE", locationId: "1" }, state: "STAGED" } }), // valid
    { asset: 42, part: PART }, // malformed
    rec({ asset: { currentLocation: { type: "MOBILE", locationId: "2" } } }), // wrong location
  ];
  const src = projectMobileSerializedAssets({ records, locationId: "1", accessVersion: "v1" });
  assert.deepEqual(src.items.map((i) => i.serial).sort(), ["SN-100", "SN-200"]);
});

// ---- no quantity/value/custody/driver/GPS inference ---------------------------------------------
ok("output carries no quantity/value/custody/driver/GPS inference", () => {
  const src = projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "v1" });
  const item = src.items[0];
  assert.deepEqual(Object.keys(item).sort(), ["assetId", "currentLocation", "internalSku", "manufacturer", "model", "serial", "status"]);
  for (const forbidden of ["quantity", "onHand", "reserved", "available", "value", "inventoryValue", "custody", "driver", "assignedDriverEmployeeId", "employeeId", "gps", "coordinates", "location"]) {
    assert.ok(!(forbidden in item), `item must not carry ${forbidden}`);
  }
});

// ---- deterministic + non-mutating ---------------------------------------------------------------
ok("deterministic + non-mutating", () => {
  const records = [rec(), rec({ asset: { serialNo: "SN-200", currentLocation: { type: "MOBILE", locationId: "1" }, state: "IN_TRANSIT" } })];
  const snapshot = JSON.stringify(records);
  const a = projectMobileSerializedAssets({ records, locationId: "1", accessVersion: "v1" });
  const b = projectMobileSerializedAssets({ records, locationId: "1", accessVersion: "v1" });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(records), snapshot, "inputs must not be mutated");
});

// ---- inert access seam --------------------------------------------------------------------------
ok("inert MOBILE serializedAssets source is UNAVAILABLE with no items (honest default)", () => {
  assert.equal(inertMobileSerializedAssetsSource.status, "unavailable");
  assert.ok(!("items" in inertMobileSerializedAssetsSource));
});

// ---- end-to-end through the merged composer (binding still governs) -----------------------------
ok("composed through mobileLocationInventoryProjection: serializedAssets READY, lifecycle state survives gating", () => {
  const source = projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "v1" });
  const composed = composeMobileLocationInventory({
    identity: { truckId: "1", locationId: "1" }, boundaryKey: "v1",
    options: { equipmentStatus: SERIALIZED_ASSET_STATES }, sources: { serializedAssets: source },
  });
  assert.equal(composed.sections.serializedAssets.state, S.READY);
  assert.equal(composed.sections.serializedAssets.items[0].serial, "SN-100");
  assert.equal(composed.sections.serializedAssets.items[0].status, "LOADED"); // survived the governed gate
});

ok("composer locationId/accessVersion binding still governs the adapter's source", () => {
  const src2 = projectMobileSerializedAssets({ records: [rec()], locationId: "2", accessVersion: "v1" });
  // source scoped to location 2 must never surface under identity location 1
  const composed = composeMobileLocationInventory({
    identity: { truckId: "1", locationId: "1" }, boundaryKey: "v1",
    options: { equipmentStatus: SERIALIZED_ASSET_STATES }, sources: { serializedAssets: src2 },
  });
  assert.notEqual(composed.sections.serializedAssets.state, S.READY);
  assert.equal(composed.sections.serializedAssets.items, null);
});

console.log(`\n${passed} passed`);

// EI-P2a -- deterministic pure unit tests for the ledger-derived serialized-asset inventory-location
// row contract (src/domain/serializedAssetInventoryLocation.js), its MOBILE projection adapter, and
// the inert access seam (src/access/mobileSerializedAssetsSource.js). Proves: equipment authority is
// untouched (no equipment/installation fields, INSTALLED excluded), SERIAL Part eligibility required,
// MOBILE location + accessVersion binding, wrong-location assets never surface, INSTALLED/linked
// assets never surface, unknown lifecycle state fails closed, NO Condition enum/value invented, no
// quantity/value/custody/driver/GPS inference, deterministic + non-mutating; the adapter's fail-closed
// source-status + record-payload contract (governed section states only, explicit READY required,
// null-safe argument, never a fabricated READY-empty result); and end-to-end through the merged
// mobileLocationInventoryProjection (locationId + accessVersion binding still govern).
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
// Adapter call with an EXPLICIT ready status (there is no default); override via spread.
const project = (over = {}) => projectMobileSerializedAssets({ locationId: "1", accessVersion: "v1", status: "ready", ...over });

// ---- row validator: happy path + shape ----------------------------------------------------------
ok("valid non-installed MOBILE asset -> row carries only ledger-derived facts (no equipment fields)", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset(), PART);
  assert.equal(r.valid, true);
  assert.deepEqual(Object.keys(r.value).sort(), ["inventoryLocation", "partId", "serialNo", "state"]);
  assert.deepEqual(r.value.inventoryLocation, { type: "MOBILE", locationId: "1" });
  assert.equal(r.value.state, "LOADED");
  assert.ok(!("currentEquipmentId" in r.value) && !("equipmentId" in r.value) && !("condition" in r.value));
});

ok("SERIAL Part eligibility is required (non-SERIAL Part -> invalid)", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset(), { partId: "PART-1", trackingMode: "QUANTITY", internalPartNumber: "IPN-1" });
  assert.equal(r.valid, false);
  assert.equal(r.reason, "not_serial_tracked");
  assert.equal(isSerializedAssetInventoryRow(mobileAsset(), PART), true);
});

ok("INSTALLED (equipment-linked) asset is excluded as truck inventory", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset({ state: "INSTALLED", currentEquipmentId: "EQ-9" }), PART);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "installed_not_inventory");
});

ok("a non-installed state carrying an equipment link fails closed (contradictory read)", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset({ state: "LOADED", currentEquipmentId: "EQ-9" }), PART);
  assert.equal(r.valid, false);
});

ok("unknown lifecycle state fails closed", () => {
  const r = validateSerializedAssetInventoryRow(mobileAsset({ state: "FLYING" }), PART);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "state_invalid");
});

ok("a smuggled Condition field is rejected; no Condition enum is exported", () => {
  const r = validateSerializedAssetInventoryRow({ ...mobileAsset(), condition: "New" }, PART);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "unknown_field");
  assert.equal("SERIALIZED_ASSET_CONDITIONS" in mod, false);
  assert.equal("CONDITIONS" in mod, false);
});

// ---- adapter: READY happy path + binding + filtering --------------------------------------------
ok("adapter (explicit ready) includes a valid non-installed asset at the requested MOBILE location", () => {
  const src = project({ records: [rec()] });
  assert.deepEqual({ status: src.status, accessVersion: src.accessVersion, locationId: src.locationId }, { status: "ready", accessVersion: "v1", locationId: "1" });
  assert.equal(src.items.length, 1);
  assert.equal(src.items[0].serial, "SN-100");
  assert.equal(src.items[0].status, "LOADED");
  assert.ok(!("condition" in src.items[0]));
});

ok("adapter fails closed on a malformed request (blank locationId or accessVersion)", () => {
  assert.deepEqual(project({ records: [rec()], locationId: "" }), { status: "error", accessVersion: "v1", locationId: null, items: null });
  assert.deepEqual(project({ records: [rec()], accessVersion: "" }), { status: "error", accessVersion: null, locationId: "1", items: null });
});

ok("wrong-location assets never surface", () => {
  assert.deepEqual(project({ records: [rec({ asset: { currentLocation: { type: "MOBILE", locationId: "2" } } })] }).items, []);
});

ok("non-MOBILE (e.g. WAREHOUSE) assets never surface in a MOBILE projection", () => {
  assert.deepEqual(project({ records: [rec({ asset: { currentLocation: { type: "WAREHOUSE", locationId: "1" }, state: "AVAILABLE" } })] }).items, []);
});

ok("adapter drops malformed / installed / linked records but keeps valid ones", () => {
  const records = [
    rec(),
    rec({ asset: { state: "INSTALLED", currentEquipmentId: "EQ-1" } }),
    rec({ asset: { serialNo: "SN-200", currentLocation: { type: "MOBILE", locationId: "1" }, state: "STAGED" } }),
    { asset: 42, part: PART },
    rec({ asset: { currentLocation: { type: "MOBILE", locationId: "2" } } }),
  ];
  assert.deepEqual(project({ records }).items.map((i) => i.serial).sort(), ["SN-100", "SN-200"]);
});

ok("output carries no quantity/value/custody/driver/GPS inference", () => {
  const item = project({ records: [rec()] }).items[0];
  assert.deepEqual(Object.keys(item).sort(), ["assetId", "currentLocation", "internalSku", "manufacturer", "model", "serial", "status"]);
  for (const forbidden of ["quantity", "onHand", "reserved", "available", "value", "inventoryValue", "custody", "driver", "assignedDriverEmployeeId", "employeeId", "gps", "coordinates", "location"]) {
    assert.ok(!(forbidden in item), `item must not carry ${forbidden}`);
  }
});

// ---- fail-closed source status / payload --------------------------------------------------------
for (const st of ["denied", "error", "loading", "unavailable"]) {
  ok(`status="${st}" + valid records -> ${st.toUpperCase()} with items:null (records not processed)`, () => {
    const src = project({ records: [rec()], status: st });
    assert.equal(src.status, st);
    assert.equal(src.items, null);
    assert.equal(src.locationId, "1");
    assert.equal(src.accessVersion, "v1");
  });
}

ok("unknown/malformed status + valid records -> ERROR, items:null (unknown never passes through)", () => {
  for (const bad of ["ready-ish", "READY", "", 42, null, {}]) {
    const src = project({ records: [rec()], status: bad });
    assert.equal(src.status, "error");
    assert.equal(src.items, null);
    assert.notEqual(src.status, bad);
  }
});

ok("READY + non-array records (null/object/string/number/boolean) -> ERROR, items:null (never READY-empty)", () => {
  for (const bad of [null, {}, { 0: rec() }, "recs", 5, true]) {
    const src = project({ records: bad });
    assert.equal(src.status, "error", `records=${JSON.stringify(bad)}`);
    assert.equal(src.items, null);
  }
});

ok("READY + [] -> READY with items:[] (legitimate empty read preserved)", () => {
  assert.deepEqual(project({ records: [] }), { status: "ready", accessVersion: "v1", locationId: "1", items: [] });
});

ok("explicit READY + valid records still succeeds", () => {
  const src = projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "v1", status: "ready" });
  assert.equal(src.status, "ready");
  assert.equal(src.items.length, 1);
  assert.equal(src.items[0].serial, "SN-100");
});

// ---- follow-up: require EXPLICIT ready status + null-safe argument -------------------------------
ok("OMITTED status with otherwise-valid input -> ERROR, items:null (no default ready)", () => {
  const src = projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "v1" });
  assert.equal(src.status, "error");
  assert.equal(src.items, null);
});

ok("explicit status:undefined -> ERROR, items:null", () => {
  const src = projectMobileSerializedAssets({ records: [rec()], locationId: "1", accessVersion: "v1", status: undefined });
  assert.equal(src.status, "error");
  assert.equal(src.items, null);
});

ok("non-object argument (null / array / string / number / boolean / undefined) -> ERROR, items:null, never throws", () => {
  for (const bad of [null, undefined, [], [rec()], "x", 5, true, false, NaN]) {
    let src;
    assert.doesNotThrow(() => { src = projectMobileSerializedAssets(bad); });
    assert.deepEqual(src, { status: "error", accessVersion: null, locationId: null, items: null }, `arg=${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => projectMobileSerializedAssets());
});

// ---- deterministic + non-mutating ---------------------------------------------------------------
ok("deterministic + non-mutating", () => {
  const records = [rec(), rec({ asset: { serialNo: "SN-200", currentLocation: { type: "MOBILE", locationId: "1" }, state: "IN_TRANSIT" } })];
  const snapshot = JSON.stringify(records);
  assert.deepEqual(project({ records }), project({ records }));
  assert.equal(JSON.stringify(records), snapshot, "inputs must not be mutated");
});

// ---- inert access seam --------------------------------------------------------------------------
ok("inert MOBILE serializedAssets source is UNAVAILABLE with no items (honest default)", () => {
  assert.equal(inertMobileSerializedAssetsSource.status, "unavailable");
  assert.ok(!("items" in inertMobileSerializedAssetsSource));
});

// ---- end-to-end through the merged composer (binding still governs) -----------------------------
ok("composed through mobileLocationInventoryProjection: serializedAssets READY, lifecycle state survives gating", () => {
  const source = project({ records: [rec()] });
  const composed = composeMobileLocationInventory({
    identity: { truckId: "1", locationId: "1" }, boundaryKey: "v1",
    options: { equipmentStatus: SERIALIZED_ASSET_STATES }, sources: { serializedAssets: source },
  });
  assert.equal(composed.sections.serializedAssets.state, S.READY);
  assert.equal(composed.sections.serializedAssets.items[0].serial, "SN-100");
  assert.equal(composed.sections.serializedAssets.items[0].status, "LOADED");
});

ok("composer locationId/accessVersion binding still governs the adapter's source", () => {
  const src2 = project({ records: [rec()], locationId: "2" });
  const composed = composeMobileLocationInventory({
    identity: { truckId: "1", locationId: "1" }, boundaryKey: "v1",
    options: { equipmentStatus: SERIALIZED_ASSET_STATES }, sources: { serializedAssets: src2 },
  });
  assert.notEqual(composed.sections.serializedAssets.state, S.READY);
  assert.equal(composed.sections.serializedAssets.items, null);
});

console.log(`\n${passed} passed`);

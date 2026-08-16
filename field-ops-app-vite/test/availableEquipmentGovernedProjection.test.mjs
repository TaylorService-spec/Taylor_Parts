// Sandbox-fidelity Part 3 -- tests for the pure mapper from the TRUSTED `getAvailableEquipment`
// callable's raw envelope into the flat asset-row shape domain/availableEquipmentCatalogView.js
// consumes. Proves: only well-formed, genuinely-available rows survive; a non-"ready" envelope or a
// malformed row never fabricates a row; availableForAssignment is RE-DERIVED (never trusted blindly);
// and the location field carries the RAW currentLocationId scalar -- never a fabricated {type,label}.
//
// Run: node test/availableEquipmentGovernedProjection.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  mapProjectionRowToAsset,
  mapAvailableEquipmentProjectionToAssets,
} from "../src/domain/availableEquipmentGovernedProjection.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const GOOD_ROW = {
  serialNo: "SN-100",
  partId: "P-1",
  currentLocationId: "loc-warehouse-1",
  inventoryState: "AVAILABLE",
  currentEquipmentId: null,
  ownership: "COMPANY",
};

ok("mapProjectionRowToAsset maps a well-formed AVAILABLE row with a raw location id", () => {
  const asset = mapProjectionRowToAsset(GOOD_ROW);
  assert.deepStrictEqual(asset, {
    serialNo: "SN-100",
    partId: "P-1",
    currentEquipmentId: null,
    availableForAssignment: true,
    status: "AVAILABLE",
    location: "loc-warehouse-1",
  });
});

ok("mapProjectionRowToAsset never fabricates a location {type,label} -- raw scalar only", () => {
  const asset = mapProjectionRowToAsset(GOOD_ROW);
  assert.strictEqual(typeof asset.location, "string");
  assert.ok(!("type" in asset));
  assert.ok(!("locationLabel" in asset));
});

ok("mapProjectionRowToAsset re-derives availableForAssignment rather than trusting a claim", () => {
  // A row that CLAIMS to be installed (currentEquipmentId set) must never be marked available, even
  // though the server-side query is supposed to have already excluded it -- fail closed, don't trust.
  const installed = { ...GOOD_ROW, currentEquipmentId: "EQ-7" };
  const asset = mapProjectionRowToAsset(installed);
  assert.strictEqual(asset.availableForAssignment, false);
  assert.strictEqual(asset.currentEquipmentId, "EQ-7");

  const wrongState = { ...GOOD_ROW, inventoryState: "RESERVED" };
  assert.strictEqual(mapProjectionRowToAsset(wrongState).availableForAssignment, false);
});

ok("mapProjectionRowToAsset fails closed on malformed rows -- never fabricates a row", () => {
  assert.strictEqual(mapProjectionRowToAsset(null), null);
  assert.strictEqual(mapProjectionRowToAsset({}), null);
  assert.strictEqual(mapProjectionRowToAsset({ ...GOOD_ROW, serialNo: "" }), null);
  assert.strictEqual(mapProjectionRowToAsset({ ...GOOD_ROW, partId: null }), null);
  assert.strictEqual(mapProjectionRowToAsset({ ...GOOD_ROW, currentEquipmentId: 12345 }), null); // wrong type
  assert.strictEqual(mapProjectionRowToAsset({ ...GOOD_ROW, currentEquipmentId: "" }), null); // blank string invalid
});

ok("mapProjectionRowToAsset treats a missing/blank currentLocationId as no authoritative location", () => {
  assert.strictEqual(mapProjectionRowToAsset({ ...GOOD_ROW, currentLocationId: "" }).location, null);
  assert.strictEqual(mapProjectionRowToAsset({ ...GOOD_ROW, currentLocationId: undefined }).location, null);
});

ok("mapAvailableEquipmentProjectionToAssets: ready envelope maps well-formed rows, skips malformed", () => {
  const rawResult = {
    status: "ready",
    availableEquipment: [GOOD_ROW, { ...GOOD_ROW, serialNo: "SN-101", partId: "P-2" }, { junk: true }, null],
    excludedCount: 2,
  };
  const assets = mapAvailableEquipmentProjectionToAssets(rawResult);
  assert.deepStrictEqual(assets.map((a) => a.serialNo), ["SN-100", "SN-101"]);
});

ok("mapAvailableEquipmentProjectionToAssets fails closed on a non-ready or malformed envelope", () => {
  assert.deepStrictEqual(mapAvailableEquipmentProjectionToAssets(null), []);
  assert.deepStrictEqual(mapAvailableEquipmentProjectionToAssets(undefined), []);
  assert.deepStrictEqual(mapAvailableEquipmentProjectionToAssets({}), []);
  assert.deepStrictEqual(mapAvailableEquipmentProjectionToAssets({ status: "denied", availableEquipment: [GOOD_ROW] }), []);
  assert.deepStrictEqual(mapAvailableEquipmentProjectionToAssets({ status: "ready", availableEquipment: "not-an-array" }), []);
});

console.log(`\n${passed} passed`);

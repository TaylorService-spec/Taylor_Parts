// PART 11A -- tests for the pure location-DISPLAY resolution layer
// (src/domain/locationDisplayProjection.js). Proves: distinct-id extraction is bounded to what the
// rows actually carry; the callable envelope mapper fails closed on any malformed/non-"ready" shape
// and never fabricates a `type`; merging never overwrites a row's raw fallback for an unresolved id;
// and the coarse render state (authorized/denied/empty/unavailable) is a distinct value per axis.
//
// Run: node test/locationDisplayProjection.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  distinctLocationIds,
  mapLocationDisplayResultToMap,
  applyLocationDisplay,
  deriveLocationDisplayState,
  LOCATION_DISPLAY_STATE,
} from "../src/domain/locationDisplayProjection.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ---------------------------- distinctLocationIds ----------------------------
ok("distinctLocationIds: dedupes and drops rows without a location", () => {
  const assets = [{ location: "WH-1" }, { location: "WH-2" }, { location: "WH-1" }, { location: null }, {}];
  assert.deepStrictEqual(distinctLocationIds(assets).sort(), ["WH-1", "WH-2"]);
});
ok("distinctLocationIds: non-array input -> empty array (fail closed)", () => {
  assert.deepStrictEqual(distinctLocationIds(null), []);
  assert.deepStrictEqual(distinctLocationIds(undefined), []);
  assert.deepStrictEqual(distinctLocationIds("not-an-array"), []);
});

// ---------------------------- mapLocationDisplayResultToMap ----------------------------
ok("mapLocationDisplayResultToMap: a clean ready envelope maps WAREHOUSE + MOBILE entries", () => {
  const map = mapLocationDisplayResultToMap({
    status: "ready",
    locations: [
      { locationId: "WH-1", type: "WAREHOUSE", label: "Main Warehouse" },
      { locationId: "MLOC-1", type: "MOBILE", label: "Truck 204" },
    ],
  });
  assert.equal(map.size, 2);
  assert.deepStrictEqual(map.get("WH-1"), { locationId: "WH-1", type: "WAREHOUSE", label: "Main Warehouse" });
  assert.deepStrictEqual(map.get("MLOC-1"), { locationId: "MLOC-1", type: "MOBILE", label: "Truck 204" });
});
ok("mapLocationDisplayResultToMap: UNRESOLVED entries pass through with label null (never a fabricated type/label)", () => {
  const map = mapLocationDisplayResultToMap({ status: "ready", locations: [{ locationId: "CUST-1", type: "UNRESOLVED", label: null }] });
  assert.deepStrictEqual(map.get("CUST-1"), { locationId: "CUST-1", type: "UNRESOLVED", label: null });
});
ok("mapLocationDisplayResultToMap: a non-ready status yields an EMPTY map, never throws", () => {
  assert.equal(mapLocationDisplayResultToMap({ status: "denied", locations: [] }).size, 0);
  assert.equal(mapLocationDisplayResultToMap(null).size, 0);
  assert.equal(mapLocationDisplayResultToMap(undefined).size, 0);
  assert.equal(mapLocationDisplayResultToMap("garbage").size, 0);
  assert.equal(mapLocationDisplayResultToMap({ status: "ready", locations: "not-an-array" }).size, 0);
});
ok("mapLocationDisplayResultToMap: malformed entries are dropped individually, never fabricated -- fail closed per row", () => {
  const map = mapLocationDisplayResultToMap({
    status: "ready",
    locations: [
      { locationId: "WH-1", type: "WAREHOUSE", label: "Main" }, // good
      { locationId: "WH-2", type: "WAREHOUSE", label: "" }, // blank label for a resolvable type -- dropped
      { locationId: "WH-3", type: "WAREHOUSE", label: null }, // null label for a resolvable type -- dropped
      { locationId: "WH-4", type: "CUSTOMER", label: "Fabricated" }, // ungoverned type -- dropped entirely
      { locationId: "", type: "WAREHOUSE", label: "Blank id" }, // blank id -- dropped
      { locationId: "WH-5", type: "UNRESOLVED", label: "Should be null" }, // UNRESOLVED with a non-null label -- dropped
      "not-an-object",
      null,
    ],
  });
  assert.deepStrictEqual([...map.keys()], ["WH-1"]);
});

// ---------------------------- applyLocationDisplay ----------------------------
ok("applyLocationDisplay: sets locationLabel only for rows whose raw location resolved to a real (non-UNRESOLVED) entry", () => {
  const assets = [
    { serialNo: "A", location: "WH-1" },
    { serialNo: "B", location: "MLOC-1" },
    { serialNo: "C", location: "CUST-1" }, // resolves to UNRESOLVED -- must stay unlabeled
    { serialNo: "D", location: "WH-UNKNOWN" }, // not in the map at all -- must stay unlabeled
    { serialNo: "E", location: null }, // no location at all
  ];
  const map = mapLocationDisplayResultToMap({
    status: "ready",
    locations: [
      { locationId: "WH-1", type: "WAREHOUSE", label: "Main Warehouse" },
      { locationId: "MLOC-1", type: "MOBILE", label: "Truck 204" },
      { locationId: "CUST-1", type: "UNRESOLVED", label: null },
    ],
  });
  const out = applyLocationDisplay(assets, map);
  assert.equal(out[0].locationLabel, "Main Warehouse");
  assert.equal(out[1].locationLabel, "Truck 204");
  assert.equal("locationLabel" in out[2], false);
  assert.equal("locationLabel" in out[3], false);
  assert.equal("locationLabel" in out[4], false);
  // Pure: the input rows are untouched.
  assert.equal("locationLabel" in assets[0], false);
});
ok("applyLocationDisplay: non-array assets -> empty array; a non-Map displayMap is treated as empty", () => {
  assert.deepStrictEqual(applyLocationDisplay(null, new Map()), []);
  assert.deepStrictEqual(applyLocationDisplay([{ serialNo: "A", location: "WH-1" }], "not-a-map"), [{ serialNo: "A", location: "WH-1" }]);
});

// ---------------------------- deriveLocationDisplayState ----------------------------
ok("deriveLocationDisplayState: zero requested ids -> READY (nothing to resolve is not a failure)", () => {
  assert.equal(deriveLocationDisplayState({ sourceStatus: "loading", requestedCount: 0, resolvedCount: 0 }), LOCATION_DISPLAY_STATE.READY);
});
ok("deriveLocationDisplayState: LOADING/DENIED/UNAVAILABLE/EMPTY/READY are five distinct values when ids are requested", () => {
  assert.equal(deriveLocationDisplayState({ sourceStatus: "loading", requestedCount: 2, resolvedCount: 0 }), LOCATION_DISPLAY_STATE.LOADING);
  assert.equal(deriveLocationDisplayState({ sourceStatus: "denied", requestedCount: 2, resolvedCount: 0 }), LOCATION_DISPLAY_STATE.DENIED);
  assert.equal(deriveLocationDisplayState({ sourceStatus: "unavailable", requestedCount: 2, resolvedCount: 0 }), LOCATION_DISPLAY_STATE.UNAVAILABLE);
  assert.equal(deriveLocationDisplayState({ sourceStatus: "bogus", requestedCount: 2, resolvedCount: 0 }), LOCATION_DISPLAY_STATE.UNAVAILABLE);
  assert.equal(deriveLocationDisplayState({ sourceStatus: "ready", requestedCount: 2, resolvedCount: 0 }), LOCATION_DISPLAY_STATE.EMPTY);
  assert.equal(deriveLocationDisplayState({ sourceStatus: "ready", requestedCount: 2, resolvedCount: 1 }), LOCATION_DISPLAY_STATE.READY);
  const states = new Set([
    deriveLocationDisplayState({ sourceStatus: "loading", requestedCount: 1, resolvedCount: 0 }),
    deriveLocationDisplayState({ sourceStatus: "denied", requestedCount: 1, resolvedCount: 0 }),
    deriveLocationDisplayState({ sourceStatus: "unavailable", requestedCount: 1, resolvedCount: 0 }),
    deriveLocationDisplayState({ sourceStatus: "ready", requestedCount: 1, resolvedCount: 0 }),
    deriveLocationDisplayState({ sourceStatus: "ready", requestedCount: 1, resolvedCount: 1 }),
  ]);
  assert.equal(states.size, 5, "all five states must be distinct");
});

console.log(`\n${passed} tests passed`);

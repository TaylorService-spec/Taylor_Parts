// EI-P1d-2-2a -- deterministic pure unit tests for the registry-source bridge
// (src/access/truckRegistrySource.js). Proves: sanitized DENIED/ERROR/UNAVAILABLE, the
// inert default, READY composition through the merged composeTruckFleet, fail-closed on
// malformed docs, inactive-MOBILE-Location trucks kept visible + clearly marked, and the
// accessVersion boundary key (a source built for a prior version becomes LOADING when read at
// a new boundary -- stale-data prevention), verified end-to-end through the merged
// readTruckInventorySource. Fixtures live here in the test only -- never production.
//
// Run: node test/truckRegistrySource.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { REGISTRY_READ_STATUS, buildTruckInventorySourceFromRegistry as build } from "../src/access/truckRegistrySource.js";
import { readTruckInventorySource } from "../src/access/truckInventorySource.js";
import { SERIALIZED_ASSET_STATES } from "../src/domain/serializedAssetIdentity.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const LOC = "MLOC-204";
const locDoc = (over = {}) => ({ docId: LOC, data: { locationId: LOC, type: "MOBILE", displayLabel: "Truck 204", active: true, ...over } });
const truckDoc = (over = {}) => ({ docId: "TRK-204", data: { truckId: "TRK-204", locationId: LOC, vehicleNumber: "204", displayLabel: "Truck 204", status: "ACTIVE", homeWarehouseId: "WH-MAIN", assignedDriverEmployeeId: "emp-mb", ...over } });

ok("accepted read statuses are the fail-closed set", () => {
  assert.deepEqual(REGISTRY_READ_STATUS, ["ready", "loading", "denied", "error", "unavailable"]);
});

// --- sanitized non-ready + inert default ---
ok("denied / error / loading are sanitized (no trucks, no payload); accessVersion stamped", () => {
  assert.deepEqual(build({ status: "denied", accessVersion: 3 }), { connected: false, status: "denied", accessVersion: 3, trucks: [] });
  const err = build({ status: "error", accessVersion: 4 });
  assert.deepEqual(err, { connected: false, status: "error", accessVersion: 4, trucks: [] });
  assert.equal("options" in err, false); // no payload on error
  assert.deepEqual(build({ status: "loading", accessVersion: 5 }), { connected: false, status: "loading", accessVersion: 5, trucks: [] });
});

ok("unknown status / no input -> inert unavailable (never fabricated)", () => {
  assert.equal(build({ status: "bogus", accessVersion: 1 }).status, "unavailable");
  assert.equal(build().status, "unavailable");
  assert.deepEqual(build().trucks, []);
});

// --- READY success + empty ---
ok("READY success: composes trucks + governed options; accessVersion stamped", () => {
  const src = build({ status: "ready", mobileLocationDocs: [locDoc()], truckDocs: [truckDoc()], accessVersion: 1, resolveDriverName: (id) => (id === "emp-mb" ? "Marcus Bell" : null) });
  assert.equal(src.connected, true);
  assert.equal(src.status, "ready");
  assert.equal(src.accessVersion, 1);
  assert.equal(src.trucks.length, 1);
  assert.equal(src.trucks[0].id, "TRK-204");
  assert.equal(src.trucks[0].technician, "Marcus Bell");
  assert.equal(src.trucks[0].location, "Truck 204");
  assert.equal(src.trucks[0].locationActive, true);
  assert.deepEqual(src.options.fleetStatus, ["ACTIVE", "IDLE", "OUT_OF_SERVICE"]);
  assert.deepEqual(src.options.equipmentStatus, [...SERIALIZED_ASSET_STATES]);
  assert.deepEqual(src.options.equipmentCondition, []); // deferred by default
});

ok("READY empty: connected with no trucks (workspace shows the empty state)", () => {
  const src = build({ status: "ready", mobileLocationDocs: [], truckDocs: [], accessVersion: 2 });
  assert.equal(src.connected, true);
  assert.equal(src.status, "ready");
  assert.deepEqual(src.trucks, []);
  assert.equal(src.options.fleetStatus.length, 3);
});

ok("READY passes an injected governed condition list through (deduped)", () => {
  const src = build({ status: "ready", mobileLocationDocs: [locDoc()], truckDocs: [truckDoc()], accessVersion: 1, equipmentConditionOptions: ["New", "New", "", "Used"] });
  assert.deepEqual(src.options.equipmentCondition, ["New", "Used"]);
});

// --- malformed (fail closed) ---
ok("READY with malformed docs drops them fail-closed (no fabricated rows)", () => {
  const src = build({ status: "ready", mobileLocationDocs: [{ docId: "BAD", data: { type: "WAREHOUSE" } }], truckDocs: [{ docId: "T", data: { truckId: "T", locationId: "MISSING" } }], accessVersion: 1 });
  assert.equal(src.status, "ready");
  assert.deepEqual(src.trucks, []);
});

// --- inactive MOBILE Location ---
ok("inactive MOBILE Location: truck stays VISIBLE and is clearly marked inactive", () => {
  const src = build({ status: "ready", mobileLocationDocs: [locDoc({ active: false })], truckDocs: [truckDoc()], accessVersion: 1 });
  assert.equal(src.trucks.length, 1); // still visible
  assert.equal(src.trucks[0].locationActive, false);
  assert.match(src.trucks[0].location, /Inactive/);
});

// --- boundary key + stale-data prevention (end-to-end via readTruckInventorySource) ---
ok("accessVersion boundary: a source built for v1 reads READY at boundary 1, but LOADING (no data) at boundary 2", () => {
  const src = build({ status: "ready", mobileLocationDocs: [locDoc()], truckDocs: [truckDoc()], accessVersion: 1 });
  const atV1 = readTruckInventorySource(src, 1);
  assert.equal(atV1.status, "ready");
  assert.equal(atV1.trucks.length, 1);
  const atV2 = readTruckInventorySource(src, 2); // access changed; the v1 source is stale
  assert.equal(atV2.status, "loading");
  assert.deepEqual(atV2.trucks, []); // prior-scope data cannot leak at the new boundary
});

// --- purity ---
ok("does not mutate injected documents", () => {
  const md = [locDoc()], td = [truckDoc()];
  const sm = structuredClone(md), st = structuredClone(td);
  build({ status: "ready", mobileLocationDocs: md, truckDocs: td, accessVersion: 1 });
  assert.deepEqual(md, sm);
  assert.deepEqual(td, st);
});

console.log(`\n${passed} passed`);

// EI-P1d-1 -- deterministic pure unit tests for the Truck Inventory source seam
// (src/access/truckInventorySource.js) and the view-model composer
// (src/domain/truckInventoryView.js). Proves the honest fail-closed states (incl. LOADING /
// ERROR), the access-version boundary key, the governed pick-lists (fleet status / equipment
// status / equipment condition), the drop of meaningless rows, and the STRICT non-
// computation boundary (value / on-hand / reserved / available / reorder / discrepancies are
// never derived here).
//
// Run: node test/truckInventoryView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { inertTruckInventorySource, readTruckInventorySource, TRUCK_INVENTORY_SOURCE_STATUS } from "../src/access/truckInventorySource.js";
import { TRUCK_FLEET_STATE, deriveTruckFleetState, buildTruckFleetView, buildTruckDetailView, buildTruckInventoryOptions } from "../src/domain/truckInventoryView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const OPTS = { fleetStatus: ["ACTIVE", "IDLE"], equipmentStatus: ["LOADED", "AVAILABLE", "RESERVED"], equipmentCondition: ["New", "Refurbished", "Used"] };
const truck = (over = {}) => ({
  id: "TRK-204", technician: "Marcus Bell", location: "Downtown", homeWarehouse: "Main WH", status: "ACTIVE",
  metrics: { inventoryValue: "$48,250", serializedCount: 6, partsCount: 42, discrepancies: 1, lastReconciliation: "2h ago" },
  serializedEquipment: [{ assetId: "EQ-1", internalSku: "TST-1003", manufacturer: "Taylor", model: "C713", serial: "SN1", condition: "New", status: "LOADED", destination: "Diner", currentLocation: "On TRK-204" }],
  parts: [{ internalSku: "TST-1007", description: "Gasket", bin: "T-A1", onHand: 5, reserved: 2 }], // available ABSENT on purpose
  manifest: { order: "TO-1", fromWarehouse: "Main WH", status: "IN_TRANSIT", lines: [{ label: "Cyl", kind: "serial", internalSku: "TST-1003", serial: "SN1", state: "RECEIVED" }] },
  reconciliation: { expectedSerialized: 6, scannedSerialized: 5, expectedParts: 42, scannedParts: 41, missing: [{ assetId: "EQ-9", internalSku: "TST-1088", label: "Door", serial: "SN9", lastSeen: "dock", expected: "On TRK-204", actual: "Unknown" }], unexpected: [] },
  activity: [{ time: "09:42", type: "QR scan", message: "identified" }],
  ...over,
});
// A composer read-result (post readTruckInventorySource): { status, trucks, options }.
const readReady = (trucks, options = OPTS) => ({ status: "ready", trucks, options });

// --- source seam ---
ok("inert source: not connected, no trucks", () => {
  assert.deepEqual(readTruckInventorySource(), { connected: false, status: "unavailable", trucks: [], options: null });
  assert.equal(inertTruckInventorySource.connected, false);
});

ok("source seam: LOADING / ERROR / DENIED states; ERROR never carries a payload", () => {
  assert.equal(readTruckInventorySource({ status: "loading" }).status, "loading");
  const err = readTruckInventorySource({ status: "error", message: "raw boom", options: OPTS });
  assert.equal(err.status, "error");
  assert.equal(err.options, null); // sanitized -- no options/message forwarded
  assert.equal("message" in err, false);
  assert.equal(readTruckInventorySource({ status: "denied" }).status, "denied");
  assert.deepEqual(Object.values(TRUCK_INVENTORY_SOURCE_STATUS), ["unavailable", "loading", "error", "denied", "ready"]);
});

ok("source seam: READY needs connected; unknown status/malformed -> unavailable", () => {
  assert.equal(readTruckInventorySource(null).status, "unavailable");
  assert.equal(readTruckInventorySource({ status: "ready", trucks: [truck()] }).status, "unavailable"); // no connected flag
  assert.equal(readTruckInventorySource({ connected: true, status: "bogus" }).status, "unavailable");
  const r = readTruckInventorySource({ connected: true, status: "ready", trucks: [truck()], options: OPTS });
  assert.equal(r.connected, true); assert.equal(r.trucks.length, 1); assert.deepEqual(r.options, OPTS);
});

ok("source seam: BOUNDARY KEY -- a READY source for a prior access version becomes LOADING", () => {
  const src = { connected: true, status: "ready", accessVersion: 1, trucks: [truck()], options: OPTS };
  assert.equal(readTruckInventorySource(src, 1).status, "ready"); // matching version
  assert.equal(readTruckInventorySource(src, 2).status, "loading"); // stale for the new version
  assert.deepEqual(readTruckInventorySource(src, 2).trucks, []);
  assert.equal(readTruckInventorySource(src, undefined).status, "ready"); // no boundary key -> not gated
});

// --- fleet state derivation ---
ok("deriveTruckFleetState covers every source status", () => {
  assert.equal(deriveTruckFleetState("denied", 3), TRUCK_FLEET_STATE.DENIED);
  assert.equal(deriveTruckFleetState("error", 3), TRUCK_FLEET_STATE.ERROR);
  assert.equal(deriveTruckFleetState("loading", 3), TRUCK_FLEET_STATE.LOADING);
  assert.equal(deriveTruckFleetState("unavailable", 0), TRUCK_FLEET_STATE.UNAVAILABLE);
  assert.equal(deriveTruckFleetState("ready", 0), TRUCK_FLEET_STATE.EMPTY);
  assert.equal(deriveTruckFleetState("ready", 2), TRUCK_FLEET_STATE.READY);
});

// --- governed pick-lists ---
ok("buildTruckInventoryOptions validates + dedupes; junk -> empty sets", () => {
  assert.deepEqual(buildTruckInventoryOptions({ options: { fleetStatus: ["ACTIVE", "ACTIVE", "", 5], equipmentStatus: "x", equipmentCondition: ["New"] } }), { fleetStatus: ["ACTIVE"], equipmentStatus: [], equipmentCondition: ["New"] });
  assert.deepEqual(buildTruckInventoryOptions(null), { fleetStatus: [], equipmentStatus: [], equipmentCondition: [] });
});

// --- fleet view ---
ok("fleet: non-READY states yield honest states and no trucks", () => {
  assert.deepEqual(buildTruckFleetView({ status: "loading" }), { state: "loading", trucks: [] });
  assert.deepEqual(buildTruckFleetView({ status: "error" }), { state: "error", trucks: [] });
  assert.deepEqual(buildTruckFleetView({ status: "denied", trucks: [truck()] }), { state: "denied", trucks: [] });
  assert.deepEqual(buildTruckFleetView(readReady([])), { state: "empty", trucks: [] });
});

ok("fleet: governed status kept; ungoverned status becomes null (renders Unavailable)", () => {
  assert.equal(buildTruckFleetView(readReady([truck()])).trucks[0].status, "ACTIVE");
  assert.equal(buildTruckFleetView(readReady([truck({ status: "WEIRD" })])).trucks[0].status, null);
  // no options at all -> even a plausible status is not governed -> null
  assert.equal(buildTruckFleetView({ status: "ready", trucks: [truck()] }).trucks[0].status, null);
});

ok("fleet: metrics are NEVER computed -- absent metrics stay null despite non-empty arrays", () => {
  const bare = buildTruckFleetView(readReady([{ id: "TRK-9", serializedEquipment: [truck().serializedEquipment[0]], parts: [truck().parts[0]] }]));
  assert.deepEqual(bare.trucks[0].metrics, { inventoryValue: null, serializedCount: null, partsCount: null, discrepancies: null, lastReconciliation: null });
});

ok("fleet: a truck without an id is dropped (fail closed)", () => {
  const v = buildTruckFleetView(readReady([{ technician: "X" }, truck()]));
  assert.equal(v.trucks.length, 1); assert.equal(v.trucks[0].id, "TRK-204");
});

// --- detail view ---
ok("detail: not READY / not found -> null truck", () => {
  assert.deepEqual(buildTruckDetailView({ status: "loading" }, "TRK-204"), { state: "loading", truck: null });
  assert.equal(buildTruckDetailView(readReady([truck()]), "NOPE").truck, null);
  assert.equal(buildTruckDetailView(readReady([truck()]), "").truck, null);
});

ok("detail: governed equipment condition/status; AVAILABLE never computed", () => {
  const d = buildTruckDetailView(readReady([truck()]), "TRK-204");
  assert.equal(d.state, "ready");
  assert.equal(d.truck.serializedEquipment[0].condition, "New"); // governed
  assert.equal(d.truck.serializedEquipment[0].status, "LOADED"); // governed
  // on-hand and reserved pass through; available was ABSENT and is NOT derived to 3.
  assert.equal(d.truck.parts[0].onHand, 5);
  assert.equal(d.truck.parts[0].reserved, 2);
  assert.equal(d.truck.parts[0].available, null);
  assert.equal(d.truck.manifest.lines[0].state, "RECEIVED");
  assert.equal(d.truck.reconciliation.missing.length, 1);
});

ok("detail: ungoverned equipment condition/status -> null (Unavailable)", () => {
  const d = buildTruckDetailView(readReady([truck({ serializedEquipment: [{ assetId: "EQ-2", condition: "MINT", status: "TELEPORTED" }] })]), "TRK-204");
  assert.equal(d.truck.serializedEquipment[0].condition, null);
  assert.equal(d.truck.serializedEquipment[0].status, null);
});

ok("detail: drop all-null equipment rows and parts without an internal SKU", () => {
  const d = buildTruckDetailView(readReady([truck({
    serializedEquipment: [null, "x", {}, { assetId: "EQ-3", internalSku: "TST-9", condition: "New" }], // {} -> all null -> dropped
    parts: [{ description: "no sku" }, { internalSku: "TST-7", onHand: 1 }],
  })]), "TRK-204");
  assert.equal(d.truck.serializedEquipment.length, 1); // only EQ-3 survives
  assert.equal(d.truck.serializedEquipment[0].assetId, "EQ-3");
  assert.equal(d.truck.parts.length, 1); // the SKU-less part is dropped
  assert.equal(d.truck.parts[0].internalSku, "TST-7");
});

ok("composer does not mutate the source", () => {
  const src = readReady([truck()]);
  const snap = structuredClone(src);
  buildTruckFleetView(src); buildTruckDetailView(src, "TRK-204");
  assert.deepEqual(src, snap);
});

console.log(`\n${passed} passed`);

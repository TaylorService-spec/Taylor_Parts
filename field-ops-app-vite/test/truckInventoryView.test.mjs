// EI-P1d-1 -- deterministic pure unit tests for the Truck Inventory source seam
// (src/access/truckInventorySource.js) and the view-model composer
// (src/domain/truckInventoryView.js). Proves the honest fail-closed states, governed
// pass-through, and the STRICT non-computation boundary (value / on-hand / reserved /
// available / reorder / discrepancies are never derived here).
//
// Run: node test/truckInventoryView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { inertTruckInventorySource, readTruckInventorySource, TRUCK_INVENTORY_SOURCE_STATUS } from "../src/access/truckInventorySource.js";
import { TRUCK_FLEET_STATE, deriveTruckFleetState, buildTruckFleetView, buildTruckDetailView } from "../src/domain/truckInventoryView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const READY = (trucks) => ({ connected: true, status: "ready", trucks });
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

// --- source seam ---
ok("inert source: not connected, no trucks", () => {
  assert.deepEqual(readTruckInventorySource(), { connected: false, status: "unavailable", trucks: [] });
  assert.equal(inertTruckInventorySource.connected, false);
});

ok("source read fails closed on malformed / READY-without-connected", () => {
  assert.equal(readTruckInventorySource(null).status, "unavailable");
  assert.equal(readTruckInventorySource("x").status, "unavailable");
  assert.deepEqual(readTruckInventorySource({ status: "ready", trucks: [truck()] }).trucks, []); // connected flag missing
  assert.equal(readTruckInventorySource({ connected: true, status: "bogus", trucks: [] }).status, "unavailable");
  const r = readTruckInventorySource(READY([truck()]));
  assert.equal(r.connected, true); assert.equal(r.trucks.length, 1);
  assert.deepEqual(Object.values(TRUCK_INVENTORY_SOURCE_STATUS), ["unavailable", "denied", "ready"]);
});

// --- fleet state derivation ---
ok("deriveTruckFleetState", () => {
  assert.equal(deriveTruckFleetState("denied", 3), TRUCK_FLEET_STATE.DENIED);
  assert.equal(deriveTruckFleetState("unavailable", 0), TRUCK_FLEET_STATE.UNAVAILABLE);
  assert.equal(deriveTruckFleetState("ready", 0), TRUCK_FLEET_STATE.EMPTY);
  assert.equal(deriveTruckFleetState("ready", 2), TRUCK_FLEET_STATE.READY);
});

// --- fleet view ---
ok("fleet: inert/denied yield honest states and no trucks", () => {
  assert.deepEqual(buildTruckFleetView(readTruckInventorySource()), { state: "unavailable", trucks: [] });
  assert.deepEqual(buildTruckFleetView({ status: "denied", trucks: [truck()] }), { state: "denied", trucks: [] });
  assert.deepEqual(buildTruckFleetView(READY([])), { state: "empty", trucks: [] });
});

ok("fleet: READY summaries pass governed metrics through verbatim", () => {
  const v = buildTruckFleetView(READY([truck()]));
  assert.equal(v.state, "ready");
  assert.equal(v.trucks.length, 1);
  assert.deepEqual(v.trucks[0].metrics, { inventoryValue: "$48,250", serializedCount: 6, partsCount: 42, discrepancies: 1, lastReconciliation: "2h ago" });
});

ok("fleet: metrics are NEVER computed -- absent metrics stay null despite non-empty arrays", () => {
  const bare = buildTruckFleetView(READY([{ id: "TRK-9", serializedEquipment: [truck().serializedEquipment[0]], parts: [truck().parts[0]] }]));
  // serializedCount / partsCount / inventoryValue / discrepancies are null -- not counted/summed from the arrays.
  assert.deepEqual(bare.trucks[0].metrics, { inventoryValue: null, serializedCount: null, partsCount: null, discrepancies: null, lastReconciliation: null });
});

ok("fleet: a truck without an id is dropped (fail closed)", () => {
  const v = buildTruckFleetView(READY([{ technician: "X" }, truck()]));
  assert.equal(v.trucks.length, 1);
  assert.equal(v.trucks[0].id, "TRK-204");
});

// --- detail view ---
ok("detail: not READY / not found -> null truck", () => {
  assert.deepEqual(buildTruckDetailView(readTruckInventorySource(), "TRK-204"), { state: "unavailable", truck: null });
  assert.equal(buildTruckDetailView(READY([truck()]), "NOPE").truck, null);
  assert.equal(buildTruckDetailView(READY([truck()]), "").truck, null);
});

ok("detail: tabs normalized; AVAILABLE is never computed (stays null)", () => {
  const d = buildTruckDetailView(READY([truck()]), "TRK-204");
  assert.equal(d.state, "ready");
  assert.equal(d.truck.serializedEquipment.length, 1);
  assert.equal(d.truck.serializedEquipment[0].assetId, "EQ-1");
  // on-hand and reserved are passed through; available was ABSENT and is NOT derived to 3.
  assert.equal(d.truck.parts[0].onHand, 5);
  assert.equal(d.truck.parts[0].reserved, 2);
  assert.equal(d.truck.parts[0].available, null);
  assert.equal(d.truck.manifest.lines[0].state, "RECEIVED");
  assert.equal(d.truck.reconciliation.missing.length, 1);
  assert.equal(d.truck.activity[0].type, "QR scan");
});

ok("detail: malformed sub-items are dropped (fail closed)", () => {
  const d = buildTruckDetailView(READY([truck({ parts: [null, "x", { internalSku: "TST-1", onHand: 1, reserved: 0 }], serializedEquipment: [42, {}] })]), "TRK-204");
  assert.equal(d.truck.parts.length, 1);
  // {} equipment normalizes to all-null fields but is retained (a governed row with missing data),
  // while non-objects (42) are dropped.
  assert.equal(d.truck.serializedEquipment.length, 1);
});

ok("composer does not mutate the source", () => {
  const src = READY([truck()]);
  const snap = structuredClone(src);
  buildTruckFleetView(src); buildTruckDetailView(src, "TRK-204");
  assert.deepEqual(src, snap);
});

console.log(`\n${passed} passed`);

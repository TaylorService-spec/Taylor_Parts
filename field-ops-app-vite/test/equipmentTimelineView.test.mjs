// INV-EQ-P2 -- tests for the pure Equipment Activity Timeline view-model. Proves
// Work-Order -> service event mapping, composition via composeUnifiedTimeline with
// newest-first stable ordering + source tags, undated-event dropping, injected-
// inventory composition, and fail-closed state derivation.
//
// Run: node test/equipmentTimelineView.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  TIMELINE_STATE,
  TIMELINE_SOURCE,
  mapServiceEvents,
  buildEquipmentTimeline,
  deriveTimelineState,
  isInventoryConnected,
} from "../src/domain/equipmentTimelineView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const WOs = [
  { id: "w1", equipmentId: "E", woNumber: "WO-1", status: "CLOSED", type: "Repair", createdAt: 100 },
  { id: "w2", equipmentId: "E", woNumber: "WO-2", status: "OPEN", type: "PM", createdAt: 300 },
  { id: "w3", equipmentId: "E", woNumber: "WO-3", createdAt: null }, // undated
  { id: "w4", equipmentId: "OTHER", createdAt: 500 }, // different equipment
];

ok("mapServiceEvents derives service events from Work Orders for this equipment only", () => {
  const events = mapServiceEvents(WOs, "E");
  assert.deepStrictEqual(events.map((e) => e.workOrderId), ["w2", "w1", "w3"]); // newest-first from equipmentServiceHistory
  assert.strictEqual(events[0].kind, "PM"); // type wins
  assert.strictEqual(events[0].at, 300);
  assert.strictEqual(mapServiceEvents("nope", "E").length, 0);
  assert.strictEqual(mapServiceEvents(WOs, "").length, 0);
});

ok("buildEquipmentTimeline composes newest-first, tags source, drops undated events", () => {
  const serviceEvents = mapServiceEvents(WOs, "E");
  const { rows } = buildEquipmentTimeline({ serviceEvents, inventoryEvents: [] });
  // w3 (undated) is dropped; remaining are newest-first: w2@300 then w1@100
  assert.deepStrictEqual(rows.map((r) => r.ref.workOrderId), ["w2", "w1"]);
  assert.ok(rows.every((r) => r.source === TIMELINE_SOURCE.SERVICE));
});

ok("buildEquipmentTimeline interleaves injected inventory events by time (never merged)", () => {
  const serviceEvents = [{ at: 200, kind: "PM", workOrderId: "w9" }];
  const inventoryEvents = [{ at: 250, kind: "RECEIVED" }, { at: 150, kind: "TRANSFER_IN" }];
  const { rows } = buildEquipmentTimeline({ serviceEvents, inventoryEvents });
  assert.deepStrictEqual(rows.map((r) => [r.at, r.source, r.kind]), [
    [250, TIMELINE_SOURCE.INVENTORY, "RECEIVED"],
    [200, TIMELINE_SOURCE.SERVICE, "PM"],
    [150, TIMELINE_SOURCE.INVENTORY, "TRANSFER_IN"],
  ]);
});

ok("buildEquipmentTimeline drops non-finite / malformed timestamps before composition (no crash)", () => {
  const serviceEvents = [
    { at: 300, kind: "PM", workOrderId: "ok" },
    { at: NaN, kind: "bad-nan", workOrderId: "nan" },
    { at: Infinity, kind: "bad-inf", workOrderId: "inf" },
    { at: -Infinity, kind: "bad-ninf" },
    { at: null, kind: "null" },
    { at: "500", kind: "string" },
    null,
    "not-an-object",
  ];
  const inventoryEvents = [
    { at: 400, kind: "RECEIVED" },
    { at: NaN, kind: "bad-inventory" },
    { kind: "no-date" },
  ];
  const { rows } = buildEquipmentTimeline({ serviceEvents, inventoryEvents });
  // only the two finite events survive, newest-first
  assert.deepStrictEqual(rows.map((r) => [r.at, r.source, r.kind]), [
    [400, TIMELINE_SOURCE.INVENTORY, "RECEIVED"],
    [300, TIMELINE_SOURCE.SERVICE, "PM"],
  ]);
  // every surviving row has a finite timestamp (safe to Date-render)
  assert.ok(rows.every((r) => Number.isFinite(r.at)));
});

ok("deriveTimelineState is fail-closed and treats a service read failure as UNAVAILABLE", () => {
  assert.strictEqual(deriveTimelineState({ serviceLoading: true }), TIMELINE_STATE.LOADING);
  assert.strictEqual(deriveTimelineState({ serviceError: true, inventoryStatus: "unavailable", rowCount: 0 }), TIMELINE_STATE.UNAVAILABLE);
  assert.strictEqual(deriveTimelineState({ inventoryStatus: "unavailable", rowCount: 0 }), TIMELINE_STATE.EMPTY);
  assert.strictEqual(deriveTimelineState({ inventoryStatus: "unavailable", rowCount: 2 }), TIMELINE_STATE.PARTIAL); // inventory not connected
  assert.strictEqual(deriveTimelineState({ inventoryStatus: "ready", rowCount: 2 }), TIMELINE_STATE.READY);
});

ok("isInventoryConnected only on ready", () => {
  assert.strictEqual(isInventoryConnected("ready"), true);
  assert.strictEqual(isInventoryConnected("unavailable"), false);
  assert.strictEqual(isInventoryConnected("denied"), false);
});

console.log(`\n${passed} passed`);

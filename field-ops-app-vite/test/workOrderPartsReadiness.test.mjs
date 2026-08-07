// WO Parts Readiness projection -- OFFLINE tests. The through-line: the projection DERIVES readiness from
// KNOWN authority data and reports UNKNOWN / UNAVAILABLE honestly -- it NEVER invents a quantity, a
// coverage, or an availability. Several tests assert the negative (no fabrication) explicitly.
import assert from "node:assert/strict";
import {
  deriveItemReadiness,
  buildWorkOrderPartsReadiness,
} from "../src/domain/workOrderPartsReadiness.js";
import { READINESS, rollUpReadiness, isReadinessKey } from "../src/domain/readinessLanguage.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("workOrderPartsReadiness.test.mjs");

// Today's defaults: warehouse ON, truck inventory OFF (no MOBILE persistence), purchasing ON.
const TODAY = { warehouse: true, truckInventory: false, purchasing: true };

check("READY when the warehouse demonstrably covers the plan (available for pickup)", () => {
  const r = deriveItemReadiness(
    { partId: "p1", name: "Filter assembly", qtyPlanned: 2, warehouse: { status: "KNOWN", available: 5 } },
    TODAY
  );
  assert.equal(r.readiness, "READY");
  assert.equal(r.reason, "WAREHOUSE_AVAILABLE");
  assert.equal(r.knownShortfall, 0);
});

check("READY when the job's reservation already covers the plan (committed)", () => {
  const r = deriveItemReadiness(
    { partId: "p1", qtyPlanned: 2, reservedForJob: 2, warehouse: { status: "KNOWN", available: 0 } },
    TODAY
  );
  assert.equal(r.readiness, "READY");
  assert.equal(r.reason, "RESERVED");
});

check("ATTENTION when a known shortage is already being handled by procurement", () => {
  const r = deriveItemReadiness(
    { partId: "p2", name: "Control board", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 0 }, procurement: { status: "ORDERED", reference: "PO-9" } },
    TODAY
  );
  assert.equal(r.readiness, "ATTENTION");
  assert.equal(r.reason, "PROCUREMENT_PENDING");
});

check("UNKNOWN (not fabricated 'short') when warehouse can't cover and truck stock is unavailable today", () => {
  const r = deriveItemReadiness(
    { partId: "p3", name: "Refrigerant", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 0 } },
    TODAY // truckInventory OFF -> truck UNAVAILABLE
  );
  assert.equal(r.readiness, "UNKNOWN");
  assert.equal(r.reason, "TRUCK_UNAVAILABLE");
  // Honest: it does NOT assert a shortage it cannot confirm; knownShortfall is exposed but state is UNKNOWN.
  assert.equal(r.knownShortfall, 1);
  assert.equal(r.dimensions.truck.status, "UNAVAILABLE");
});

check("NEVER invents availability: a missing/absent warehouse datum is UNKNOWN, not zero-available READY", () => {
  const r = deriveItemReadiness({ partId: "p4", qtyPlanned: 1 /* no warehouse, no truck */ }, TODAY);
  assert.equal(r.dimensions.warehouse.status, "UNKNOWN"); // enabled but undetermined -> UNKNOWN, not fabricated 0
  assert.equal(r.readiness, "UNKNOWN");
});

check("confirmed shortage (all sources KNOWN, short, no procurement) -> ATTENTION SHORT", () => {
  const caps = { warehouse: true, truckInventory: true, purchasing: true };
  const r = deriveItemReadiness(
    { partId: "p5", qtyPlanned: 3, warehouse: { status: "KNOWN", available: 1 }, truck: { status: "KNOWN", onTruck: 0 } },
    caps
  );
  assert.equal(r.readiness, "ATTENTION");
  assert.equal(r.reason, "SHORT");
  assert.equal(r.knownShortfall, 2);
});

check("modular degradation: purchasing OFF + confirmed short -> ATTENTION SHORT_PROCUREMENT_UNAVAILABLE (honest, not broken)", () => {
  const caps = { warehouse: true, truckInventory: true, purchasing: false };
  const r = deriveItemReadiness(
    { partId: "p6", qtyPlanned: 2, warehouse: { status: "KNOWN", available: 0 }, truck: { status: "KNOWN", onTruck: 0 } },
    caps
  );
  assert.equal(r.readiness, "ATTENTION");
  assert.equal(r.reason, "SHORT_PROCUREMENT_UNAVAILABLE");
  assert.equal(r.dimensions.procurement.status, "MODULE_UNAVAILABLE");
});

check("on-truck coverage yields READY reason ON_TRUCK when truck inventory is authoritative", () => {
  const caps = { warehouse: true, truckInventory: true, purchasing: true };
  const r = deriveItemReadiness(
    { partId: "p7", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 0 }, truck: { status: "KNOWN", onTruck: 3 } },
    caps
  );
  assert.equal(r.readiness, "READY");
  assert.equal(r.reason, "ON_TRUCK");
});

check("REQUIRED and RETURNED are always NOT_DERIVED in v1 (never fabricated)", () => {
  const r = deriveItemReadiness({ partId: "p8", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 1 } }, TODAY);
  assert.equal(r.dimensions.required.status, "NOT_DERIVED");
  assert.equal(r.dimensions.returned.status, "NOT_DERIVED");
});

check("buildWorkOrderPartsReadiness: rolls up worst-first, counts, and reports degraded capabilities", () => {
  const view = buildWorkOrderPartsReadiness({
    workOrder: { id: "WO-1042" },
    plannedParts: [
      { partId: "a", name: "Filter", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 4 } }, // READY
      { partId: "b", name: "Board", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 0 }, procurement: { status: "ORDERED" } }, // ATTENTION
      { partId: "c", name: "Refrigerant", qtyPlanned: 1, warehouse: { status: "KNOWN", available: 0 } }, // UNKNOWN (truck off)
      { partId: "d", qtyPlanned: 0 }, // not planned -> excluded
    ],
    capabilities: TODAY,
  });
  assert.equal(view.workOrderId, "WO-1042");
  assert.equal(view.plannedCount, 3); // the qtyPlanned:0 row is excluded
  assert.deepEqual(view.counts, { READY: 1, ATTENTION: 1, UNKNOWN: 1 });
  assert.equal(view.jobReadiness, "ATTENTION"); // worst-actionable-first: ATTENTION dominates UNKNOWN/READY
  assert.ok(view.degraded.includes("truckInventory")); // honest: truck inventory is off today
});

check("buildWorkOrderPartsReadiness: no planned parts reads as NO_PLAN, not READY", () => {
  const view = buildWorkOrderPartsReadiness({ workOrder: { id: "WO-2" }, plannedParts: [], capabilities: TODAY });
  assert.equal(view.plannedCount, 0);
  assert.equal(view.jobReadiness, "NO_PLAN");
});

check("readinessLanguage: rollUp severity ATTENTION > UNKNOWN > UNAVAILABLE > READY; empty -> READY", () => {
  assert.equal(rollUpReadiness([READINESS.READY, READINESS.UNKNOWN]).key, "UNKNOWN");
  assert.equal(rollUpReadiness([READINESS.UNKNOWN, READINESS.ATTENTION]).key, "ATTENTION");
  assert.equal(rollUpReadiness([READINESS.UNAVAILABLE, READINESS.READY]).key, "UNAVAILABLE");
  assert.equal(rollUpReadiness(["READY", "ATTENTION"]).key, "ATTENTION"); // accepts keys too
  assert.equal(rollUpReadiness([]).key, "READY");
  assert.equal(isReadinessKey("READY"), true);
  assert.equal(isReadinessKey("NOPE"), false);
});

console.log(`\n${passed} passed, 0 failed`);

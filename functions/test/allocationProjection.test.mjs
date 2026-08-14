// Fulfillment Cycle 5 — OFFLINE tests for the PURE allocation-seam projection, from compiled lib. Proves the
// honest allocation-state model (ALLOCATED/PARTIAL/BACKORDERED/UNAVAILABLE/UNKNOWN) and the readiness rollup.
import test from "node:test";
import assert from "node:assert/strict";
import { allocateLine, buildAllocationPlan } from "../lib/fulfillment/allocationProjection.js";

const line = (ref, orderedQty, allocatedQty = 0) => ({ kind: "EQUIPMENT_MODEL", ref, orderedQty, allocatedQty });

test("allocateLine: full availability → ALLOCATED", () => {
  const a = allocateLine(line("C713", 5), { kind: "KNOWN", quantity: 5 });
  assert.deepEqual({ req: a.requestedQty, alloc: a.allocatableQty, short: a.shortfallQty, state: a.state }, { req: 5, alloc: 5, short: 0, state: "ALLOCATED" });
});

test("allocateLine: partial availability → PARTIAL with shortfall", () => {
  const a = allocateLine(line("C713", 5), { kind: "KNOWN", quantity: 2 });
  assert.deepEqual({ alloc: a.allocatableQty, short: a.shortfallQty, state: a.state }, { alloc: 2, short: 3, state: "PARTIAL" });
});

test("allocateLine: known-zero from an available source → BACKORDERED (not UNKNOWN)", () => {
  const a = allocateLine(line("C713", 5), { kind: "KNOWN", quantity: 0 });
  assert.equal(a.state, "BACKORDERED");
  assert.equal(a.shortfallQty, 5);
});

test("allocateLine: UNAVAILABLE source and UNKNOWN source are distinct (never silently 0)", () => {
  assert.equal(allocateLine(line("C713", 5), { kind: "UNAVAILABLE" }).state, "UNAVAILABLE");
  assert.equal(allocateLine(line("C713", 5), { kind: "UNKNOWN" }).state, "UNKNOWN");
  // a missing determination defaults to UNKNOWN, not BACKORDERED
  assert.equal(buildAllocationPlan([line("C713", 5)], {}).lines[0].state, "UNKNOWN");
});

test("allocateLine: already-allocated reduces the requested remainder", () => {
  const a = allocateLine(line("C713", 5, 5), { kind: "KNOWN", quantity: 0 });
  assert.deepEqual({ req: a.requestedQty, state: a.state }, { req: 0, state: "ALLOCATED" });
});

// site-work allocatesalesorder-duplicate-ref-lines-double-allocate: two SO lines sharing the same ref must
// draw down the SAME pool, not each see the full undiminished availability.
test("buildAllocationPlan: sibling lines sharing a ref decrement the same pool (never double-allocate)", () => {
  const lines = [line("PART-1", 5), line("PART-1", 5)];
  const plan = buildAllocationPlan(lines, { "PART-1": { kind: "KNOWN", quantity: 5 } });
  const totalAllocated = plan.lines.reduce((sum, l) => sum + l.allocatableQty, 0);
  assert.equal(totalAllocated, 5, "total allocated across both lines must not exceed the 5-unit pool");
  assert.deepEqual(
    { alloc0: plan.lines[0].allocatableQty, state0: plan.lines[0].state },
    { alloc0: 5, state0: "ALLOCATED" },
    "first line takes the pool"
  );
  assert.deepEqual(
    { alloc1: plan.lines[1].allocatableQty, short1: plan.lines[1].shortfallQty, state1: plan.lines[1].state },
    { alloc1: 0, short1: 5, state1: "BACKORDERED" },
    "second line sees the pool already exhausted by its sibling"
  );

  // Three lines splitting an uneven pool: 3 + 3 + 3 against a pool of 5 -> 3, 2, 0.
  const lines3 = [line("PART-2", 3), line("PART-2", 3), line("PART-2", 3)];
  const plan3 = buildAllocationPlan(lines3, { "PART-2": { kind: "KNOWN", quantity: 5 } });
  assert.deepEqual(
    plan3.lines.map((l) => l.allocatableQty),
    [3, 2, 0]
  );
  assert.equal(plan3.lines.reduce((sum, l) => sum + l.allocatableQty, 0), 5);

  // Distinct refs are unaffected -- each keeps its own independent pool.
  const mixed = [line("PART-3", 4), line("PART-4", 4)];
  const planMixed = buildAllocationPlan(mixed, {
    "PART-3": { kind: "KNOWN", quantity: 4 },
    "PART-4": { kind: "KNOWN", quantity: 4 },
  });
  assert.deepEqual(
    planMixed.lines.map((l) => l.allocatableQty),
    [4, 4]
  );

  // UNAVAILABLE/UNKNOWN pools have no quantity to share -- every sibling line gets the same determination.
  const unavailLines = [line("PART-5", 2), line("PART-5", 2)];
  const planUnavail = buildAllocationPlan(unavailLines, { "PART-5": { kind: "UNAVAILABLE" } });
  assert.deepEqual(
    planUnavail.lines.map((l) => l.state),
    ["UNAVAILABLE", "UNAVAILABLE"]
  );
});

test("SERVICE lines are independently allocatable and pools do not cross kinds", () => {
  const services = [{ kind: "SERVICE", ref: "SAME", orderedQty: 2 }, { kind: "SERVICE", ref: "SAME", orderedQty: 2 }];
  const servicePlan = buildAllocationPlan(services, { "SERVICE:SAME": { kind: "KNOWN", quantity: 2 } });
  assert.deepEqual(servicePlan.lines.map((l) => l.allocatableQty), [2, 2]);
  const mixed = [{ kind: "PART", ref: "SAME", orderedQty: 2 }, { kind: "EQUIPMENT_MODEL", ref: "SAME", orderedQty: 2 }];
  const mixedPlan = buildAllocationPlan(mixed, { "PART:SAME": { kind: "KNOWN", quantity: 2 }, "EQUIPMENT_MODEL:SAME": { kind: "KNOWN", quantity: 2 } });
  assert.deepEqual(mixedPlan.lines.map((l) => l.allocatableQty), [2, 2]);
});

test("buildAllocationPlan: readiness rollup is honest (worst-known wins)", () => {
  const lines = [line("A", 2), line("B", 1)];
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 2 }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "READY");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 1 }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "PARTIAL");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 2 }, B: { kind: "UNKNOWN" } }).readiness, "UNKNOWN");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "UNAVAILABLE" }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "BLOCKED");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 0 }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "BLOCKED");
  assert.equal(buildAllocationPlan([], {}).readiness, "UNKNOWN");
});

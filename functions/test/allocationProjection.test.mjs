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

test("buildAllocationPlan: readiness rollup is honest (worst-known wins)", () => {
  const lines = [line("A", 2), line("B", 1)];
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 2 }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "READY");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 1 }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "PARTIAL");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 2 }, B: { kind: "UNKNOWN" } }).readiness, "UNKNOWN");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "UNAVAILABLE" }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "BLOCKED");
  assert.equal(buildAllocationPlan(lines, { A: { kind: "KNOWN", quantity: 0 }, B: { kind: "KNOWN", quantity: 1 } }).readiness, "BLOCKED");
  assert.equal(buildAllocationPlan([], {}).readiness, "UNKNOWN");
});

// DASHBOARD GOAL ACTUALS -- the actual half of "target vs actual", and the states that are NOT zero.
//
// The invariant under test:
//
//     DOMAIN AUTHORITY OWNS THE ACTUAL.
//     PERFORMANCE GOAL AUTHORITY OWNS THE TARGET.
//     THE DASHBOARD COMPARES THEM.
//
// The dangerous failure here is not a missing tile -- it is a CONFIDENT WRONG NUMBER. Two shapes of
// it, and the tests are weighted toward both:
//
//   UNKNOWN BECOMES ZERO   a read that was denied, still loading, or truncated yields 0, and the
//                          tile reports "0 of 400" -- a performance claim nobody measured.
//   WRONG SCOPE            a firm-wide count answers a location goal, reporting the whole company's
//                          work as one warehouse's.
//
// Run: node --test test/dashboardGoalActuals.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  dashboardGoalActuals,
  actualsByGoalKey,
  GOAL_ACTUAL_BLOCKER,
  GOAL_ACTUAL_BLOCKER_DEFAULT,
} from "../src/domain/dashboardGoalActuals.js";
import { goalProgress, GOAL_PROGRESS_STATE } from "../src/domain/goalProgress.js";

const section = (sectionLabel, count) => ({ sectionLabel, items: Array.from({ length: count }, (_, i) => ({ id: `w${i}` })) });
const find = (entries, metricId) => entries.find((e) => e.metricId === metricId);

// ── the actuals that ARE connected ──────────────────────────────────────────────────────────────

test("the three service signals come from the attention projection, at FIRM scope", () => {
  const entries = dashboardGoalActuals({
    attentionSections: [section("Past Due", 3), section("Ready to Schedule", 7), section("Scheduling Conflict", 1)],
  });
  assert.equal(find(entries, "service.workOrder.pastDue.count").value, 3);
  assert.equal(find(entries, "service.workOrder.readyToSchedule.count").value, 7);
  assert.equal(find(entries, "service.workOrder.schedulingConflict.count").value, 1);
  for (const e of entries) {
    assert.equal(e.targetScopeType, "FIRM", `${e.metricId} must not claim a narrower scope`);
    assert.equal(e.targetScopeId, null);
  }
});

test("a signal the projection omitted is a CONFIRMED zero once the read resolved", () => {
  // The grouping drops empty sections. With the read resolved, "no conflicts" is a real measurement
  // and must read as 0 -- not as a missing actual, which would understate a clean board as unknown.
  const entries = dashboardGoalActuals({ attentionSections: [section("Past Due", 2)] });
  assert.equal(find(entries, "service.workOrder.schedulingConflict.count").value, 0);
  assert.equal(find(entries, "service.workOrder.readyToSchedule.count").value, 0);
});

test("active accounts come from the complete portfolio aggregate", () => {
  const entries = dashboardGoalActuals({ portfolio: { total: 90, active: 42, prospect: 8, inactive: 40 } });
  const active = find(entries, "crm.account.active.count");
  assert.equal(active.value, 42);
  assert.equal(active.targetScopeType, "FIRM");
});

// ── UNKNOWN IS NEVER ZERO ────────────────────────────────────────────────────────────────────────

test("an unresolved work-order read yields NO entries, never zeros", () => {
  // null means denied, loading or failed. Emitting 0 here is the exact failure the goal tile's
  // NO_ACTUAL state exists to prevent: it would report a clean board to someone who cannot see it.
  for (const attentionSections of [null, undefined]) {
    const entries = dashboardGoalActuals({ attentionSections });
    assert.equal(entries.length, 0, "an unresolved read must produce no actual at all");
  }
});

test("an unresolved or malformed portfolio yields no active-account actual", () => {
  for (const portfolio of [null, {}, { active: null }, { active: "42" }, { active: Number.NaN }]) {
    const entries = dashboardGoalActuals({ portfolio });
    assert.equal(find(entries, "crm.account.active.count"), undefined, `leaked from ${JSON.stringify(portfolio)}`);
  }
});

test("no arguments at all is empty, not a screen full of zeros", () => {
  assert.deepEqual(dashboardGoalActuals(), []);
  assert.deepEqual(dashboardGoalActuals({}), []);
});

// ── the end-to-end shape the tile actually renders ───────────────────────────────────────────────

test("a missing actual renders the target with its own reason, never 0 of N", () => {
  const goalResult = { goal: { targetValue: 400, direction: "AT_LEAST" } };
  const progress = goalProgress(goalResult, undefined, GOAL_ACTUAL_BLOCKER["sales.billed.amount"]);
  assert.equal(progress.state, GOAL_PROGRESS_STATE.NO_ACTUAL);
  assert.equal(progress.actual, null);
  assert.equal(progress.goal.targetValue, 400);
  assert.match(progress.reason, /bounded page/i);
});

test("a connected actual of zero is a REAL result and still compares", () => {
  const goalResult = { goal: { targetValue: 5, direction: "AT_MOST" } };
  const entries = dashboardGoalActuals({ attentionSections: [section("Past Due", 0)] });
  const value = find(entries, "service.workOrder.pastDue.count").value;
  const progress = goalProgress(goalResult, value, "unused");
  assert.equal(progress.state, GOAL_PROGRESS_STATE.READY);
  assert.equal(progress.actual, 0);
});

// ── keying ───────────────────────────────────────────────────────────────────────────────────────

test("entries index by the same key format the goal feed uses", () => {
  const keyFor = (metricId, scopeType, scopeId) => `${metricId}::${scopeType}::${scopeId ?? ""}`;
  const byKey = actualsByGoalKey(dashboardGoalActuals({ portfolio: { active: 12 } }), keyFor);
  assert.equal(byKey["crm.account.active.count::FIRM::"], 12);
  // A LOCATION goal for the same metric must NOT pick up the firm number.
  assert.equal(byKey["crm.account.active.count::LOCATION::wh-1"], undefined);
});

// ── the blockers are specific, and stay specific ─────────────────────────────────────────────────

test("every unconnected active metric names its OWN obstruction", () => {
  // One shared sentence ("not connected yet") described all of them and distinguished none, so a
  // reader could not tell engineering debt from a governance boundary.
  const connected = new Set([
    "service.workOrder.pastDue.count",
    "service.workOrder.readyToSchedule.count",
    "service.workOrder.schedulingConflict.count",
    "crm.account.active.count",
  ]);
  const ACTIVE_METRICS = [
    "service.workOrder.pastDue.count",
    "service.workOrder.readyToSchedule.count",
    "service.workOrder.schedulingConflict.count",
    "service.workOrder.partsBlocked.count",
    "technician.workOrder.completed.cumulative.count",
    "technician.workOrder.open.count",
    "sales.billed.amount",
    "sales.collected.amount",
    "crm.account.active.count",
    "parts.reorderRequest.open.count",
    "receiving.purchaseOrder.receivable.count",
    "purchasing.purchaseOrder.open.count",
  ];
  const sentences = new Set();
  for (const metricId of ACTIVE_METRICS) {
    if (connected.has(metricId)) continue;
    const reason = GOAL_ACTUAL_BLOCKER[metricId];
    assert.ok(reason, `${metricId} has no blocker sentence`);
    assert.ok(reason.length > 60, `${metricId}'s reason is too thin to act on`);
    assert.ok(!sentences.has(reason), `${metricId} reuses another metric's sentence`);
    sentences.add(reason);
  }
});

test("a connected metric carries no blocker sentence, so it cannot render one beside a number", () => {
  for (const metricId of ["service.workOrder.pastDue.count", "crm.account.active.count"]) {
    assert.equal(GOAL_ACTUAL_BLOCKER[metricId], undefined, `${metricId} is connected and needs no excuse`);
  }
  assert.ok(GOAL_ACTUAL_BLOCKER_DEFAULT.length > 0, "a fallback sentence must still exist");
});

test("parts-blocked stays unmeasured rather than being counted from partial input", () => {
  // The projection only emits Parts Blocked when the caller supplies parts readiness. This surface
  // does not, so counting what it can see would report fewer blocked jobs than exist.
  const entries = dashboardGoalActuals({ attentionSections: [section("Parts Blocked", 4)] });
  assert.equal(find(entries, "service.workOrder.partsBlocked.count"), undefined);
  assert.match(GOAL_ACTUAL_BLOCKER["service.workOrder.partsBlocked.count"], /parts-readiness/i);
});

test("the bounded reads say they are bounded, so nobody wires them as totals later", () => {
  assert.match(GOAL_ACTUAL_BLOCKER["technician.workOrder.open.count"], /100/);
  for (const metricId of ["sales.billed.amount", "sales.collected.amount"]) {
    assert.match(GOAL_ACTUAL_BLOCKER[metricId], /period total/i);
  }
});

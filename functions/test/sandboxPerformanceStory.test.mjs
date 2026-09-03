// PURE tests for seedSandboxPerformanceStory.mjs's scenario spec. No emulator, no network, no
// Firestore -- everything here runs against the exported pure functions only, matching this
// repository's "pure logic lives apart from its IO" pattern (sandboxDispatchFixtures.test.mjs is
// the precedent).
//
// Run: cd functions && npm run build && node --test test/sandboxPerformanceStory.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScenarioSpec,
  resolveWorkOrderActionChain,
  findForbiddenDashboardKey,
  FORBIDDEN_DASHBOARD_KEYS,
} from "../scripts/seedSandboxPerformanceStory.mjs";
import { findMetric } from "../lib/performance/performanceMetricRegistry.js";
import { TERMINAL_STATUSES } from "../lib/transitionEngine.js";

const FIXED_NOW = Date.parse("2026-09-02T12:00:00.000Z");
const spec = buildScenarioSpec({ nowMillis: FIXED_NOW });

test("buildScenarioSpec is deterministic for a fixed nowMillis", () => {
  const again = buildScenarioSpec({ nowMillis: FIXED_NOW });
  assert.deepEqual(again, spec);
});

test("buildScenarioSpec requires a numeric nowMillis", () => {
  assert.throws(() => buildScenarioSpec({}), /nowMillis/);
  assert.throws(() => buildScenarioSpec({ nowMillis: "now" }), /nowMillis/);
});

// ============================ THE ONE RULE ============================
test("no seeded record anywhere in the spec carries a dashboard-answer field", () => {
  const sections = ["principals", "technicians", "workOrders", "stock", "reorderRequests", "purchaseOrders", "goals"];
  for (const section of sections) {
    for (const record of spec[section]) {
      const hit = findForbiddenDashboardKey(record);
      assert.equal(hit, null, `${section} record carries forbidden key "${hit}": ${JSON.stringify(record)}`);
    }
  }
});

test("findForbiddenDashboardKey actually catches every listed term, including nested and compound keys", () => {
  for (const bad of FORBIDDEN_DASHBOARD_KEYS) {
    assert.equal(findForbiddenDashboardKey({ [bad]: 1 }), bad);
  }
  assert.equal(findForbiddenDashboardKey({ dashboardSummary: 1 }), "dashboardSummary");
  assert.equal(findForbiddenDashboardKey({ nested: { attainmentPercent: 5 } }), "nested.attainmentPercent");
  assert.equal(findForbiddenDashboardKey({ partId: "PRT-1001", status: "ORDERED" }), null);
});

// ============================ GOALS ONLY NAME ACTIVE METRICS ============================
test("every goal in the spec names a metric that is activeForGoals in the real registry", () => {
  assert.ok(spec.goals.length > 0, "the spec should actually contain goals");
  for (const g of spec.goals) {
    const metric = findMetric(g.metricId);
    assert.ok(metric, `"${g.metricId}" is not a registered metric at all`);
    assert.equal(metric.activeForGoals, true, `"${g.metricId}" is registered but blocked: ${metric.blockedBy}`);
  }
});

test("a goal against an inactive metric is refused by the real registry validator (not routed around)", async () => {
  const { buildPerformanceGoal, GoalError } = await import("../lib/performance/performanceGoal.js");
  assert.throws(
    () =>
      buildPerformanceGoal({
        goalId: "should-never-exist", metricId: "sales.booked.amount", targetScopeType: "FIRM", targetScopeId: null,
        targetValue: 100, unit: "CURRENCY_MINOR", direction: "AT_LEAST", currency: "USD",
        effectiveFrom: "2026-01-01", effectiveTo: null, status: "DRAFT", version: 1,
        createdByUid: "someone", createdAtMillis: 1,
      }),
    GoalError,
  );
});

// ============================ AUTHOR != APPROVER ============================
test("every goal's author differs from its approver", () => {
  for (const g of spec.goals) {
    assert.notEqual(g.authorUid, g.approverUid, `goal ${g.goalId} has the same author and approver`);
    assert.ok(g.authorUid, `goal ${g.goalId} has no author`);
    assert.ok(g.approverUid, `goal ${g.goalId} has no approver`);
  }
});

test("every principal referenced by a goal exists in the spec's own principal list", () => {
  const uids = new Set(spec.principals.map((p) => p.uid));
  for (const g of spec.goals) {
    assert.ok(uids.has(g.authorUid), `author ${g.authorUid} for ${g.goalId} is not a declared principal`);
    assert.ok(uids.has(g.approverUid), `approver ${g.approverUid} for ${g.goalId} is not a declared principal`);
  }
});

// ============================ THE SPREAD ============================
// Derives each goal's "met" verdict from the spec's own BUSINESS-EVENT arrays -- never from a
// seeded field -- exactly the discipline the seeder itself is required to follow.
function derivedActualFor(goal) {
  if (goal.metricId === "technician.workOrder.completed.cumulative.count") {
    return spec.workOrders.filter((wo) => wo.technicianId === goal.targetScopeId && wo.actionChain.includes("Complete")).length;
  }
  if (goal.metricId === "service.workOrder.partsBlocked.count") {
    return spec.workOrders.filter((wo) => wo.requiredPartId && !wo.actionChain.includes("Complete") && !wo.actionChain.includes("Cancel")).length;
  }
  if (goal.metricId === "service.workOrder.pastDue.count") {
    return spec.workOrders.filter(
      (wo) => wo.actionChain.includes("Schedule") && !wo.actionChain.includes("Complete") && wo.scheduledStartMillis < FIXED_NOW,
    ).length;
  }
  if (goal.metricId === "parts.reorderRequest.open.count") {
    const OPEN = new Set(["PENDING_REVIEW", "PURCHASING_IN_PROGRESS", "ORDERED"]);
    return spec.reorderRequests.filter((r) => r.warehouseId === goal.targetScopeId && OPEN.has(r.status)).length;
  }
  throw new Error(`no derivation known for ${goal.metricId} -- add one before trusting the spread test`);
}

function metGoal(goal, actual) {
  if (goal.direction === "AT_LEAST") return actual >= goal.targetValue;
  if (goal.direction === "AT_MOST") return actual <= goal.targetValue;
  return actual === goal.targetValue;
}

test("the spec produces a spread: not every goal's derived actual sits above/meets its target", () => {
  const verdicts = spec.goals.map((g) => ({ goalId: g.goalId, met: metGoal(g, derivedActualFor(g)) }));
  const metCount = verdicts.filter((v) => v.met).length;
  assert.ok(metCount > 0, "expected at least one goal to be met -- the story should not be uniformly bad either");
  assert.ok(metCount < verdicts.length, `every goal is met (${JSON.stringify(verdicts)}) -- the sandbox must not make everybody green`);
});

// ============================ WORK ORDERS ARE ACTION CHAINS ============================
test("every work order is specified as an action chain, never as a bare terminal status", () => {
  for (const wo of spec.workOrders) {
    assert.ok(Array.isArray(wo.actionChain), `${wo.id} has no actionChain array`);
    assert.ok(wo.actionChain.length > 0, `${wo.id}'s actionChain is empty`);
    assert.equal(typeof wo.status, "undefined", `${wo.id} carries a precomputed 'status' field instead of letting the chain resolve it`);
  }
});

test("resolveWorkOrderActionChain replays each spec work order to a status the real engine's tables allow", () => {
  for (const wo of spec.workOrders) {
    const { status } = resolveWorkOrderActionChain(wo.actionChain, {
      technicianId: wo.technicianId ?? undefined,
      scheduledStartMillis: wo.scheduledStartMillis,
      scheduledEndMillis: wo.scheduledEndMillis,
    });
    assert.ok(status, `${wo.id} resolved to no status`);
    // Charlie's parts-blocked WO and Delta's past-due WO must NOT be terminal -- seeding a
    // terminal status for either would fake the very boundary this pack exists to leave honest.
    if (wo.id === "wo-perf-charlie-001" || wo.id === "wo-perf-delta-001") {
      assert.equal(TERMINAL_STATUSES.has(status), false, `${wo.id} must stop short of a terminal status`);
    }
  }
});

test("resolveWorkOrderActionChain rejects an illegal action sequence rather than silently accepting one", () => {
  assert.throws(() => resolveWorkOrderActionChain(["Complete"]), /illegal action|not in ACTION_ALLOWED_FROM|illegal transition/);
  assert.throws(
    () => resolveWorkOrderActionChain(["MarkReady", "Complete"]),
    /illegal transition/,
  );
});

test("the deliberate scheduling-conflict pair is documented and genuinely overlaps in time", () => {
  const a = spec.workOrders.find((wo) => wo.id === "wo-perf-conflict-a");
  const b = spec.workOrders.find((wo) => wo.id === "wo-perf-conflict-b");
  assert.ok(a && b, "the conflict pair must exist");
  assert.equal(a.technicianId, b.technicianId, "the conflict pair must target the same technician");
  const overlaps = a.scheduledStartMillis < b.scheduledEndMillis && b.scheduledStartMillis < a.scheduledEndMillis;
  assert.ok(overlaps, "the conflict pair must actually overlap in time, or it proves nothing");
});

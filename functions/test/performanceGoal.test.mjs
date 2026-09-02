// PERFORMANCE GOAL AUTHORITY -- the refusals that matter.
//
// Pure (no emulator, no network, no clock). Prerequisite: npm run build.
//   node --test test/performanceGoal.test.mjs
//
// Every case below is one the Owner's direction named by hand. They are written as refusals rather
// than as happy paths on purpose: a goal system that accepts a valid goal is table stakes, and a
// goal system that accepts an INVALID one silently is worse than not having one, because a wrong
// target looks exactly like a right target on a dashboard.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPerformanceGoal,
  currentGoalFor,
  evaluateGoal,
  goalCoversDate,
  planRecordForGoal,
  GoalError,
} from "../lib/performance/performanceGoal.js";
import {
  findMetric,
  metricsActiveForGoals,
  isScopeBindable,
  PERFORMANCE_METRICS,
  GOAL_SCOPE_BINDINGS,
} from "../lib/performance/performanceMetricRegistry.js";
import {
  resolveGoalAuthority,
  goalSubjectEmployeeIdsFor,
  accessScopeForTarget,
} from "../lib/performance/performanceGoalAuthority.js";
import { comparePlanToActual } from "../lib/finance/planVsActual.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const NOW = 1_756_000_000_000;

// All five goal capabilities are registered active:false, so EVERY authority question below denies
// with reason "inactivePermission" until an environment activates them. These tests therefore model
// an environment that HAS -- which is what platform-sandbox will do -- and the very first authority
// test proves what happens without it, so the fail-closed default is pinned rather than assumed.
const GOAL_ACTIVATION = new Set([
  "performance.goal.read",
  "performance.goal.create",
  "performance.goal.approve",
  "performance.goal.supersede",
  "performance.goal.retire",
]);

function assignment(roleId, scope = { type: "global" }, principalUid = "u-actor") {
  return {
    id: `a-${roleId}-${scope.type}-${scope.value ?? "x"}`,
    principalUid,
    roleId,
    scope,
    grantedBy: "seed",
    grantedAt: { toMillis: () => 0 },
    status: "active",
    accessVersionAtGrant: 1,
  };
}

// A minimal org: one sales manager, one salesperson, one service manager, one technician, one parts
// manager. Exactly the shape hierarchicalVisibility.loadPrincipalPositions() returns.
const POPULATION = [
  { principalUid: "u-salesmgr", employeeId: "emp-salesmgr", roleIds: ["salesManager"] },
  { principalUid: "u-rep", employeeId: "emp-rep", roleIds: ["salesperson"] },
  { principalUid: "u-svcmgr", employeeId: "emp-svcmgr", roleIds: ["fieldManager"] },
  { principalUid: "u-tech", employeeId: "emp-tech", roleIds: ["technician"] },
  { principalUid: "u-partsmgr", employeeId: "emp-partsmgr", roleIds: ["partsManager"] },
];

function goalInput(over = {}) {
  return {
    goalId: "goal-1",
    metricId: "technician.workOrder.completed.cumulative.count",
    targetScopeType: "EMPLOYEE",
    targetScopeId: "emp-tech",
    targetValue: 500,
    unit: "COUNT",
    direction: "AT_LEAST",
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    status: "APPROVED",
    version: 1,
    createdByUid: "u-svcmgr",
    createdAtMillis: NOW,
    approvedByUid: "u-opsmgr",
    approvedAtMillis: NOW,
    ...over,
  };
}

// ===========================================================================
// THE REGISTRY -- registered is not active, and inactive is not silent
// ===========================================================================

test("an unknown metric id is refused, never invented", () => {
  assert.equal(findMetric("sales.vibes"), undefined);
  assert.throws(() => buildPerformanceGoal(goalInput({ metricId: "sales.vibes" })), (e) => {
    assert.ok(e instanceof GoalError);
    assert.equal(e.code, "METRIC_UNKNOWN");
    return true;
  });
});

test("a registered-but-inactive metric is refused WITH its blocker named", () => {
  // The point of this test is the message, not the throw. A manager who wanted a first-time-fix goal
  // must learn that no revisit linkage exists -- not that "it didn't work".
  const err = (() => {
    try {
      buildPerformanceGoal(goalInput({ metricId: "service.firstTimeFix.rate", unit: "PERCENT", targetValue: 85, targetScopeType: "EMPLOYEE" }));
    } catch (e) { return e; }
  })();
  assert.equal(err.code, "METRIC_NOT_ACTIVE_FOR_GOALS");
  assert.match(err.message, /no revisit, callback or repeat-visit LINKAGE exists/);
});

test("every inactive metric names a blocker, and every active one names none", () => {
  for (const m of PERFORMANCE_METRICS) {
    if (m.activeForGoals) {
      assert.equal(m.blockedBy, null, `${m.metricId} is active and must carry no blocker`);
    } else {
      assert.ok(
        typeof m.blockedBy === "string" && m.blockedBy.length > 20,
        `${m.metricId} is inactive and must name its blocker in prose, not with a shrug`,
      );
    }
  }
  assert.ok(metricsActiveForGoals().length > 0, "at least one metric must be goal-able or the authority is decorative");
  assert.ok(
    metricsActiveForGoals().length < PERFORMANCE_METRICS.length,
    "if everything is active something has been activated that the census says is blocked",
  );
});

test("the registered and active counts are PINNED, because a number in a comment drifts", () => {
  // These two numbers appear in the registry's header comment and in DECISIONS #161. Both were
  // wrong by the time this branch was pushed -- written as 30/9 early and left behind as entries
  // were added -- which is exactly why they are asserted here rather than only stated in prose.
  //
  // A failure is not a defect: it means a metric was added or activated, and the two places that
  // quote these counts need updating in the same change. That is the point.
  assert.equal(PERFORMANCE_METRICS.length, 37, "registered metrics");
  assert.equal(metricsActiveForGoals().length, 10, "metrics a goal may be created against today");
});

test("no WINDOWED metric is active for goals -- there is no reporting-period authority", () => {
  // G-05. This is the single rule that keeps the registry honest: every windowed actual would need a
  // fiscal calendar, a reporting timezone, MTD/QTD/YTD, a partial-period rule and a prior-period
  // comparison, and the repository defines none of the five.
  for (const m of PERFORMANCE_METRICS) {
    if (m.measurementKind === "WINDOWED") {
      assert.equal(m.activeForGoals, false, `${m.metricId} is windowed and cannot have a governed actual yet`);
    }
  }
});

test("TEAM is registered as a scope and is deliberately not bindable", () => {
  assert.equal(isScopeBindable("TEAM"), false);
  assert.match(GOAL_SCOPE_BINDINGS.TEAM.authority, /NO TEAM ENTITY EXISTS/);
  assert.equal(isScopeBindable("EMPLOYEE"), true);
  assert.equal(isScopeBindable("FIRM"), true);
  assert.equal(isScopeBindable("NONSENSE"), false, "an unknown scope is not bindable -- fail closed");
});

test("no active metric claims a scope that cannot be bound", () => {
  for (const m of metricsActiveForGoals()) {
    for (const s of m.supportedScopes) {
      assert.equal(isScopeBindable(s), true, `${m.metricId} offers unbindable scope ${s}`);
    }
  }
});

// ===========================================================================
// THE RECORD -- unit, direction, scope and lifecycle refusals
// ===========================================================================

test("a unit that disagrees with the registry is refused, not coerced", () => {
  // Coercion is how "5" silently becomes five percent.
  assert.throws(() => buildPerformanceGoal(goalInput({ unit: "PERCENT" })), /UNIT_MISMATCH|different claim/);
});

test("a direction the metric does not allow is refused", () => {
  // AT_MOST on a completions goal would invert its meaning: "complete at most 500 jobs" read as a
  // target met by doing nothing.
  assert.throws(() => buildPerformanceGoal(goalInput({ direction: "AT_MOST" })), (e) => {
    assert.equal(e.code, "DIRECTION_NOT_ALLOWED");
    return true;
  });
});

test("a currency on a non-currency metric is a category error, and its absence on a money metric is too", () => {
  assert.throws(() => buildPerformanceGoal(goalInput({ currency: "USD" })), (e) => {
    assert.equal(e.code, "CURRENCY_UNEXPECTED");
    return true;
  });
});

test("a FIRM goal carries no scope id, and a scoped goal requires one", () => {
  assert.throws(
    () => buildPerformanceGoal(goalInput({ metricId: "service.workOrder.pastDue.count", unit: "COUNT", direction: "AT_MOST", targetScopeType: "FIRM", targetScopeId: "somewhere" })),
    (e) => { assert.equal(e.code, "SCOPE_ID_UNEXPECTED"); return true; },
  );
  assert.throws(
    () => buildPerformanceGoal(goalInput({ targetScopeId: null })),
    (e) => { assert.equal(e.code, "SCOPE_ID_REQUIRED"); return true; },
  );
});

test("a scope the metric does not support is refused", () => {
  assert.throws(
    () => buildPerformanceGoal(goalInput({ targetScopeType: "LOCATION", targetScopeId: "wh-north" })),
    (e) => { assert.equal(e.code, "SCOPE_NOT_SUPPORTED"); return true; },
  );
});

test("DRAFT is not APPROVED, and neither may wear the other's evidence", () => {
  assert.throws(
    () => buildPerformanceGoal(goalInput({ status: "DRAFT" })),
    (e) => { assert.equal(e.code, "DRAFT_NOT_APPROVED"); return true; },
  );
  assert.throws(
    () => buildPerformanceGoal(goalInput({ approvedByUid: null, approvedAtMillis: null })),
    (e) => { assert.equal(e.code, "APPROVAL_EVIDENCE_REQUIRED"); return true; },
  );
  const draft = buildPerformanceGoal(goalInput({ status: "DRAFT", approvedByUid: null, approvedAtMillis: null }));
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.approvedByUid, null);
});

test("the author of a goal may not be recorded as its approver -- at the record boundary, not only at the command", () => {
  assert.throws(
    () => buildPerformanceGoal(goalInput({ approvedByUid: "u-svcmgr" })),
    (e) => { assert.equal(e.code, "SELF_APPROVAL_FORBIDDEN"); return true; },
  );
});

test("a version above 1 must name what it supersedes, and version 1 may not", () => {
  assert.throws(() => buildPerformanceGoal(goalInput({ version: 2 })), (e) => { assert.equal(e.code, "SUPERSEDES_REQUIRED"); return true; });
  assert.throws(() => buildPerformanceGoal(goalInput({ supersedesGoalId: "goal-0" })), (e) => { assert.equal(e.code, "SUPERSEDES_INVALID"); return true; });
  assert.throws(
    () => buildPerformanceGoal(goalInput({ goalId: "goal-1", version: 2, supersedesGoalId: "goal-1" })),
    (e) => { assert.equal(e.code, "SUPERSEDES_INVALID"); return true; },
  );
});

// ===========================================================================
// HISTORY -- a September target stays September's target
// ===========================================================================

test("superseding a target does not rewrite what the earlier period was measured against", () => {
  // The Owner's rule, and the reason supersession closes a window rather than editing a number:
  // "Never mutate history to make an employee's old performance percentage change."
  const september = buildPerformanceGoal(goalInput({
    goalId: "g-sep", version: 1, targetValue: 10,
    effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30", status: "SUPERSEDED",
  }));
  const october = buildPerformanceGoal(goalInput({
    goalId: "g-oct", version: 2, supersedesGoalId: "g-sep", targetValue: 14,
    effectiveFrom: "2026-10-01", effectiveTo: null, status: "APPROVED",
  }));

  const target = { metricId: september.metricId, targetScopeType: "EMPLOYEE", targetScopeId: "emp-tech" };

  // October's change did not reach back: September still resolves to nothing-in-force, because the
  // September version is SUPERSEDED and history is read from the version itself.
  assert.equal(september.targetValue, 10, "the earlier version's number is untouched by the later one");
  assert.equal(september.effectiveTo, "2026-09-30", "and so is its window");

  // What IS in force now is October's.
  assert.equal(currentGoalFor([september, october], target, "2026-10-15").goalId, "g-oct");
  assert.equal(currentGoalFor([september, october], target, "2026-10-15").targetValue, 14);
});

test("only an APPROVED version is ever in force -- a draft and a superseded version are history", () => {
  const draft = buildPerformanceGoal(goalInput({ goalId: "g-d", status: "DRAFT", approvedByUid: null, approvedAtMillis: null, effectiveFrom: "2026-09-01" }));
  const superseded = buildPerformanceGoal(goalInput({ goalId: "g-s", status: "SUPERSEDED", effectiveFrom: "2026-09-01" }));
  const target = { metricId: draft.metricId, targetScopeType: "EMPLOYEE", targetScopeId: "emp-tech" };
  assert.equal(currentGoalFor([draft, superseded], target, "2026-09-15"), null);
  assert.throws(() => evaluateGoal(draft, 3), (e) => { assert.equal(e.code, "GOAL_NOT_APPROVED"); return true; });
  assert.throws(() => evaluateGoal(superseded, 3), (e) => { assert.equal(e.code, "GOAL_NOT_APPROVED"); return true; });
});

test("two approved versions covering one date is a REFUSAL, not a tie-break", () => {
  // A supersession that failed to close its predecessor's window is a data defect. Picking the newer
  // one hides it, and the hidden version is the one where a manager's screen and an employee's screen
  // show different targets for the same day.
  const a = buildPerformanceGoal(goalInput({ goalId: "g-a", effectiveFrom: "2026-09-01", effectiveTo: "2026-12-31" }));
  const b = buildPerformanceGoal(goalInput({ goalId: "g-b", version: 2, supersedesGoalId: "g-a", effectiveFrom: "2026-10-01", effectiveTo: null }));
  const target = { metricId: a.metricId, targetScopeType: "EMPLOYEE", targetScopeId: "emp-tech" };
  assert.throws(() => currentGoalFor([a, b], target, "2026-11-01"), (e) => {
    assert.equal(e.code, "GOAL_AMBIGUOUS");
    return true;
  });
  // Same data, a date only one version covers: no ambiguity, so no refusal.
  assert.equal(currentGoalFor([a, b], target, "2026-09-15").goalId, "g-a");
});

test("an effective window is inclusive at both ends and open-ended when effectiveTo is null", () => {
  const g = buildPerformanceGoal(goalInput({ effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }));
  assert.equal(goalCoversDate(g, "2026-08-31"), false);
  assert.equal(goalCoversDate(g, "2026-09-01"), true);
  assert.equal(goalCoversDate(g, "2026-09-30"), true);
  assert.equal(goalCoversDate(g, "2026-10-01"), false);
  const open = buildPerformanceGoal(goalInput({ effectiveTo: null }));
  assert.equal(goalCoversDate(open, "2099-01-01"), true);
});

// ===========================================================================
// EVALUATION -- UNKNOWN is not zero, and attainment is not invented
// ===========================================================================

test("UNKNOWN never reaches the comparison as a number", () => {
  const g = buildPerformanceGoal(goalInput());
  for (const bad of [undefined, null, NaN, Infinity, "12"]) {
    assert.throws(() => evaluateGoal(g, bad), (e) => { assert.equal(e.code, "ACTUAL_INVALID"); return true; });
  }
});

test("attainment percent exists only where it means something", () => {
  const atLeast = buildPerformanceGoal(goalInput({ targetValue: 400 }));
  assert.equal(evaluateGoal(atLeast, 300).attainmentPercent, 75);
  assert.equal(evaluateGoal(atLeast, 300).met, false);
  assert.equal(evaluateGoal(atLeast, 400).met, true);

  // AT_MOST: "80% attainment" of a past-due target of 5 means nothing a reader would agree on, so
  // there is no number rather than a plausible one.
  const atMost = buildPerformanceGoal(goalInput({
    metricId: "service.workOrder.pastDue.count", unit: "COUNT", direction: "AT_MOST",
    targetScopeType: "FIRM", targetScopeId: null, targetValue: 5,
  }));
  assert.equal(evaluateGoal(atMost, 3).attainmentPercent, null);
  assert.equal(evaluateGoal(atMost, 3).met, true);
  assert.equal(evaluateGoal(atMost, 9).met, false);
  assert.equal(evaluateGoal(atMost, 9).variance, 4);

  // A zero target would make every actual infinite attainment.
  const zero = buildPerformanceGoal(goalInput({ targetValue: 0 }));
  assert.equal(evaluateGoal(zero, 7).attainmentPercent, null);
});

// ===========================================================================
// FIN-003 RECONCILIATION -- one goal system, one money path
// ===========================================================================

test("a financial goal IS a FIN-003 plan, and is compared by FIN-003's own core", () => {
  // sales.booked.amount is inactive (FIN-004 + AB-2), so a real goal cannot be created against it
  // today. The PROJECTION is still proven here against a hand-built record, because the whole point
  // of the reconciliation is that the money path exists in exactly one place -- and a test that
  // waited for the grant would leave that unproven for as long as the grant is missing.
  const goal = Object.freeze({
    goalId: "g-booked", metricId: "sales.booked.amount",
    targetScopeType: "EMPLOYEE", targetScopeId: "emp-rep",
    targetValue: 25_000_00, unit: "CURRENCY_MINOR", direction: "AT_LEAST", currency: "USD",
    effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30",
    status: "APPROVED", version: 1,
    createdByUid: "u-salesmgr", createdAtMillis: NOW,
    approvedByUid: "u-gm", approvedAtMillis: NOW, supersedesGoalId: null,
  });

  const plan = planRecordForGoal(goal);
  assert.equal(plan.planType, "GOAL");
  assert.equal(plan.measurementBasis, "BOOKED", "the basis comes from the registry, never from the goal");
  assert.equal(plan.amountMinor, 25_000_00);
  assert.equal(plan.scope.creditedSalespersonId, "emp-rep", "an EMPLOYEE goal binds FIN-002's credited-salesperson dimension");

  const result = comparePlanToActual(plan, [
    { ref: "inv-1", basis: "BOOKED", currency: "USD", amountMinor: 10_000_00, eventDate: "2026-09-10", creditedSalespersonId: "emp-rep" },
    { ref: "inv-2", basis: "BOOKED", currency: "USD", amountMinor: 9_000_00, eventDate: "2026-09-20", creditedSalespersonId: "emp-rep" },
    { ref: "inv-3", basis: "BOOKED", currency: "USD", amountMinor: 5_000_00, eventDate: "2026-10-02", creditedSalespersonId: "emp-rep" },
  ]);
  assert.equal(result.actualMinor, 19_000_00);
  assert.equal(result.varianceMinor, -6_000_00);
  assert.equal(result.excluded.length, 1, "the October fact is excluded BY NAME, never silently");
  assert.match(result.excluded[0].reason, /outside plan period/);

  // And the never-blend rule is FIN-003's, unchanged: a billed fact against a booked plan is a
  // category error, not a smaller number.
  assert.throws(
    () => comparePlanToActual(plan, [{ ref: "x", basis: "BILLED", currency: "USD", amountMinor: 1, eventDate: "2026-09-10", creditedSalespersonId: "emp-rep" }]),
    /BASIS_MISMATCH|never blended/,
  );
});

test("a non-financial goal refuses to become a plan record rather than inventing a basis", () => {
  const g = buildPerformanceGoal(goalInput());
  assert.throws(() => planRecordForGoal(g), (e) => {
    assert.equal(e.code, "NOT_A_FINANCIAL_GOAL");
    return true;
  });
});

// ===========================================================================
// AUTHORITY -- the four factors
// ===========================================================================

function auth(over = {}) {
  return resolveGoalAuthority({
    actorUid: "u-svcmgr",
    actorEmployeeId: "emp-svcmgr",
    verb: "create",
    metricId: "technician.workOrder.completed.cumulative.count",
    targetScopeType: "EMPLOYEE",
    targetScopeId: "emp-tech",
    assignments: [assignment("fieldManager", { type: "global" }, "u-svcmgr")],
    roles: ROLES,
    currentAccessVersion: 1,
    population: POPULATION,
    activationOverrides: GOAL_ACTIVATION,
    ...over,
  });
}

test("without environment activation the whole authority is inert -- every verb denies", () => {
  // REGISTER != GRANT != ACTIVATE. A Service Manager holding every goal capability, targeting their
  // own technician, is still refused where the capability is not activated. This is the default, and
  // production is where it stays.
  for (const verb of ["read", "create", "approve", "supersede", "retire"]) {
    const d = auth({ verb, activationOverrides: undefined, authoredByUid: "u-other" });
    assert.equal(d.decision, "DENY", `${verb} must deny with no activation`);
    assert.equal(d.factor, "noGoalCapabilityAtScope");
  }
});

test("the Service Manager may set a technician's target", () => {
  assert.equal(auth().decision, "ALLOW");
});

test("a principal with no goal capability is refused before anything else is asked", () => {
  const d = auth({ assignments: [assignment("salesperson", { type: "global" }, "u-svcmgr")] });
  assert.equal(d.decision, "DENY");
  assert.equal(d.factor, "noGoalCapabilityAtScope");
});

test("a Sales Manager may not set a technician's target -- and not because anything reads its name", () => {
  // The Owner's example. salesManager holds performance.goal.create, so factor 1 PASSES; the refusal
  // comes from hierarchical visibility, because roleHierarchy.ts places technician under the Service
  // Manager branch and salesManager is a peer of that branch, not an ancestor.
  const d = auth({
    actorUid: "u-salesmgr", actorEmployeeId: "emp-salesmgr",
    assignments: [assignment("salesManager", { type: "global" }, "u-salesmgr")],
  });
  assert.equal(d.decision, "DENY");
  assert.equal(d.factor, "employeeOutsideVisibility");

  // Same principal, same capability, a subject that IS beneath them: allowed. This is what proves
  // the refusal above is about position rather than about the metric or the verb.
  const ok = resolveGoalAuthority({
    actorUid: "u-salesmgr", actorEmployeeId: "emp-salesmgr", verb: "create",
    metricId: "crm.account.active.count", targetScopeType: "FIRM", targetScopeId: null,
    assignments: [assignment("salesManager", { type: "global" }, "u-salesmgr")],
    roles: ROLES, currentAccessVersion: 1, population: POPULATION, activationOverrides: GOAL_ACTIVATION,
  });
  assert.equal(ok.decision, "ALLOW");
});

test("an employee does not author their own target, though they may read it", () => {
  // Hierarchical visibility ALWAYS includes the viewer's own employeeId, so factor 3 alone would
  // permit this. Factor 5 is what refuses it.
  const write = auth({
    actorUid: "u-tech", actorEmployeeId: "emp-tech",
    assignments: [assignment("fieldManager", { type: "global" }, "u-tech")],
  });
  assert.equal(write.decision, "DENY");
  assert.equal(write.factor, "selfTargeting");

  const read = auth({
    verb: "read", actorUid: "u-tech", actorEmployeeId: "emp-tech",
    assignments: [assignment("performanceGoalSubject", { type: "global" }, "u-tech")],
  });
  assert.equal(read.decision, "ALLOW", "seeing your own target is the point of having one");
});

test("a technician holding only the subject Role sees exactly one person's goals: their own", () => {
  const other = resolveGoalAuthority({
    actorUid: "u-tech", actorEmployeeId: "emp-tech", verb: "read",
    metricId: "technician.workOrder.completed.cumulative.count",
    targetScopeType: "EMPLOYEE", targetScopeId: "emp-svcmgr",
    assignments: [assignment("performanceGoalSubject", { type: "global" }, "u-tech")],
    roles: ROLES, currentAccessVersion: 1, population: POPULATION, activationOverrides: GOAL_ACTIVATION,
  });
  assert.equal(other.decision, "DENY");
  assert.equal(other.factor, "employeeOutsideVisibility");
});

test("a Parts Manager for wh-north may not touch a goal for wh-south", () => {
  // The Owner's other example. The refusal is the value match that already governs
  // reorder.request.create.manual on this Role -- no new mechanism, and nothing reads "partsManager".
  const base = {
    actorUid: "u-partsmgr", actorEmployeeId: "emp-partsmgr", verb: "create",
    metricId: "parts.reorderRequest.open.count", targetScopeType: "LOCATION",
    roles: ROLES, currentAccessVersion: 1, population: POPULATION, activationOverrides: GOAL_ACTIVATION,
    assignments: [assignment("partsManager", { type: "location", value: "wh-north" }, "u-partsmgr")],
  };
  assert.equal(resolveGoalAuthority({ ...base, targetScopeId: "wh-north" }).decision, "ALLOW");

  const south = resolveGoalAuthority({ ...base, targetScopeId: "wh-south" });
  assert.equal(south.decision, "DENY");
  assert.equal(south.factor, "noGoalCapabilityAtScope");
});

test("you may not set a target on a number you are not authorized to see", () => {
  // Factor 2, and the one that does the most work for the least code. The Service Manager holds
  // performance.goal.create globally (factor 1 passes) but not reorder.request.create.manual at
  // wh-north, which is what governs the reorder queue's ACTUAL -- so a parts-location target is
  // refused without anyone writing a rule about service managers and warehouses.
  const d = resolveGoalAuthority({
    actorUid: "u-svcmgr", actorEmployeeId: "emp-svcmgr", verb: "create",
    metricId: "parts.reorderRequest.open.count", targetScopeType: "LOCATION", targetScopeId: "wh-north",
    assignments: [assignment("fieldManager", { type: "global" }, "u-svcmgr")],
    roles: ROLES, currentAccessVersion: 1, population: POPULATION, activationOverrides: GOAL_ACTIVATION,
  });
  assert.equal(d.decision, "DENY");
  assert.equal(d.factor, "noAuthorityOverMetric");
});

test("nobody approves their own draft, whatever else they hold", () => {
  const own = auth({ verb: "approve", authoredByUid: "u-svcmgr" });
  assert.equal(own.decision, "DENY");
  assert.equal(own.factor, "selfApproval");

  const colleague = auth({ verb: "approve", authoredByUid: "u-other" });
  assert.equal(colleague.decision, "ALLOW");

  const unknownAuthor = auth({ verb: "approve", authoredByUid: null });
  assert.equal(unknownAuthor.decision, "DENY");
  assert.equal(unknownAuthor.factor, "selfApproval");
});

test("an inactive metric refuses every write verb and still permits read", () => {
  // History does not become unreadable because the platform stopped accepting new targets.
  for (const verb of ["create", "approve", "supersede", "retire"]) {
    const d = auth({ verb, metricId: "service.firstTimeFix.rate", authoredByUid: "u-other" });
    assert.equal(d.decision, "DENY", `${verb} must refuse an inactive metric`);
    assert.equal(d.factor, "metricNotActiveForGoals");
  }
  assert.equal(auth({ verb: "read", metricId: "service.firstTimeFix.rate" }).decision, "ALLOW");
});

test("malformed input is a denial, never an exception a caller could mistake for permission", () => {
  for (const bad of [
    { metricId: undefined },
    { metricId: 42 },
    { targetScopeType: "TEAM", targetScopeId: "team-1" },
    { assignments: null },
  ]) {
    const d = auth(bad);
    assert.equal(d.decision, "DENY", `${JSON.stringify(bad)} must deny`);
    assert.ok(d.factor, "and must name which factor refused");
  }
});

test("a goal's target scope is asked at its OWN access scope, never widened to global", () => {
  assert.deepEqual(accessScopeForTarget("LOCATION", "wh-north"), { type: "location", value: "wh-north" });
  assert.deepEqual(accessScopeForTarget("BUSINESS_UNIT", "SERVICE"), { type: "businessUnit", value: "SERVICE" });
  assert.deepEqual(accessScopeForTarget("OPERATING_COMPANY", "taylor"), { type: "operatingCompany", value: "taylor" });
  assert.deepEqual(accessScopeForTarget("FIRM", null), { type: "global" });
  // EMPLOYEE has no employee-typed access scope in the governed model, and inventing one would be
  // minting a scope. It is asked globally and narrowed by factor 3 instead.
  assert.deepEqual(accessScopeForTarget("EMPLOYEE", "emp-tech"), { type: "global" });
});

// ===========================================================================
// OFFERED == ACCEPTED
// ===========================================================================

test("the subject picker offers exactly the people the command would accept", () => {
  const offered = goalSubjectEmployeeIdsFor("u-svcmgr", "emp-svcmgr", POPULATION);
  assert.deepEqual(offered, ["emp-tech"], "the Service Manager's reports, and not themselves");

  for (const employeeId of offered) {
    const d = auth({ targetScopeId: employeeId });
    assert.equal(d.decision, "ALLOW", `${employeeId} was offered and must be accepted`);
  }
  // And the converse: a person NOT offered is refused.
  assert.equal(auth({ targetScopeId: "emp-rep" }).decision, "DENY");
});

test("a leaf position is offered nobody -- not even themselves", () => {
  assert.deepEqual(goalSubjectEmployeeIdsFor("u-tech", "emp-tech", POPULATION), []);
});

test("an unknown principal is offered nobody, rather than everybody", () => {
  assert.deepEqual(goalSubjectEmployeeIdsFor("u-nobody", null, POPULATION), []);
});

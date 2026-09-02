// DASHBOARD COMPOSITION + GOAL PROGRESS -- the refusals a dashboard must make.
//
// Pure (no React, no network, no Firestore):
//   node --test test/dashboardComposition.test.mjs
//
// The cases are the ones the Owner's direction named for a dashboard: an unauthorized fact never
// appears, the same role at different scopes composes differently, UNKNOWN is never coerced to 0, a
// gated target stays honestly unavailable, and no derived fact is presented as governed truth.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeDashboard,
  resolvedModuleKeys,
  goalTargetsFor,
  DASHBOARD_MODULES,
  MODULE_STATE,
  SECTION,
  SECTION_ORDER,
} from "../src/domain/dashboardComposition.js";
import { goalProgress, goalBarPercent, goalTone, GOAL_PROGRESS_STATE } from "../src/domain/goalProgress.js";

const capable = (...ids) => (id) => ids.includes(id);
const none = () => false;

const TECHNICIAN = { role: "technician", employeeId: "emp-tech", technicianId: "tech-1", operationalRoles: [], warehouseIds: [], hasCapability: none };
const DISPATCHER = { role: "dispatcher", employeeId: "emp-disp", technicianId: null, operationalRoles: [], warehouseIds: [], hasCapability: none };
const PARTS_NORTH = { role: "user", employeeId: "emp-parts", technicianId: null, operationalRoles: ["PARTS_MANAGER"], warehouseIds: ["wh-north"], hasCapability: capable("inventory.stock.receive") };
const PARTS_BOTH = { ...PARTS_NORTH, employeeId: "emp-parts2", warehouseIds: ["wh-north", "wh-main"] };
const SALESPERSON = { role: "user", employeeId: "emp-rep", technicianId: null, operationalRoles: [], warehouseIds: [], hasCapability: capable("opportunity.read", "customer.record.read") };

// ===========================================================================
// AN UNAUTHORIZED FACT NEVER APPEARS
// ===========================================================================

test("a module whose scope the viewer does not hold is ABSENT, not empty", () => {
  // Showing an empty "my assigned work" to someone with no technician binding STATES that they have
  // no work. That is a different claim from "this does not apply to you", and it is false.
  const keys = resolvedModuleKeys(SALESPERSON);
  assert.ok(!keys.includes("myAssignedWork"));
  assert.ok(!keys.includes("serviceAttention"), "a salesperson is not an operations viewer");
  assert.ok(!keys.includes("adminDecisions"));

  // And the converse, so the assertion above is about scope rather than about the table being empty.
  assert.ok(resolvedModuleKeys(TECHNICIAN).includes("myAssignedWork"));
  assert.ok(resolvedModuleKeys(DISPATCHER).includes("serviceAttention"));
});

test("no module is composed from a persona name -- every gate reads governed context", () => {
  // The load-bearing property. If a `needs` predicate ever branches on a role STRING as its only
  // input, this test is the thing that should have caught it: a context with an unrecognised role
  // but real governed scope must still compose the modules that scope supplies.
  const unnamedRole = { ...PARTS_NORTH, role: "some-future-role" };
  const keys = resolvedModuleKeys(unnamedRole);
  assert.ok(keys.includes("reorderQueue"), "a location scope composes the reorder module whatever the role is called");
  assert.ok(keys.includes("receivingQueue"), "and a receive capability composes receiving");
});

test("a malformed context removes modules rather than crashing or widening", () => {
  for (const bad of [null, undefined, {}, { hasCapability: "not a function" }, { warehouseIds: "wh-north" }]) {
    const sections = composeDashboard(bad);
    const keys = sections.flatMap((s) => s.modules.map((m) => m.key));
    // GO TO always resolves -- it is the destination list, which is computed per principal
    // downstream and is itself fail-closed. Nothing ELSE may appear from a malformed context.
    assert.deepEqual(keys, ["goTo"], `malformed context ${JSON.stringify(bad)} must compose nothing but Go to`);
  }
});

// ===========================================================================
// THE SAME ROLE AT DIFFERENT SCOPES COMPOSES DIFFERENTLY
// ===========================================================================

test("one warehouse and two warehouses produce different dashboards", () => {
  const one = goalTargetsFor(PARTS_NORTH);
  const two = goalTargetsFor(PARTS_BOTH);
  assert.equal(one.length + 2, two.length, "each governed warehouse adds its own location targets");

  const northOnly = one.filter((t) => t.targetScopeType === "LOCATION").map((t) => t.targetScopeId);
  assert.deepEqual([...new Set(northOnly)], ["wh-north"]);
  assert.ok(
    two.some((t) => t.targetScopeId === "wh-main"),
    "the second warehouse appears only for the principal governed to it",
  );
});

test("a principal governed to NO warehouse asks for no location target", () => {
  // An empty warehouse list is a real answer, not a failure: a principal may legitimately be
  // governed to no warehouse, and the dashboard must not then ask about all of them.
  const scopeless = { ...PARTS_NORTH, warehouseIds: [] };
  assert.equal(goalTargetsFor(scopeless).filter((t) => t.targetScopeType === "LOCATION").length, 0);
});

test("goal targets are derived only from governed context, never from a role label", () => {
  assert.deepEqual(goalTargetsFor({ role: "admin", employeeId: null, warehouseIds: [] }).filter((t) => t.targetScopeType === "EMPLOYEE"), []);
  const withEmployee = goalTargetsFor(TECHNICIAN);
  assert.ok(withEmployee.every((t) => t.targetScopeId === "emp-tech" || t.targetScopeType !== "EMPLOYEE"));
});

// ===========================================================================
// EVERY NON-READY MODULE NAMES ITS BLOCKER
// ===========================================================================

test("a module that is not READY always says why, in a sentence", () => {
  for (const m of DASHBOARD_MODULES) {
    const state = m.state({});
    if (state === MODULE_STATE.READY) {
      assert.equal(m.blocker ?? null, null, `${m.key} is READY and must carry no blocker`);
    } else {
      assert.ok(
        typeof m.blocker === "string" && m.blocker.length > 30,
        `${m.key} is ${state} and must name its blocker -- "Unavailable" tells a reader nothing`,
      );
      assert.ok(m.blocker.trim().endsWith("."), `${m.key}'s blocker should read as a sentence`);
    }
  }
});

test("GATED, UNAVAILABLE and NOT_WIRED stay three different states", () => {
  // They imply three different next actions -- someone must DECIDE something, someone must DEFINE
  // something, or nobody must do anything but this surface has not composed the read. Collapsing any
  // two would make engineering debt look like a governance blocker, or the reverse.
  const states = new Set(DASHBOARD_MODULES.map((m) => m.state({})));
  assert.ok(states.has(MODULE_STATE.GATED));
  assert.ok(states.has(MODULE_STATE.UNAVAILABLE));
  assert.ok(states.has(MODULE_STATE.NOT_WIRED));
});

test("the cost-dependent module is UNAVAILABLE and names all three missing pieces", () => {
  const cost = DASHBOARD_MODULES.find((m) => m.key === "costImpact");
  assert.equal(cost.state({}), MODULE_STATE.UNAVAILABLE);
  // Waste avoided is the direction's worked example of a figure that must never be invented.
  assert.match(cost.blocker, /cost fact/i);
  assert.match(cost.blocker, /prevention event/i);
  assert.match(cost.blocker, /would otherwise have happened/i);
});

test("the financial module names the reporting period, NOT a reach gap that no longer exists", () => {
  // CORRECTED 2026-09-02. This test first asserted the blocker mentioned a missing finance
  // visibility scope, because the dashboard census reported that no Role carried one. That finding
  // was WITHDRAWN (#1743): it was measured by grepping Role sources, which cannot see admin's
  // DERIVED grants, and by resolver admin and owner carry all five scopes.
  //
  // The assertion is kept and INVERTED rather than deleted, because the failure mode it guards is
  // real and recurring: a module that keeps citing a blocker which has since cleared sends a reader
  // to lobby for a grant that already exists. It now fails if the withdrawn claim comes back.
  const fin = DASHBOARD_MODULES.find((m) => m.key === "firmRevenue");
  assert.equal(fin.state({}), MODULE_STATE.GATED);
  assert.match(fin.blocker, /reporting calendar|period/i, "the real blocker is the reporting period");
  assert.ok(
    !/no role currently carries a finance visibility scope/i.test(fin.blocker),
    "the withdrawn FIN-004 reach finding must not be cited as a blocker again",
  );
  const booked = DASHBOARD_MODULES.find((m) => m.key === "myBooked");
  assert.ok(
    !/no role currently carries a finance visibility scope/i.test(booked.blocker),
    "nor here",
  );
});

// ===========================================================================
// SECTIONS
// ===========================================================================

test("a section with no modules is omitted, never rendered empty", () => {
  const sections = composeDashboard(SALESPERSON);
  for (const s of sections) assert.ok(s.modules.length > 0, `${s.section} was kept with no modules`);
  // An empty "Team performance" heading on a screen with no team would imply one.
  assert.ok(!sections.some((s) => s.section === SECTION.TEAM_PERFORMANCE));
});

test("section order is fixed, so a reader relearns nothing between screens", () => {
  for (const ctx of [TECHNICIAN, DISPATCHER, PARTS_BOTH, SALESPERSON]) {
    const order = composeDashboard(ctx).map((s) => s.section);
    const expected = SECTION_ORDER.filter((s) => order.includes(s));
    assert.deepEqual(order, expected, "sections must always appear in the canonical order");
  }
});

test("CURRENT WORK precedes PERFORMANCE at every composition -- work before score", () => {
  // The ordering is a product decision, not a layout convenience: someone opening this screen needs
  // what to DO above what they are measured on, and that holds at 375 where the second section is
  // below the fold.
  for (const ctx of [TECHNICIAN, DISPATCHER, PARTS_BOTH]) {
    const order = composeDashboard(ctx).map((s) => s.section);
    const work = order.indexOf(SECTION.CURRENT_WORK);
    const perf = order.indexOf(SECTION.PERFORMANCE);
    if (work >= 0 && perf >= 0) assert.ok(work < perf, "current work must come first");
  }
});

test("Go to is always present -- a dashboard never strands its reader", () => {
  for (const ctx of [TECHNICIAN, DISPATCHER, PARTS_BOTH, SALESPERSON, {}]) {
    assert.ok(resolvedModuleKeys(ctx).includes("goTo"));
  }
});

// ===========================================================================
// UNKNOWN IS NOT ZERO
// ===========================================================================

const APPROVED_GOAL = Object.freeze({
  goalId: "g1", metricId: "technician.workOrder.completed.cumulative.count",
  targetScopeType: "EMPLOYEE", targetScopeId: "emp-tech",
  targetValue: 400, unit: "COUNT", direction: "AT_LEAST", currency: null,
  effectiveFrom: "2026-09-01", effectiveTo: null, status: "APPROVED", version: 1,
});

test("an unknown actual is NO_ACTUAL, never 0 -- and the target stays on screen", () => {
  for (const unknown of [null, undefined, Number.NaN, Infinity, "12", {}]) {
    const p = goalProgress({ goal: APPROVED_GOAL, denied: false }, unknown, "Cost authority not available.");
    assert.equal(p.state, GOAL_PROGRESS_STATE.NO_ACTUAL, `${String(unknown)} must not become a number`);
    assert.equal(p.actual, null);
    // The half that IS governed survives. Hiding the target too would lose real information.
    assert.equal(p.goal.targetValue, 400);
    assert.equal(p.reason, "Cost authority not available.");
    // There is no attainment, no variance and no bar to mislead with.
    assert.equal(p.attainmentPercent, undefined);
    assert.equal(goalBarPercent(p), null);
  }
});

test("zero is a real actual and is measured as one", () => {
  // The mirror of the test above, and the reason the check is `isRealNumber` rather than falsy: a
  // technician who genuinely completed nothing has an actual of 0, and treating that as unknown
  // would hide a real result.
  const p = goalProgress({ goal: APPROVED_GOAL, denied: false }, 0);
  assert.equal(p.state, GOAL_PROGRESS_STATE.READY);
  assert.equal(p.actual, 0);
  assert.equal(p.met, false);
  assert.equal(p.attainmentPercent, 0);
});

test("the four absences stay four -- denied is not empty, and unresolved is not 'no goal'", () => {
  assert.equal(goalProgress({ denied: true }, null).state, GOAL_PROGRESS_STATE.DENIED);
  assert.equal(goalProgress({ goal: null, denied: false }, null).state, GOAL_PROGRESS_STATE.NO_GOAL);
  assert.equal(goalProgress({ goal: null, denied: false, unavailableReason: "two approved versions" }, null).state, GOAL_PROGRESS_STATE.UNRESOLVED);
  assert.equal(goalProgress({ goal: APPROVED_GOAL, denied: false }, null).state, GOAL_PROGRESS_STATE.NO_ACTUAL);
});

// ===========================================================================
// ATTAINMENT IS NOT INVENTED
// ===========================================================================

test("attainment exists for AT_LEAST and is absent everywhere else", () => {
  const atLeast = goalProgress({ goal: APPROVED_GOAL, denied: false }, 300);
  assert.equal(atLeast.attainmentPercent, 75);
  assert.equal(atLeast.remaining, 100, "AT_LEAST remaining is still-to-do");
  assert.equal(goalBarPercent(atLeast), 75);
  assert.equal(goalTone(atLeast), "attention");

  const atMost = goalProgress({ goal: { ...APPROVED_GOAL, direction: "AT_MOST", targetValue: 5 }, denied: false }, 9);
  assert.equal(atMost.attainmentPercent, null, "there is no number a reader would agree on here");
  assert.equal(atMost.remaining, 4, "AT_MOST remaining is the OVERAGE");
  assert.equal(goalBarPercent(atMost), null, "and therefore no bar");
  assert.equal(atMost.met, false);
});

test("a met goal reports zero remaining, never a negative shortfall", () => {
  const p = goalProgress({ goal: APPROVED_GOAL, denied: false }, 450);
  assert.equal(p.met, true);
  assert.equal(p.remaining, 0);
  assert.equal(p.variance, 50);
  assert.equal(goalTone(p), "positive");
  // Overshoot lives in the NUMBER; the bar is clamped so it never stops being a bar.
  assert.equal(p.attainmentPercent, 113);
  assert.equal(goalBarPercent(p), 100);
});

test("a zero target yields no attainment percentage", () => {
  // Every actual would otherwise be infinite attainment.
  const p = goalProgress({ goal: { ...APPROVED_GOAL, targetValue: 0 }, denied: false }, 7);
  assert.equal(p.attainmentPercent, null);
});

test("tone has no invented at-risk band", () => {
  // A threshold that turned 80% amber would make a policy real by rendering it. There are two tones
  // because there are two governed facts: met, and not met.
  const tones = new Set([25, 79, 80, 99, 100, 250].map((n) => goalTone(goalProgress({ goal: APPROVED_GOAL, denied: false }, (n / 100) * 400))));
  assert.deepEqual([...tones].sort(), ["attention", "positive"]);
});

test("a non-READY progress has a neutral tone and no bar", () => {
  for (const p of [
    goalProgress({ denied: true }, null),
    goalProgress({ goal: null, denied: false }, null),
    goalProgress({ goal: APPROVED_GOAL, denied: false }, null),
  ]) {
    assert.equal(goalTone(p), "neutral");
    assert.equal(goalBarPercent(p), null);
  }
});

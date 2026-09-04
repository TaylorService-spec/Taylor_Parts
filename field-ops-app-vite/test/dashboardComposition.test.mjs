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
    // NOTHING resolves from a malformed context. GO TO used to survive here because it needed no
    // scope at all; it was removed from the dashboard entirely after the live Owner review, so a
    // malformed context now composes an empty dashboard -- which the surface renders as its
    // "nothing to show yet" state rather than as a screen of modules nobody can use.
    assert.deepEqual(keys, [], `malformed context ${JSON.stringify(bad)} must compose nothing`);
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
  assert.ok(states.has(MODULE_STATE.READY));
  // SATISFIED_ELSEWHERE joined them (#172 s11): live on another governed surface, deliberately.
  assert.ok(states.has(MODULE_STATE.SATISFIED_ELSEWHERE));
  // NOT_WIRED is now EMPTY, and that is the point of this run rather than an accident. Every module
  // that was engineering debt has been composed; everything still absent is absent for a named
  // authority reason. The state itself is KEPT so a newly declared module can be honest about
  // being unbuilt -- see the dedicated NOT_WIRED = 0 assertion below.
  assert.ok(!states.has(MODULE_STATE.NOT_WIRED), "NOT_WIRED must be empty after the reconciliation");
});

test("the cost-dependent module is UNAVAILABLE and names what is actually missing", () => {
  const cost = DASHBOARD_MODULES.find((m) => m.key === "costImpact");
  assert.equal(cost.state({}), MODULE_STATE.UNAVAILABLE);
  // Waste avoided is the direction's worked example of a figure that must never be invented.
  assert.match(cost.blocker, /prevention event/i);
  assert.match(cost.blocker, /would otherwise have happened/i);
  // The remaining gaps are a COSTING METHOD and a HOLDING RATE -- both Owner decisions, not queries.
  assert.match(cost.blocker, /costing method/i);
  assert.match(cost.blocker, /rate/i);
});

test("the cost blocker must never again claim no cost fact exists", () => {
  // STALE-CLAIM GUARD. This module said "no governed cost fact exists anywhere in the platform"
  // until FIN-BLOCK-003A wrote an immutable acquisition-cost fact at receipt. The sentence was
  // correct when written and became false without anyone editing it, which is the whole failure
  // mode this suite exists to catch: a blocker that outlives its cause sends a reader to build
  // something that is already there.
  const cost = DASHBOARD_MODULES.find((m) => m.key === "costImpact");
  assert.ok(
    !/no governed cost fact exists/i.test(cost.blocker),
    "acquisition-cost facts exist; this claim is disproven by FIN-BLOCK-003A",
  );
  // ...and the correction must not overshoot in the other direction. Acquisition cost is NOT
  // valuation, NOT COGS and NOT margin, so the module stays unavailable rather than inventing them.
  assert.equal(cost.state({}), MODULE_STATE.UNAVAILABLE);
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
  // INVERTED A SECOND TIME, for the same reason it was inverted the first. This asserted that the
  // blocker names the REPORTING PERIOD -- true when written, false once G-05 landed DAY/MTD/QTD/YTD
  // /T12M on the America/Phoenix calendar. A test that pins a blocker to a cleared cause does not
  // merely go stale; it actively prevents the correction.
  const financial = ["firmBilled", "firmCollected", "firmBooked", "myBooked"].map((key) =>
    DASHBOARD_MODULES.find((m) => m.key === key),
  );
  for (const m of financial) {
    assert.ok(m, "financial module missing from the table");
    assert.ok(
      !/no role currently carries a finance visibility scope/i.test(m.blocker),
      `the withdrawn FIN-004 reach finding must not be cited again: ${m.key}`,
    );
    assert.ok(
      !/no reporting (calendar|period)|has no reporting calendar/i.test(m.blocker),
      `G-05 landed the reporting calendar; ${m.key} must not cite its absence`,
    );
  }
});

test("booked, billed and collected are three facts with three readinesses, never one tile", () => {
  // They shared one GATED state and one blocker, so the least-ready fact suppressed the other two:
  // billed and collected have a governed period read with server-side rollups TODAY, and were being
  // reported unavailable because booked is not.
  const billed = DASHBOARD_MODULES.find((m) => m.key === "firmBilled");
  const collected = DASHBOARD_MODULES.find((m) => m.key === "firmCollected");
  const booked = DASHBOARD_MODULES.find((m) => m.key === "firmBooked");

  // Billed and collected are now COMPOSED, from the server's own per-company, per-currency rollup.
  assert.equal(billed.state({}), MODULE_STATE.READY);
  assert.equal(collected.state({}), MODULE_STATE.READY);
  // Booked is a genuine absence -- there is no read to switch on, at any period.
  assert.equal(booked.state({}), MODULE_STATE.UNAVAILABLE);
  assert.match(booked.blocker, /no governed read/i);

  // The compound tile must not come back.
  assert.equal(DASHBOARD_MODULES.find((m) => m.key === "firmRevenue"), undefined);
});

test("the stock-position blocker must not claim the capability is switched off", () => {
  // STALE-CLAIM GUARD. This said "the governed balance read is not switched on for this environment
  // yet". `inventory.balance.read` IS activated in platform-sandbox and `getPartBalance` is
  // deployed, so that sentence sent a reader to tick a box already ticked.
  //
  // It stays GATED, because two real obstructions remain: the client transport flag, and the
  // absence of any LOCATION-level aggregate -- the reads answer per part. Naming the wrong one is
  // what this guards.
  const stock = DASHBOARD_MODULES.find((m) => m.key === "governedStockPosition");
  assert.equal(stock.state({}), MODULE_STATE.GATED);
  assert.ok(
    !/not switched on for this environment/i.test(stock.blocker),
    "the capability is activated; this claim is disproven by config/environments.json",
  );
  // The real reasons, both named.
  assert.match(stock.blocker, /per part/i, "the per-part vs per-location gap must be stated");
  assert.match(stock.blocker, /browser bundle|switched off in the browser/i, "the transport gate must be stated");
  // And the module must keep refusing to be read as a stock position.
  assert.match(stock.blocker, /derived information/i);
});

test("myBooked is UNAVAILABLE because no read exists, not because a period is missing", () => {
  const booked = DASHBOARD_MODULES.find((m) => m.key === "myBooked");
  assert.equal(booked.state({}), MODULE_STATE.UNAVAILABLE);
  assert.match(booked.blocker, /no governed read/i);
  // The direction's explicit prohibition, stated on the tile so nobody "fixes" it the wrong way.
  assert.match(booked.blocker, /browser|invent/i);
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

test("GO TO IS GONE -- navigation belongs to the rail, not to the dashboard", () => {
  // INVERTED after the live Owner review: "not sure we really need the links at the bottom". The
  // rail and drawer already own navigation, and repeating the site map below the business content
  // cost most of the page. The assertion is kept and reversed rather than deleted, because the
  // failure it guards is real: a dashboard that quietly grows a second navigation surface.
  for (const ctx of [TECHNICIAN, DISPATCHER, PARTS_BOTH, SALESPERSON, {}]) {
    assert.ok(!resolvedModuleKeys(ctx).includes("goTo"), "the dashboard must not compose a Go to module");
  }
  assert.equal(DASHBOARD_MODULES.find((m) => m.key === "goTo"), undefined, "the goTo module must not exist");
  assert.ok(!Object.keys(SECTION).includes("GO_TO"), "the GO_TO section must not exist");
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

// ===========================================================================
// THE CLOSING GATE
// ===========================================================================

test("NO module is left as engineering debt -- NOT_WIRED must be zero", () => {
  // The terminal condition of the reconciliation. Every module is now exactly one of: composed,
  // satisfied on another governed surface, gated on a named activation, or unavailable for a named
  // missing authority. NOT_WIRED means "nobody must decide anything and this surface simply has not
  // done the work" -- and there is no longer any of that.
  const notWired = DASHBOARD_MODULES.filter((m) => m.state({}) === MODULE_STATE.NOT_WIRED);
  assert.deepEqual(notWired.map((m) => m.key), [], "these modules are unfinished, not blocked");
});

test("every module resolves to exactly one of the four honest end states", () => {
  const allowed = new Set([
    MODULE_STATE.READY,
    MODULE_STATE.SATISFIED_ELSEWHERE,
    MODULE_STATE.GATED,
    MODULE_STATE.UNAVAILABLE,
  ]);
  for (const m of DASHBOARD_MODULES) {
    assert.ok(allowed.has(m.state({})), `${m.key} is in an unclassified state`);
  }
});

test("every non-READY module names a blocker; no bare 'unavailable' survives", () => {
  // A blocker sentence is the whole value of a module that shows no number: it says whether someone
  // must decide something, define something, or look somewhere else.
  for (const m of DASHBOARD_MODULES) {
    if (m.state({}) === MODULE_STATE.READY) continue;
    assert.ok(typeof m.blocker === "string" && m.blocker.length > 40, `${m.key} has no usable blocker`);
    assert.ok(!/^unavailable.?$/i.test(m.blocker.trim()), `${m.key} says nothing`);
  }
});

test("no blocker cites an authority gap that has since been closed", () => {
  // The stale-claim guard, generalized. Each pattern was TRUE when written and became false without
  // anyone editing it -- which is exactly how a blocker sends a reader to build what already exists.
  const disproven = [
    [/no reporting (calendar|period)/i, "G-05 landed the reporting calendar"],
    [/no governed cost fact exists/i, "FIN-BLOCK-003A writes acquisition-cost facts"],
    [/not switched on for this environment/i, "inventory.balance.read is activated in platform-sandbox"],
    [/no role currently carries a finance visibility scope/i, "the FIN-004 reach finding was withdrawn"],
  ];
  for (const m of DASHBOARD_MODULES) {
    if (!m.blocker) continue;
    for (const [pattern, why] of disproven) {
      assert.ok(!pattern.test(m.blocker), `${m.key} cites a closed gap: ${why}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE CAPABILITY REQUEST SET -- the defect this file could not see.
//
// `hasCapability(id)` answers from `feed.decisions[id]`, and the effective-access feed only decides
// the ids it is ASKED for. An id absent from REPORT_CAPABILITY_REQUEST comes back `undefined`,
// which is `false`, for every principal, forever -- including one who genuinely holds it.
//
// Six of this table's ids were absent. `myOpportunities`, `myBooked`, `ordersRequiringAction`,
// `firmBilled`, `firmCollected`, `firmBooked` and `governedStockPosition` could therefore not
// resolve for ANYONE, and `accountPortfolio` survived only through a legacy operations-viewer path.
// Every test in this file passed throughout, because they all supply their own `hasCapability` and
// so never observe the request set at all. Caught by signing in as a governed persona and reading
// the feed's own response.
//
// This is the guard that closes that gap: the two lists must agree.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { REPORT_CAPABILITY_REQUEST } from "../src/access/reportCapabilityAccess.js";
import { readFileSync as readSrc } from "node:fs";

/** Every capability id the composition table actually gates a module on. */
function capabilityIdsUsedByComposition() {
  const src = readSrc(new URL("../src/domain/dashboardComposition.js", import.meta.url), "utf8")
    // Comments first: this file DISCUSSES capability ids it does not gate on, and a guard that reads
    // its own prose is a guard that reports ids nobody asks for.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const ids = new Set();
  for (const m of src.matchAll(/has\(ctx,\s*"([^"]+)"\)/g)) ids.add(m[1]);
  // FINANCE_REACH_SCOPES is a list, not a has(ctx, "...") call site.
  for (const m of src.matchAll(/"(finance\.visibility\.[a-zA-Z]+)"/g)) ids.add(m[1]);
  return [...ids].sort();
}

test("every capability the dashboard gates on is one the access feed is ASKED to decide", () => {
  const used = capabilityIdsUsedByComposition();
  assert.ok(used.length >= 10, "the extractor found suspiciously few ids -- has the call shape changed?");
  const requested = new Set(REPORT_CAPABILITY_REQUEST);
  const unasked = used.filter((id) => !requested.has(id));
  assert.deepEqual(
    unasked,
    [],
    `these gate a module but are never requested, so they deny for everyone forever:\n  ${unasked.join("\n  ")}`,
  );
});

test("the request set stays within the feed's input bound", () => {
  // effectiveAccessFeed.ts: MAX_PERMISSION_IDS = 100. Exceeding it fails the WHOLE request, which
  // would take every capability-gated module down with it rather than just the new one.
  assert.ok(REPORT_CAPABILITY_REQUEST.length <= 100, `${REPORT_CAPABILITY_REQUEST.length} ids exceeds the feed's bound`);
  assert.equal(new Set(REPORT_CAPABILITY_REQUEST).size, REPORT_CAPABILITY_REQUEST.length, "duplicate ids");
});

test("FIN-004: money needs REACH, not just the fact-family gate", () => {
  // `finance.read` alone confers no reach -- listFinancialFacts refuses a principal holding no
  // finance.visibility.* scope. Gating on it alone composed a Billed tile that could only ever say
  // "could not be read".
  const familyOnly = { role: "user", employeeId: "e", warehouseIds: [], operationalRoles: [], hasCapability: (id) => id === "finance.read" };
  const withReach = { ...familyOnly, hasCapability: (id) => id === "finance.read" || id === "finance.visibility.self" };
  for (const m of ["firmBilled", "firmCollected", "firmBooked"]) {
    assert.ok(!resolvedModuleKeys(familyOnly).includes(m), `${m} composed on the family gate alone`);
    assert.ok(resolvedModuleKeys(withReach).includes(m), `${m} did not compose for a principal with real reach`);
  }
  // A reach scope WITHOUT the family gate grants nothing either -- both halves, or neither.
  const scopeOnly = { ...familyOnly, hasCapability: (id) => id === "finance.visibility.consolidated" };
  assert.ok(!resolvedModuleKeys(scopeOnly).includes("firmBilled"), "a scope alone composed the money module");
});

test("a capability-governed CALLABLE is never gated on the legacy operations-viewer role", () => {
  // getAccountPortfolioSummary resolves customer.record.read; listReceivablePurchaseOrders resolves
  // inventory.stock.receive. Neither honours a role bypass, so `|| isOperationsViewer(ctx)` widened
  // only the client and produced a permanent, load-time 403 behind a "could not be read" tile.
  const bareDispatcher = { role: "dispatcher", employeeId: "e", warehouseIds: [], operationalRoles: [], hasCapability: () => false };
  const keys = resolvedModuleKeys(bareDispatcher);
  assert.ok(!keys.includes("accountPortfolio"), "accountPortfolio follows the bare title again");
  assert.ok(!keys.includes("receivingQueue"), "receivingQueue follows the bare title again");
  // The genuinely Rules-role-governed Firestore reads DO still compose -- this is a narrowing of one
  // specific wrong disjunct, not a removal of the legacy surface.
  assert.ok(keys.includes("serviceAttention") && keys.includes("reorderQueue"));
});

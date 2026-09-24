// THE EOS DASHBOARD PROJECTION -- navigation blocker #5, proved rather than asserted.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS FOR
//
// Dashboard composition used to be authored from three Firebase-era inputs: `users/{uid}.role`
// (admin | dispatcher | technician), `employees/{id}.operationalRoles`, and the
// `resolveEffectiveAccess` capability feed. The first two are business-role METADATA -- the exact
// authority the EOS cutover exists to retire.
//
// domain/dashboardComposition.js now takes its facts from the EOS Principal experience context
// (POST /operations/experience -> functions/src/eosOps/experienceAuthority.ts) whenever one is
// present, and from the legacy inputs when it is not. EOS_NAVIGATION_AUTHORITY_READY is false in
// every environment, so the legacy branch is what actually runs today and the suites that pin it
// (dashboardComposition / dashboardRoleMatrix / dashboardDesignConformance) are unchanged.
//
// THE PROOF THAT MATTERS is the one below headed FIREBASE INDEPENDENCE: with the EOS projection
// active, swinging `role` through every legacy value including junk, filling `operationalRoles`
// with every legacy value, supplying a technician binding, a warehouse list and an
// always-true `hasCapability` must not move the composition by a single module. If any of that
// still changes what a dashboard is made of, the source was never really swapped.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT IS DELIBERATELY *NOT* PROVED HERE
//
// This file does not assert that everyone can see everything. Much of this platform is not cut over,
// and several modules have NO governed equivalent at all -- see EOS_DASHBOARD_PROJECTION_GAPS, which
// this file pins. A persona matrix in which every row is fully available would be a wrong answer,
// not a good one.
//
// Run: node --test test/dashboardEosProjection.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_MODULES,
  DASHBOARD_SURFACE,
  EOS_CAPABILITY_SURFACE,
  EOS_DASHBOARD_PROJECTION_GAPS,
  MODULE_STATE,
  composeDashboard,
  dashboardSurfaceFor,
  goalTargetsFor,
  resolvedModuleKeys,
} from "../src/domain/dashboardComposition.js";
import {
  EXPERIENCE_STATE,
  EXPERIENCE_SURFACE_KEYS,
  buildNavigationAuthority,
  experienceContextFrom,
} from "../src/access/experienceContext.js";

// ───────────────────────────────────────────────────────────────────────────────────────────────
// FIXTURES
//
// Authorities are built through the REAL projector (`experienceContextFrom` ->
// `buildNavigationAuthority`), never hand-rolled as `{ grants: () => true }`. A hand-rolled double
// would pass even if the production projection stopped dropping unknown surface keys or stopped
// failing closed outside READY, which are the two properties this whole lane rests on.
// ───────────────────────────────────────────────────────────────────────────────────────────────

function eosAuthority({
  surfaces = [],
  employeeId = "emp-eos-1",
  workEligibility = [],
  operationalScopes = [],
  securityRoleKeys = [],
  state = EXPERIENCE_STATE.READY,
} = {}) {
  const context = experienceContextFrom({
    tenantId: "tenant-taylor",
    principalId: "prin-eos-1",
    securityRoleKeys,
    employeeId,
    workEligibility,
    operationalScopes,
    surfaces,
  });
  assert.ok(context, "the fixture is not a payload the production projector can read");
  return buildNavigationAuthority({ state, context });
}

/** A context carrying ONLY the EOS source. Every legacy field is deliberately absent. */
const eosCtx = (authorityOptions) => ({ eosNavigationAuthority: eosAuthority(authorityOptions) });

const WAREHOUSE_SCOPE = (scopeId) => ({ scopeType: "WAREHOUSE", scopeId });

const keysOf = (ctx) => resolvedModuleKeys(ctx).slice().sort();

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AL5 -- FIREBASE INDEPENDENCE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Every value `users/{uid}.role` has ever held here, plus the shapes a broken read produces. */
const LEGACY_ROLE_SWING = ["admin", "dispatcher", "technician", null, undefined, "", "owner", "{{junk}}", 7, {}];

/** Every value this repository puts in `employees/{id}.operationalRoles`, and then all of them at once. */
const LEGACY_OPERATIONAL_ROLES = [
  "PARTS_ASSOCIATE",
  "PARTS_MANAGER",
  "WAREHOUSE_ASSOCIATE",
  "WAREHOUSE_MANAGER",
];
const LEGACY_OPERATIONAL_ROLE_SWING = [
  [],
  null,
  undefined,
  ["PARTS_ASSOCIATE"],
  ["WAREHOUSE_MANAGER"],
  LEGACY_OPERATIONAL_ROLES,
  [...LEGACY_OPERATIONAL_ROLES, "SERVICE_TECHNICIAN", "DRIVER", "{{junk}}"],
];

/** The third Firebase-era input: the `resolveEffectiveAccess` feed. Grant-everything is the risk case. */
const LEGACY_CAPABILITY_SWING = [undefined, () => false, () => true, (id) => id.startsWith("finance.")];

const LEGACY_BINDING_SWING = [
  { technicianId: null, warehouseIds: [], employeeId: null },
  { technicianId: "tech-legacy-1", warehouseIds: ["wh-legacy-a", "wh-legacy-b"], employeeId: "emp-legacy-9" },
];

/**
 * The EOS principals whose composition must survive the sweep.
 *
 * Deliberately spread across the shape of the projection: a rich one, a bare one, one that is only
 * scope, and one whose EOS read FAILED (the case where a fallback would be invisible and fatal).
 */
const SWEPT_PRINCIPALS = {
  operationsAndCommerce: {
    surfaces: [
      "service.workOrders",
      "service.dispatch",
      "service.coordinatedVisits",
      "crm.accounts",
      "commercial.opportunities",
      "commercial.salesOrders",
      "receiving.checkIn",
    ],
    operationalScopes: [WAREHOUSE_SCOPE("wh-eos-north")],
  },
  warehouseOnly: {
    surfaces: ["warehouse.picking", "inventory.cycleCount.count"],
    workEligibility: ["WAREHOUSE_OPERATIONS"],
    operationalScopes: [WAREHOUSE_SCOPE("wh-eos-main")],
  },
  fieldOnly: {
    surfaces: ["field.myWorkOrders"],
    workEligibility: ["SERVICE_TECHNICIAN"],
  },
  holdsNothing: { surfaces: [], employeeId: null },
  readFailed: { surfaces: ["service.workOrders", "crm.accounts"], state: EXPERIENCE_STATE.UNAVAILABLE },
  stillLoading: { surfaces: ["service.workOrders", "crm.accounts"], state: EXPERIENCE_STATE.LOADING },
};

test("AL5: with the EOS projection active, no Firebase role/operationalRoles/capability input moves the composition", () => {
  let combinations = 0;
  for (const [name, options] of Object.entries(SWEPT_PRINCIPALS)) {
    // The baseline: the EOS source and NOTHING else. Every legacy field is absent.
    const baseline = composeDashboard(eosCtx(options));
    const baselineTargets = goalTargetsFor(eosCtx(options));

    for (const role of LEGACY_ROLE_SWING) {
      for (const operationalRoles of LEGACY_OPERATIONAL_ROLE_SWING) {
        for (const hasCapability of LEGACY_CAPABILITY_SWING) {
          for (const binding of LEGACY_BINDING_SWING) {
            combinations += 1;
            const contaminated = {
              ...eosCtx(options),
              role,
              operationalRoles,
              hasCapability,
              ...binding,
            };
            assert.deepEqual(
              composeDashboard(contaminated),
              baseline,
              `${name}: composition moved for role=${JSON.stringify(role)} ` +
                `operationalRoles=${JSON.stringify(operationalRoles)} binding=${JSON.stringify(binding)}`,
            );
            assert.deepEqual(
              goalTargetsFor(contaminated),
              baselineTargets,
              `${name}: goal targets moved for role=${JSON.stringify(role)}`,
            );
          }
        }
      }
    }
  }
  // A sweep that silently stopped iterating would pass vacuously.
  assert.equal(combinations, Object.keys(SWEPT_PRINCIPALS).length * 10 * 7 * 4 * 2);
  assert.ok(combinations >= 3000, `only ${combinations} combinations were swept`);
});

test("AL5: a FAILED EOS read composes nothing -- it never degrades to the legacy role", () => {
  // This is the defect that would be invisible in production: the governed read breaks, the legacy
  // role quietly answers instead, everything keeps working, and nobody learns the cutover is broken.
  for (const state of [EXPERIENCE_STATE.UNAVAILABLE, EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED]) {
    const ctx = {
      eosNavigationAuthority: eosAuthority({ surfaces: ["service.workOrders", "crm.accounts"], state }),
      // A maximally-privileged legacy context. If ANY of it leaks, this list is non-empty.
      role: "admin",
      employeeId: "emp-legacy-9",
      technicianId: "tech-legacy-1",
      operationalRoles: LEGACY_OPERATIONAL_ROLES,
      warehouseIds: ["wh-legacy-a"],
      hasCapability: () => true,
    };
    assert.deepEqual(keysOf(ctx), [], `${state} composed something`);
    assert.deepEqual(goalTargetsFor(ctx), [], `${state} asked for goal targets`);
  }
});

test("AL5: a junk authority is NOT an authority -- it falls to the legacy source rather than granting", () => {
  // isNavigationAuthority is the only thing standing between "the EOS source is on" and a value that
  // merely looks like it. A half-built or forged object must not be treated as the governed source
  // -- and must not be treated as a grant either.
  for (const junk of [{}, null, undefined, { grants: () => true }, { source: "EOS" }, "EOS", 0]) {
    const ctx = { eosNavigationAuthority: junk, role: "dispatcher", employeeId: "emp-1", operationalRoles: [], warehouseIds: [], hasCapability: () => false };
    const keys = keysOf(ctx);
    // The legacy dispatcher composition, unchanged -- NOT an EOS grant of everything.
    assert.ok(keys.includes("serviceAttention"), `${JSON.stringify(junk)} lost the legacy path`);
    assert.ok(!keys.includes("accountPortfolio"), `${JSON.stringify(junk)} was treated as a grant`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AL2 -- THE PROJECTION IS GOVERNED FACTS, AND IT NEVER WIDENS
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("AL2: every capability the projection maps is mapped to a surface that actually exists", () => {
  for (const [capability, surfaceKey] of Object.entries(EOS_CAPABILITY_SURFACE)) {
    assert.ok(
      EXPERIENCE_SURFACE_KEYS.includes(surfaceKey),
      `${capability} -> ${surfaceKey}, which is not a surface the server can ever grant`,
    );
    assert.ok(capability.includes("."), `${capability} is not a capability key`);
  }
});

test("AL2: the capability -> surface map is INJECTIVE -- two capabilities never share one surface", () => {
  // Two capabilities behind one surface would mean holding either grants both, which is the widening
  // the map exists to prevent: it would stop being a translation and become a new permission.
  const surfaces = Object.values(EOS_CAPABILITY_SURFACE);
  assert.equal(new Set(surfaces).size, surfaces.length, `duplicate surface in the map: ${surfaces.join(", ")}`);
});

test("AL2: a grant of the mapped surface is exactly what turns each capability-gated module on", () => {
  const expected = {
    "crm.accounts": "accountPortfolio",
    "commercial.opportunities": "myOpportunities",
    "service.coordinatedVisits": "ordersRequiringAction",
    "receiving.checkIn": "receivingQueue",
  };
  for (const [surfaceKey, moduleKey] of Object.entries(expected)) {
    assert.ok(keysOf(eosCtx({ surfaces: [surfaceKey] })).includes(moduleKey), `${surfaceKey} did not compose ${moduleKey}`);
    assert.ok(
      !keysOf(eosCtx({ surfaces: [] })).includes(moduleKey),
      `${moduleKey} composed for a principal holding nothing`,
    );
  }
});

test("AL2: a module with NO governed equivalent is ABSENT under EOS, and the reason is declared", () => {
  const moduleKeys = new Set(DASHBOARD_MODULES.map((m) => m.key));
  assert.ok(EOS_DASHBOARD_PROJECTION_GAPS.length > 0, "the gap list is empty, which would mean nothing was lost");
  for (const gap of EOS_DASHBOARD_PROJECTION_GAPS) {
    assert.ok(moduleKeys.has(gap.key), `${gap.key} is not a real module`);
    assert.ok(
      typeof gap.reason === "string" && gap.reason.length > 60,
      `${gap.key} has no usable reason -- "no equivalent" tells a reader nothing`,
    );
  }
  // An EOS principal holding EVERY surface the server can grant still sees none of them.
  const everything = eosCtx({
    surfaces: EXPERIENCE_SURFACE_KEYS,
    workEligibility: ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"],
    operationalScopes: [WAREHOUSE_SCOPE("wh-eos-main")],
  });
  const composed = new Set(keysOf(everything));
  for (const gap of EOS_DASHBOARD_PROJECTION_GAPS) {
    assert.ok(!composed.has(gap.key), `${gap.key} is declared unprojectable but composed anyway`);
  }
});

test("AL2: financial reach has no surface, so the money modules are absent rather than approximated", () => {
  // financials.invoices is earned by finance.invoice.read -- permission to open ONE invoice. Mapping
  // firm Billed/Collected onto it would hand the firm's figures to anyone who may read an invoice.
  const invoiceReader = eosCtx({ surfaces: ["financials.invoices", "financials.payments"] });
  for (const moduleKey of ["firmBilled", "firmCollected", "firmBooked"]) {
    assert.ok(!keysOf(invoiceReader).includes(moduleKey), `${moduleKey} was approximated onto an invoice grant`);
  }
});

test("AL2: scope and Employee identity come from the EOS context, not from the legacy lists", () => {
  const scoped = eosCtx({ employeeId: "emp-eos-42", operationalScopes: [WAREHOUSE_SCOPE("wh-eos-7"), { scopeType: "REORDER_QUEUE", scopeId: "q-1" }] });
  const keys = keysOf(scoped);
  assert.ok(keys.includes("myGoals"), "the EOS linked Employee did not supply the goal module");
  assert.ok(keys.includes("teamGoals"), "the EOS WAREHOUSE scope did not supply an area");
  // A REORDER_QUEUE scope is NOT by itself the reorder authority -- the server decides that when it
  // evaluates reorder.request.read against the scope and grants `inventory.reorderQueue` or does not.
  // The client reads the decision, never re-derives it from the scope row.
  assert.ok(!keys.includes("reorderQueue"), "a bare scope row was treated as the reorder authority");
  assert.ok(
    keysOf(eosCtx({ surfaces: ["inventory.reorderQueue"] })).includes("reorderQueue"),
    "the governed reorder-queue surface did not supply the module",
  );

  const targets = goalTargetsFor(scoped);
  // LOCATION targets are the EOS WAREHOUSE scope ids -- and ONLY those. A REORDER_QUEUE scope is not
  // a location, so it must not become one.
  const locationIds = targets.filter((t) => t.targetScopeType === "LOCATION").map((t) => t.targetScopeId);
  assert.deepEqual([...new Set(locationIds)], ["wh-eos-7"]);

  // A principal with a linked Employee of null gets no goal module -- not the Firestore employeeId.
  const unlinked = { ...eosCtx({ employeeId: null }), employeeId: "emp-legacy-9" };
  assert.ok(!keysOf(unlinked).includes("myGoals"), "the legacy employeeId leaked through an unlinked principal");
});

test("AL2: the operations composition follows DISPATCH authority, and service.workOrders does NOT widen into it", () => {
  const OPERATIONS_MODULES = ["serviceAttention", "workOrdersByStatus", "technicianComparison", "technicianAvailability"];

  // `service.dispatch` is the one surface that means "you direct other people's work": it is earned
  // by workOrder.lifecycle.dispatch alone.
  const dispatchKeys = keysOf(eosCtx({ surfaces: ["service.dispatch"] }));
  for (const moduleKey of OPERATIONS_MODULES) {
    assert.ok(dispatchKeys.includes(moduleKey), `service.dispatch did not supply ${moduleKey}`);
  }

  // THE NO-WIDENING PROOF, and the reason this lane did not take the obvious mapping.
  // `service.workOrders` is earned by workOrder.create OR workOrder.transition, and `partsAssociate`
  // holds both (functions/src/access/governedBusinessRoles.ts:871-872). If it conferred the
  // operations composition, a parts associate would get a team-wide view of everyone's work orders
  // -- something no legacy role ever gave them.
  const workOrdersKeys = keysOf(eosCtx({ surfaces: ["service.workOrders"] }));
  for (const moduleKey of OPERATIONS_MODULES) {
    assert.ok(!workOrdersKeys.includes(moduleKey), `service.workOrders widened into ${moduleKey}`);
  }

  // Coordinated Visits is one commercial read and must not confer the service composition either.
  const visitsOnly = keysOf(eosCtx({ surfaces: ["service.coordinatedVisits"] }));
  for (const moduleKey of OPERATIONS_MODULES) {
    assert.ok(!visitsOnly.includes(moduleKey), `service.coordinatedVisits widened into ${moduleKey}`);
  }
});

test("AL2: the dispatch authority nobody holds is a NAMED grant blocker, not a silent empty screen", () => {
  // MEASURED: workOrder.lifecycle.dispatch is declared by no role in functions/src/access/ and is
  // inserted by no migration -- migration 1761609600000:43 says it "stays at ZERO". So today every
  // persona composes the projection below WITHOUT the four operations modules, and the fix is a
  // capability grant by whoever owns Service authority, not a change to this file.
  //
  // This test exists so that the day dispatch IS granted, the four modules light up by themselves
  // and nothing here has to be edited -- and so that nobody "fixes" the empty screen by widening.
  const grantedTomorrow = keysOf(eosCtx({ surfaces: ["service.dispatch"] }));
  assert.deepEqual(
    grantedTomorrow.filter((k) => ["serviceAttention", "workOrdersByStatus", "technicianComparison", "technicianAvailability", "teamGoals", "stockForecast", "costImpact"].includes(k)).sort(),
    ["costImpact", "serviceAttention", "stockForecast", "teamGoals", "technicianAvailability", "technicianComparison", "workOrdersByStatus"],
  );
});

test("AL2: the handheld queue follows the handheld surfaces, not the four operationalRoles literals", () => {
  for (const surfaceKey of ["warehouse.picking", "receiving.checkIn", "inventory.cycleCount.count"]) {
    assert.ok(
      keysOf(eosCtx({ surfaces: [surfaceKey] })).includes("unverifiedSubmissions"),
      `${surfaceKey} did not supply the device-local queue`,
    );
  }
  assert.ok(
    !keysOf(eosCtx({ surfaces: ["crm.accounts"] })).includes("unverifiedSubmissions"),
    "a desk-only principal was offered a handheld queue",
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AL3 -- NORTH STAR PRESERVATION
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("AL3: the module table is untouched -- only WHO is offered a module changed, never WHAT it is", () => {
  // The per-surface North Star acceptance standards are written against these modules: their keys,
  // their sections, their labels and the state each resolves to. This lane changed the AUTHORITY
  // that selects them. If a module's identity or resolved state moved, that is a product change
  // wearing a cutover's clothes.
  const EXPECTED_STATE = {
    myAssignedWork: MODULE_STATE.SATISFIED_ELSEWHERE,
    unverifiedSubmissions: MODULE_STATE.READY,
    serviceAttention: MODULE_STATE.READY,
    reorderQueue: MODULE_STATE.READY,
    receivingQueue: MODULE_STATE.READY,
    adminDecisions: MODULE_STATE.READY,
    myOpportunities: MODULE_STATE.READY,
    ordersRequiringAction: MODULE_STATE.READY,
    myGoals: MODULE_STATE.READY,
    myPerformanceAllTime: MODULE_STATE.SATISFIED_ELSEWHERE,
    technicianQualityMetrics: MODULE_STATE.UNAVAILABLE,
    myBooked: MODULE_STATE.UNAVAILABLE,
    workOrdersByStatus: MODULE_STATE.READY,
    teamGoals: MODULE_STATE.READY,
    technicianComparison: MODULE_STATE.READY,
    stockForecast: MODULE_STATE.UNAVAILABLE,
    governedStockPosition: MODULE_STATE.GATED,
    technicianAvailability: MODULE_STATE.READY,
    accountPortfolio: MODULE_STATE.READY,
    firmBilled: MODULE_STATE.READY,
    firmCollected: MODULE_STATE.READY,
    firmBooked: MODULE_STATE.UNAVAILABLE,
    costImpact: MODULE_STATE.UNAVAILABLE,
  };
  assert.deepEqual(
    DASHBOARD_MODULES.map((m) => m.key).sort(),
    Object.keys(EXPECTED_STATE).sort(),
    "the module set changed -- this lane may only change who is offered an EXISTING surface",
  );
  for (const m of DASHBOARD_MODULES) {
    assert.equal(m.state({}), EXPECTED_STATE[m.key], `${m.key}'s resolved state changed`);
  }
});

test("AL3: a module's state is the same under EOS as under the legacy source", () => {
  // Same module, same state, different authority. Nothing about the EOS branch may re-decide what a
  // module IS -- a GATED tile does not become READY because the source changed, and the reverse
  // would make a working figure look blocked.
  const legacy = composeDashboard({
    role: "admin",
    employeeId: "emp-legacy",
    technicianId: null,
    operationalRoles: [],
    warehouseIds: ["wh-legacy"],
    hasCapability: (id) => ["customer.record.read", "opportunity.read", "inventory.stock.receive", "fulfillment.coordinatedVisit.read"].includes(id),
  });
  const eos = composeDashboard(eosCtx({
    surfaces: ["service.workOrders", "crm.accounts", "commercial.opportunities", "receiving.checkIn", "service.coordinatedVisits"],
    operationalScopes: [WAREHOUSE_SCOPE("wh-eos")],
  }));
  const stateByKey = (sections) => new Map(sections.flatMap((s) => s.modules.map((m) => [m.key, m.state])));
  const legacyStates = stateByKey(legacy);
  const eosStates = stateByKey(eos);
  for (const [key, state] of eosStates) {
    if (legacyStates.has(key)) assert.equal(state, legacyStates.get(key), `${key} resolved to a different state under EOS`);
  }
  // ...and sections still render in the file's fixed order, with empty sections omitted.
  for (const sections of [legacy, eos]) {
    assert.ok(sections.every((s) => s.modules.length > 0), "an empty section was rendered");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHICH DASHBOARD SURFACE -- the DashboardIndex rule
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("the technician surface is chosen by field-work eligibility and the ABSENCE of a management scope", () => {
  const surfaceFor = (surfaces, workEligibility = []) =>
    dashboardSurfaceFor({ operationalContext: { eosNavigationAuthority: eosAuthority({ surfaces, workEligibility }) } });

  assert.equal(surfaceFor(["field.myWorkOrders"], ["SERVICE_TECHNICIAN"]), DASHBOARD_SURFACE.FIELD_WORK);
  // Holding BOTH composes: the technician screen shows one person's own work and would hide the team's.
  assert.equal(surfaceFor(["field.myWorkOrders", "service.dispatch"], ["SERVICE_TECHNICIAN"]), DASHBOARD_SURFACE.COMPOSED);
  // ...but merely being able to raise or advance a work order is NOT a management scope, so it does
  // not take a technician off their own screen. Same measurement as the operations translation.
  assert.equal(surfaceFor(["field.myWorkOrders", "service.workOrders"], ["SERVICE_TECHNICIAN"]), DASHBOARD_SURFACE.FIELD_WORK);
  assert.equal(surfaceFor(["crm.accounts"]), DASHBOARD_SURFACE.COMPOSED);
  assert.equal(surfaceFor([]), DASHBOARD_SURFACE.COMPOSED);
});

test("a legacy role never reaches the technician surface once the EOS source is on", () => {
  // The whole point: `role === "technician"` stops meaning anything the moment an authority is present.
  const authority = eosAuthority({ surfaces: ["crm.accounts"] });
  assert.equal(
    dashboardSurfaceFor({ role: "technician", operationalContext: { eosNavigationAuthority: authority } }),
    DASHBOARD_SURFACE.COMPOSED,
  );
  // ...and a failed EOS read does not hand anyone the technician surface either.
  const failed = eosAuthority({ surfaces: ["field.myWorkOrders"], state: EXPERIENCE_STATE.UNAVAILABLE });
  assert.equal(
    dashboardSurfaceFor({ role: "technician", operationalContext: { eosNavigationAuthority: failed } }),
    DASHBOARD_SURFACE.COMPOSED,
  );
});

test("the composing surface never duplicates the technician read, under either source", () => {
  // MyDashboard passes `fieldWorkRenderedElsewhere`, which is NARROWING ONLY: it can remove these
  // three modules and can never add one. Under the legacy source the same effect came from
  // `technicianId: null`; both must hold, or a technician-and-dispatcher would see their own work
  // claimed to be "live on the technician screen" -- a screen the routing rule no longer sends them to.
  const FIELD_MODULES = ["myAssignedWork", "myPerformanceAllTime", "technicianQualityMetrics"];
  const myDashboardCtx = {
    ...eosCtx({ surfaces: ["field.myWorkOrders", "service.dispatch"], workEligibility: ["SERVICE_TECHNICIAN"] }),
    fieldWorkRenderedElsewhere: true,
  };
  for (const moduleKey of FIELD_MODULES) {
    assert.ok(!keysOf(myDashboardCtx).includes(moduleKey), `${moduleKey} was duplicated onto the composing surface`);
  }
  // Without the flag the same principal DOES resolve them -- so the flag is doing the work, and the
  // field-work fact is genuinely read from the granted surface rather than being unreachable.
  const withoutFlag = eosCtx({ surfaces: ["field.myWorkOrders", "service.dispatch"], workEligibility: ["SERVICE_TECHNICIAN"] });
  for (const moduleKey of FIELD_MODULES) {
    assert.ok(keysOf(withoutFlag).includes(moduleKey), `${moduleKey} is unreachable under EOS`);
  }
  // The flag can only ever REMOVE. Setting it on a principal who holds no field work adds nothing.
  assert.deepEqual(
    keysOf({ ...eosCtx({ surfaces: ["crm.accounts"] }), fieldWorkRenderedElsewhere: false }),
    keysOf(eosCtx({ surfaces: ["crm.accounts"] })),
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AL4 -- THE PERSONA MATRIX
//
// Each persona is described by the SURFACES its governed capabilities earn, never by a name. The
// `blocked` list on each row is the honest half: modules that persona's North Star would expect and
// which this platform cannot govern for them today.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * MEASURED, NOT IMAGINED. Every `surfaces` list below is derived from the role's REAL declared
 * capability set (functions/src/access/governedBusinessRoles.ts and compatibilityRoles.ts, plus the
 * role_capabilities rows migration 1761609600000 inserts) evaluated against the surface catalog in
 * functions/src/eosOps/experienceAuthority.ts.
 *
 * TWO MEASUREMENTS DOMINATE THIS TABLE AND BOTH ARE CUTOVER BLOCKERS, NOT OMISSIONS:
 *
 *  1. eos_workforce.employee_work_eligibility and employee_operational_scopes hold ZERO rows in
 *     nonprod (functions/scripts/fixtures/personaAuthorityDimensions.v1.json:14 states and measures
 *     this; the dimensions file that would populate them is referenced by nothing but its own test).
 *     Every surface carrying a WORK_ELIGIBILITY or OPERATIONAL_SCOPE predicate is therefore
 *     unreachable by ANYONE today: field.myWorkOrders, warehouse.picking, warehouse.management,
 *     inventory.cycleCount.count and inventory.cycleCount.review.
 *
 *  2. workOrder.lifecycle.dispatch is granted to no role at all, so `service.dispatch` is held by
 *     nobody and the four team-wide service modules reach nobody.
 *
 * The visible consequence is stated plainly in the rows: a TECHNICIAN composes a dashboard of one
 * module, and no persona composes a service or warehouse module. A matrix that hid that by widening
 * onto a near-enough grant would be a worse artifact than an empty one.
 */
const PERSONAS = {
  // `owner` the Role exists with an admin-identical capability set, but NO Principal holds it: the
  // owner-executive Principal holds `admin` (functions/scripts/fixtures/sampleCompany.v2.json:657).
  // So Owner and Admin are the same measured row, and it is recorded once under each name.
  owner: {
    role: "admin (the owner-executive Principal holds admin, not owner)",
    surfaces: ["service.workOrders", "service.coordinatedVisits", "crm.accounts", "commercial.opportunities", "commercial.salesOrders", "inventory.catalog", "inventory.catalogAdmin", "inventory.balances", "inventory.transfers", "inventory.reorderQueue", "receiving.checkIn", "purchasing.purchaseOrders", "equipment.register", "financials.invoices", "financials.payments", "administration.users", "administration.dataImport", "administration.auditLogs"],
    expect: ["unverifiedSubmissions", "reorderQueue", "receivingQueue", "myOpportunities", "ordersRequiringAction", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["serviceAttention", "workOrdersByStatus", "technicianComparison", "technicianAvailability", "teamGoals", "stockForecast", "costImpact", "adminDecisions", "governedStockPosition", "firmBilled", "firmCollected", "firmBooked", "myAssignedWork"],
  },
  admin: {
    role: "admin",
    surfaces: ["service.workOrders", "service.coordinatedVisits", "crm.accounts", "commercial.opportunities", "commercial.salesOrders", "inventory.catalog", "inventory.catalogAdmin", "inventory.balances", "inventory.transfers", "inventory.reorderQueue", "receiving.checkIn", "purchasing.purchaseOrders", "equipment.register", "financials.invoices", "financials.payments", "administration.users", "administration.dataImport", "administration.auditLogs"],
    expect: ["unverifiedSubmissions", "reorderQueue", "receivingQueue", "myOpportunities", "ordersRequiringAction", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["serviceAttention", "workOrdersByStatus", "technicianComparison", "technicianAvailability", "adminDecisions", "firmBilled", "firmCollected", "firmBooked"],
  },
  // The compatibility `dispatcher` Role holds workOrder.{cancel,create,transition} -- and NOT
  // workOrder.lifecycle.dispatch. The persona the legacy literal was named after is therefore one of
  // the personas that loses the operations composition under EOS.
  dispatcher: {
    role: "dispatcher",
    surfaces: ["service.workOrders", "service.coordinatedVisits", "crm.accounts", "commercial.opportunities", "commercial.salesOrders", "inventory.balances", "inventory.catalog", "inventory.reorderQueue", "inventory.transfers", "receiving.checkIn", "purchasing.purchaseOrders"],
    expect: ["unverifiedSubmissions", "reorderQueue", "receivingQueue", "myOpportunities", "ordersRequiringAction", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["serviceAttention", "workOrdersByStatus", "technicianComparison", "technicianAvailability", "teamGoals", "stockForecast", "costImpact", "adminDecisions"],
  },
  // THE STARKEST ROW. `technician` holds 8 capabilities; workOrder.transition earns
  // `service.workOrders`, which this projection deliberately does not read. `field.myWorkOrders`
  // needs WORK_ELIGIBILITY(SERVICE_TECHNICIAN) and there are no eligibility rows, so a technician's
  // OWN work, own record and own quality slots are all unreachable and one goal module is the whole
  // dashboard. Seeding employee_work_eligibility is what closes this, not a client change.
  technician: {
    role: "technician",
    surfaces: ["service.workOrders", "purchasing.purchaseOrders"],
    expect: ["myGoals"],
    blocked: ["myAssignedWork", "myPerformanceAllTime", "technicianQualityMetrics", "unverifiedSubmissions", "serviceAttention", "reorderQueue"],
  },
  partsAssociate: {
    role: "partsAssociate (+ inventoryReceivingClerk on the same Principal)",
    surfaces: ["service.workOrders", "crm.accounts", "commercial.salesOrders", "inventory.balances", "inventory.catalog"],
    expect: ["myGoals", "myBooked", "accountPortfolio"],
    blocked: ["unverifiedSubmissions", "reorderQueue", "receivingQueue", "teamGoals", "stockForecast", "costImpact", "governedStockPosition"],
  },
  partsManager: {
    role: "partsManager (+ purchasingManager on the same Principal)",
    surfaces: ["service.workOrders", "crm.accounts", "commercial.salesOrders", "inventory.balances", "inventory.catalog", "inventory.catalogAdmin", "inventory.reorderQueue", "administration.auditLogs"],
    expect: ["reorderQueue", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["unverifiedSubmissions", "receivingQueue", "teamGoals", "stockForecast", "costImpact", "governedStockPosition", "adminDecisions"],
  },
  // RETAIL SALES AND NATIONAL ACCOUNTS ARE THE SAME SECURITY ROLE. RETAIL_SALES and
  // NATIONAL_ACCOUNTS_SALES are JOB Roles (sampleCompany.v2.json:55-104), a different dimension, and
  // both map to the `salesperson` Security Role. The projection cannot tell them apart, and the
  // national-accounts North Star's own surface has no capability either
  // (EXPERIENCE_SURFACE_GAPS "commercial.salesAgreements": no salesAgreement.* capability is
  // registered). Two rows, identical by measurement, recorded as such.
  retailSales: {
    role: "salesperson (Job Role RETAIL_SALES)",
    surfaces: ["crm.accounts", "commercial.opportunities", "commercial.salesOrders", "inventory.balances", "inventory.catalog"],
    expect: ["myOpportunities", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["ordersRequiringAction", "firmBooked", "firmBilled", "firmCollected", "serviceAttention"],
  },
  nationalAccountsSales: {
    role: "salesperson (Job Role NATIONAL_ACCOUNTS_SALES -- identical Security Role)",
    surfaces: ["crm.accounts", "commercial.opportunities", "commercial.salesOrders", "inventory.balances", "inventory.catalog"],
    expect: ["myOpportunities", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["ordersRequiringAction", "firmBooked", "firmBilled", "firmCollected", "serviceAttention"],
  },
  // NO PRINCIPAL HOLDS THIS ROLE. `financeManager` and `accountingManager` are declared with
  // byte-identical capability sets, and sampleCompany.v2.json assigns neither to anybody. The row is
  // the capability set they WOULD have, and it composes no money module: finance.visibility.* earns
  // no surface, and finance.invoice.read / finance.payment.read are permission to open a document.
  financeAccounting: {
    role: "financeManager / accountingManager -- DEFINED, HELD BY NOBODY",
    surfaces: ["crm.accounts", "commercial.opportunities", "commercial.salesOrders", "inventory.balances", "inventory.catalog", "inventory.transfers", "purchasing.purchaseOrders", "administration.auditLogs", "financials.invoices", "financials.payments"],
    expect: ["myOpportunities", "myGoals", "myBooked", "accountPortfolio"],
    blocked: ["firmBilled", "firmCollected", "firmBooked", "costImpact", "governedStockPosition"],
  },
  // ALSO HELD BY NOBODY -- and worse: every one of reportViewer's 27 capabilities is a `report.*` id,
  // and no `report.*` capability earns ANY surface in the experience catalog. A reporting principal
  // projects to the empty surface set, so its dashboard is its Employee identity and nothing else.
  reportingReadOnly: {
    role: "reportViewer / reportFinanceViewer / reportAuthor -- DEFINED, HELD BY NOBODY",
    surfaces: [],
    expect: ["myGoals"],
    blocked: ["workOrdersByStatus", "technicianComparison", "firmBilled", "accountPortfolio", "governedStockPosition", "myOpportunities"],
  },
};

test("AL4: the persona matrix composes exactly what each persona's governed surfaces earn", () => {
  for (const [persona, row] of Object.entries(PERSONAS)) {
    const keys = new Set(keysOf(eosCtx(row)));
    for (const moduleKey of row.expect) {
      assert.ok(keys.has(moduleKey), `${persona}: expected ${moduleKey} and it is absent`);
    }
    for (const moduleKey of row.blocked) {
      assert.ok(!keys.has(moduleKey), `${persona}: ${moduleKey} is recorded as blocked but composed`);
    }
    // The expectation is EXHAUSTIVE: a module that starts composing for a persona and is in neither
    // list is a silent widening, which is exactly what a matrix is supposed to catch.
    assert.deepEqual(
      [...keys].sort(),
      [...row.expect].sort(),
      `${persona}: composition drifted from the recorded matrix row`,
    );
  }
});

test("AL4: the matrix is HONEST -- no persona is fully available, and the money modules reach nobody", () => {
  // A matrix in which everything is available would mean the projection had invented reach. Most of
  // this platform is deliberately not cut over, and the matrix has to keep saying so.
  const everyModule = DASHBOARD_MODULES.map((m) => m.key);
  for (const [persona, row] of Object.entries(PERSONAS)) {
    assert.ok(row.blocked.length > 0, `${persona} records no blocked module, which cannot be right`);
    assert.ok(
      row.expect.length < everyModule.length,
      `${persona} is recorded as seeing every module`,
    );
  }
  // Billed / Collected / Booked compose for NO persona in the matrix, because financial reach has no
  // surface. If that ever changes it must change here first, deliberately.
  for (const [persona, row] of Object.entries(PERSONAS)) {
    for (const moneyModule of ["firmBilled", "firmCollected", "firmBooked"]) {
      assert.ok(!row.expect.includes(moneyModule), `${persona} expects ${moneyModule}, which no surface can earn`);
    }
  }
});

test("AL4: a persona holding NO surface is composed down to its Employee identity, and no further", () => {
  // REFUSED is an ANSWER: this principal holds nothing. It is not an error state and it is not a
  // reason to show a launcher. `myGoals` survives only because a linked Employee is itself a
  // governed fact, and the module's own NO_GOAL state is what says nobody has set one.
  assert.deepEqual(keysOf(eosCtx({ surfaces: [], employeeId: "emp-eos-1" })), ["myGoals"]);
  assert.deepEqual(keysOf(eosCtx({ surfaces: [], employeeId: null })), []);
});

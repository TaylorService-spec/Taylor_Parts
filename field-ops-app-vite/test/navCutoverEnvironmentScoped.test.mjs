// WAVE 16 / LANE BR -- THE NAVIGATION CUTOVER IS PER ENVIRONMENT, AND THIS IS THE EVIDENCE.
//
// Pure and offline: no React, no network, no emulator, no database. Everything asserted here is a
// property of navConfig.js, access/experienceContext.js and config/environments.json, read as data.
//
// ════════════════════════════════ WHAT THIS FILE IS FOR ════════════════════════════════
//
// Lane BQ performed the EOS navigation cutover correctly AND deleted the twenty legacy placeholder
// rows that had earned a governed surface, globally, taking NAV_LEGACY_PLACEHOLDER_DESTINATIONS from
// 62 to 42. It measured and reported the consequence honestly: in the FOUR environments where
// `EOS_NAVIGATION_AUTHORITY_READY` is false -- local-emulator, platform-certification,
// platform-integration and taylor-parts-production -- admin went 75 -> 54 and dispatcher 72 -> 51,
// twenty-one destinations each, because a placeholder row was the only thing that made them visible
// and there is no EOS source in those environments to replace it. `taylor-parts-production` declares
// `eosApi: null`: there is not even an address to ask.
//
// THE OWNER RULED THAT MUST NOT HAPPEN. The cutover is an ENVIRONMENT CUTOVER, not a global source
// deletion, and the two halves of the ruling are:
//
//   FLAG TRUE   EOS effective capability / experience authority ONLY. The twenty rows are ABSENT
//               from the effective register. No `users/{uid}.role` fallback, no Firebase
//               custom-claim fallback, no admin/dispatcher/technician placeholder fallback. An EOS
//               resolution failure FAILS CLOSED.
//   FLAG FALSE  Existing legacy navigation behaviour is preserved, including the rows that path
//               needs. Production navigation is NOT narrowed and NO `eosApi` is required.
//
// The test names below are grouped under those two headings plus the ratchet, and every production
// claim is a DELTA AGAINST origin/main at b6a36b15 measured with identical inputs -- the pinned sets
// at the top of this file, not a count that happens to look reasonable.
//
// It is NOT registered in package.json by this lane -- see the lane report's
// SUITES_ADDED_NEEDING_REGISTRATION. `npm test` (scripts/runSuites.mjs) discovers test/*.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NAV_DOMAINS,
  NAV_SURFACE_ACCESS,
  NAV_LEGACY_PLACEHOLDER_DESTINATIONS,
  NAV_LEGACY_PLACEHOLDER_CEILING,
  NAV_CUTOVER_PLACEHOLDER_DESTINATIONS,
  NAV_CUTOVER_PLACEHOLDER_CEILING,
  NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS,
  NAV_UNGOVERNED_PLACEHOLDER_CEILING,
  NAV_GOVERNED_PLACEHOLDER_DESTINATIONS,
  PLACEHOLDER_DEFAULT_ROLES,
  effectivePlaceholderRegister,
  isDomainVisible,
  isEosNavigationSource,
  isNavItemVisible,
  legacyPlaceholderRegisterViolations,
  navigationSurfaceMapViolations,
} from "../src/navigation/navConfig.js";
import {
  EXPERIENCE_STATE,
  EXPERIENCE_SURFACE_KEYS,
  buildNavigationAuthority,
} from "../src/access/experienceContext.js";
import { ROLE_NAV_ACCESS, ROLES } from "../src/domain/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const destinations = () =>
  NAV_DOMAINS.flatMap((d) => (d.subnav ?? []).map((i) => [`${d.key}/${i.key}`, i]));
const itemAt = (destination) => destinations().find(([key]) => key === destination)?.[1];
const keysFor = (role) => ROLE_NAV_ACCESS[role] ?? [];

/** A session with NO EOS authority in the slot -- what every flag-false environment produces. */
const legacy = { operationalRoles: [], employmentStatus: "ACTIVE" };

const eosAuthority = (surfaces, state = EXPERIENCE_STATE.READY) => buildNavigationAuthority({
  state,
  context: state === EXPERIENCE_STATE.READY
    ? {
      tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces,
    }
    : null,
});
const eosContext = (authority, extra = {}) => ({ ...legacy, ...extra, eosNavigationAuthority: authority });

const visibleUnderLegacy = (role) => destinations()
  .filter(([, item]) => isNavItemVisible(item, role, keysFor(role), legacy))
  .map(([key]) => key);

// ════════════════ THE BASELINE: origin/main AT b6a36b15, MEASURED, NOT REMEMBERED ════════════════
//
// Produced by importing THAT commit's navConfig.js and domain/constants.js and running exactly the
// `visibleUnderLegacy` above over them -- the identical inputs, the identical predicate, the only
// difference being the tree. They are pinned as SETS rather than as counts on purpose: three numbers
// can coincide while the membership has churned underneath them, and "production navigation is not
// narrowed" is a claim about which doors exist, not about how many.
//
// THESE LISTS ARE NOT A TARGET TO EDIT. If a future lane legitimately changes what a legacy admin
// sees, it changes this constant in the same commit and says why -- which is the whole point of
// pinning it, because that edit is then a visible diff on a named baseline rather than a count
// quietly moving from 75 to 54.
const MAIN_B6A36B15_LEGACY_VISIBLE = Object.freeze({
  admin: Object.freeze([ // 75
    "dashboard/my", "dashboard/operationsDashboard", "dashboard/notifications",
    "customers/customers", "customers/opportunities", "customers/salesOrders",
    "serviceOperations/serviceOperations", "equipment/equipment", "service/workOrders",
    "service/jobAssignments", "service/dispatch", "service/coordinatedVisits",
    "service/coordinatedMission", "service/technicianWorkspace", "service/scan",
    "service/dispatcherBoard", "service/scheduling", "service/dispatchScheduling",
    "service/warranty", "inventory/parts", "inventory/partMaster", "inventory/manufacturers",
    "inventory/warehouses", "inventory/truckInventory", "inventory/transfers",
    "inventory/receiving", "inventory/cycleCounts", "inventory/backOrders",
    "purchasing/purchaseOrders", "purchasing/suppliers", "purchasing/quotes",
    "purchasing/receipts", "purchasing/demandPlanning", "financials/overview",
    "financials/billingQueue", "financials/invoices", "financials/accountsReceivable",
    "financials/payments", "financials/creditsAdjustments", "financials/customerFinancials",
    "financials/salesToGoal", "financials/costToBudget", "financials/forecasting",
    "financials/profitability", "financials/budgets", "financials/goals",
    "financials/companyPerformance", "financials/employeePerformance",
    "financials/reconciliation", "financials/intercompany", "financials/audit",
    "financials/reports", "financials/governance", "reporting/executive", "reporting/service",
    "reporting/inventory", "reporting/purchasing", "reporting/warehouse", "reporting/employees",
    "reporting/customers", "reporting/financial", "administration/overview",
    "administration/users", "administration/rolesPermissions", "administration/objects",
    "administration/workflows", "administration/permissionPreview", "administration/vehicles",
    "administration/regions", "administration/companySettings", "administration/duplicateRules",
    "administration/warehouseRacking", "administration/financialPolicy",
    "administration/integrations", "administration/auditLogs",
  ]),
  dispatcher: Object.freeze([ // 72
    "dashboard/my", "dashboard/operationsDashboard", "dashboard/notifications",
    "customers/customers", "customers/opportunities", "customers/salesOrders",
    "serviceOperations/serviceOperations", "equipment/equipment", "service/workOrders",
    "service/jobAssignments", "service/dispatch", "service/coordinatedVisits",
    "service/dispatcherBoard", "service/scheduling", "service/dispatchScheduling",
    "service/warranty", "inventory/parts", "inventory/partMaster", "inventory/manufacturers",
    "inventory/warehouses", "inventory/truckInventory", "inventory/transfers",
    "inventory/receiving", "inventory/cycleCounts", "inventory/backOrders",
    "purchasing/purchaseOrders", "purchasing/suppliers", "purchasing/quotes",
    "purchasing/receipts", "purchasing/demandPlanning", "financials/overview",
    "financials/billingQueue", "financials/invoices", "financials/accountsReceivable",
    "financials/payments", "financials/creditsAdjustments", "financials/customerFinancials",
    "financials/salesToGoal", "financials/costToBudget", "financials/forecasting",
    "financials/profitability", "financials/budgets", "financials/goals",
    "financials/companyPerformance", "financials/employeePerformance",
    "financials/reconciliation", "financials/intercompany", "financials/audit",
    "financials/reports", "financials/governance", "reporting/executive", "reporting/service",
    "reporting/inventory", "reporting/purchasing", "reporting/warehouse", "reporting/employees",
    "reporting/customers", "reporting/financial", "administration/overview",
    "administration/users", "administration/rolesPermissions", "administration/objects",
    "administration/workflows", "administration/permissionPreview", "administration/vehicles",
    "administration/regions", "administration/companySettings", "administration/duplicateRules",
    "administration/warehouseRacking", "administration/financialPolicy",
    "administration/integrations", "administration/auditLogs",
  ]),
  technician: Object.freeze([ // 5
    "dashboard/my", "service/jobAssignments", "service/coordinatedMission",
    "service/technicianWorkspace", "service/scan",
  ]),
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//                  PRODUCTION / FLAG FALSE -- THE THREE THINGS THE RULING PROTECTS
// ══════════════════════════════════════════════════════════════════════════════════════════════

// PRODUCTION PROOF 1 OF 3 -- EXISTING LEGACY DESTINATIONS UNCHANGED.
test("PRODUCTION: the legacy destination SET is identical to b6a36b15 for admin, dispatcher and technician", () => {
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN]) {
    const expected = MAIN_B6A36B15_LEGACY_VISIBLE[role];
    const actual = visibleUnderLegacy(role);
    const lost = expected.filter((d) => !actual.includes(d));
    const gained = actual.filter((d) => !expected.includes(d));
    assert.deepEqual(lost, [],
      `${role} LOST ${lost.length} destination(s) against b6a36b15 -- this branch narrows navigation in every flag-false environment, production included`);
    assert.deepEqual(gained, [],
      `${role} GAINED ${gained.length} destination(s) against b6a36b15 under the LEGACY source -- a Phase 3 door opened on a Firebase-era role literal`);
    // ...and the ORDER is the nav order, so the sets being equal means the menus render the same.
    assert.deepEqual(actual, [...expected]);
  }
  assert.equal(visibleUnderLegacy(ROLES.ADMIN).length, 75);
  assert.equal(visibleUnderLegacy(ROLES.DISPATCHER).length, 72);
  assert.equal(visibleUnderLegacy(ROLES.TECHNICIAN).length, 5);
});

// PRODUCTION PROOF 2 OF 3 -- NO NEW EOS API DEPENDENCY.
//
// Two independent statements, because "production does not need the EOS API" can fail in two
// different places: the CODE could reach for it, or the CONFIG could start requiring it.
test("PRODUCTION: nothing on the legacy path depends on an EOS API being configured", () => {
  // (a) THE PREDICATE. With no authority in the slot -- which is exactly what
  // `useExperienceContext` yields when the compile-time flag is false -- navigation answers fully
  // from the legacy inputs and never consults an EOS value. The register it reads is the legacy one.
  assert.equal(isEosNavigationSource(legacy), false);
  assert.equal(isEosNavigationSource({}), false);
  assert.equal(isEosNavigationSource(undefined), false);
  assert.equal(effectivePlaceholderRegister(legacy), NAV_LEGACY_PLACEHOLDER_DESTINATIONS);
  assert.equal(effectivePlaceholderRegister(legacy).length, 62);

  // (b) THE TRANSPORT. The hook that would make the request is gated on the compile-time constant,
  // not on a runtime probe, so a flag-false build never reaches the network to find out whether it
  // should have. Asserted against the source because the alternative is mounting React.
  const hook = readFileSync(join(here, "..", "src", "hooks", "useExperienceContext.js"), "utf8");
  assert.match(hook, /enabled = EOS_NAVIGATION_AUTHORITY_READY/,
    "the experience hook is no longer gated on the compile-time readiness flag");
  assert.match(hook, /enabled === true/, "the hook's `active` guard no longer requires the flag");

  // (c) THE REGISTRY. The four flag-false environments declare no eosApi and must not have acquired
  // one, and the one flag-true environment must still declare one -- the contract in BOTH directions.
  const registry = JSON.parse(readFileSync(join(repoRoot, "config", "environments.json"), "utf8"));
  for (const env of registry.environments) {
    const ready = env.readiness?.EOS_NAVIGATION_AUTHORITY_READY;
    if (ready === true) {
      assert.ok(env.eosApi && typeof env.eosApi.baseUrl === "string",
        `${env.id} enables the EOS navigation seam with no eosApi to answer it`);
    } else {
      assert.equal(env.eosApi, null,
        `${env.id} has acquired an eosApi without the seam being flipped -- that is a separate Owner decision`);
    }
  }
});

// PRODUCTION PROOF 3 OF 3 -- NO NARROWING CAUSED BY THIS PHASE 3 MERGE.
//
// The branch is not a no-op: it adds the Sales Agreements destination. This proves the addition is
// invisible to the legacy source rather than merely "not counted", which is the difference between
// an honest delta of zero and a delta that happens to cancel out.
test("PRODUCTION: the one destination this branch adds is invisible under the legacy source", () => {
  const added = "customers/salesAgreements";
  const item = itemAt(added);
  assert.ok(item, "the Sales Agreements destination is missing -- the Phase 3 half of the branch is gone");
  assert.equal(item.legacyPlaceholder, undefined);
  assert.equal(item.legacyKey, undefined);
  assert.equal(item.capabilityAccess, undefined);
  assert.equal(item.operationalRoleAccess, undefined);
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN, "owner", "salesperson", null]) {
    assert.equal(isNavItemVisible(item, role, keysFor(role), legacy), false,
      `Sales Agreements opened for the legacy role "${role}" -- it is earned by salesAgreement.read and nothing else`);
  }
  // The destination COUNT grew by one and the VISIBLE count did not, which is the shape of a door
  // that was added to the governed source only.
  assert.equal(destinations().length, 86, "the nav tree size moved by something other than Sales Agreements");
  assert.equal(MAIN_B6A36B15_LEGACY_VISIBLE.admin.includes(added), false);
  assert.equal(visibleUnderLegacy(ROLES.ADMIN).includes(added), false);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//                     SANDBOX / FLAG TRUE -- THE FOUR THINGS THE RULING REQUIRES
// ══════════════════════════════════════════════════════════════════════════════════════════════

// SANDBOX PROOF 1 OF 4 -- A GOVERNED PERSONA SEES ONLY CAPABILITY-AUTHORISED DESTINATIONS.
test("SANDBOX: a governed persona sees exactly the destinations its granted surfaces map, and no others", () => {
  // Three surfaces, chosen so they span three different domains and two different container answers.
  const surfaces = ["crm.accounts", "service.workOrders", "administration.auditLogs"];
  const ctx = eosContext(eosAuthority(surfaces));
  const visible = destinations()
    .filter(([, item]) => isNavItemVisible(item, null, [], ctx))
    .map(([key]) => key);

  // EVERY visible destination is either mapped to a granted surface or a container over one. There
  // is no third reason, and enumerating the reason for each is what makes this a proof rather than a
  // spot check.
  const granted = new Set(surfaces);
  for (const destination of visible) {
    const item = itemAt(destination);
    if (item.containerScope) continue;
    const mapped = NAV_SURFACE_ACCESS[destination] ?? [];
    assert.ok(mapped.some((key) => granted.has(key)),
      `${destination} is visible to a governed persona without a granted surface behind it`);
  }
  // ...and every destination mapped to a granted surface IS visible, so this is not vacuous.
  for (const [destination, keys] of Object.entries(NAV_SURFACE_ACCESS)) {
    if (!keys.some((key) => granted.has(key))) continue;
    assert.equal(visible.includes(destination), true, `${destination} is granted but not shown`);
  }
  // Nothing ungoverned came along: none of the 42 rows with no surface at all is visible.
  for (const destination of NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS) {
    assert.equal(visible.includes(destination), false,
      `${destination} has no governed surface and was visible to a governed persona anyway`);
  }
});

// SANDBOX PROOF 2 OF 4 -- THE TWENTY OBSOLETE PLACEHOLDERS ARE ABSENT FROM THE EFFECTIVE REGISTER.
//
// Absent STRUCTURALLY. The effective register under the EOS source is not "62 minus 20", a
// subtraction somebody can get wrong by one; it is EMPTY, so the twenty are absent for the same
// reason every other row is, and no filter has to be audited.
test("SANDBOX: the effective placeholder register is EMPTY, so the twenty are absent structurally", () => {
  const ctx = eosContext(eosAuthority(["crm.accounts"]));
  assert.equal(isEosNavigationSource(ctx), true);
  assert.deepEqual([...effectivePlaceholderRegister(ctx)], []);
  assert.equal(effectivePlaceholderRegister(ctx), NAV_GOVERNED_PLACEHOLDER_DESTINATIONS);
  assert.deepEqual([...NAV_GOVERNED_PLACEHOLDER_DESTINATIONS], []);

  // The twenty are absent, and so is every other row -- stated both ways so a future edit that made
  // the governed register "the 42" instead of "nothing" would fail here rather than pass quietly.
  for (const destination of NAV_CUTOVER_PLACEHOLDER_DESTINATIONS) {
    assert.equal(effectivePlaceholderRegister(ctx).includes(destination), false);
  }
  for (const destination of NAV_LEGACY_PLACEHOLDER_DESTINATIONS) {
    assert.equal(effectivePlaceholderRegister(ctx).includes(destination), false,
      `${destination} survives in the effective EOS register -- the governed register must hold nothing`);
  }

  // AND IT IS THE BEHAVIOUR, NOT JUST THE LIST. A persona granted nothing, holding the role literal
  // that would open all 62 under the legacy source, opens none of them.
  const refusesAll = eosContext(eosAuthority([]));
  for (const destination of NAV_LEGACY_PLACEHOLDER_DESTINATIONS) {
    assert.equal(isNavItemVisible(itemAt(destination), ROLES.ADMIN, keysFor(ROLES.ADMIN), refusesAll), false,
      `${destination} opened under the EOS source from PLACEHOLDER_DEFAULT_ROLES`);
  }
});

// SANDBOX PROOF 3 OF 4 -- A FIREBASE ROLE CANNOT ALTER THE RESULT.
//
// The strong form: the answer for EVERY destination is byte-for-byte identical whether the legacy
// inputs are absent, present, or maximal. If any legacy input were still consulted anywhere under
// the EOS source, one of these 86 comparisons would differ.
test("SANDBOX: no Firebase role, claim, legacy key or operational role changes any answer", () => {
  const authority = eosAuthority(["crm.accounts", "service.workOrders"]);
  const baseline = destinations()
    .map(([key, item]) => [key, isNavItemVisible(item, null, [], eosContext(authority))]);

  const contaminations = [
    // the raw role literal, in all three flavours that mean something to the legacy path
    { role: ROLES.ADMIN, keys: keysFor(ROLES.ADMIN), extra: {} },
    { role: ROLES.DISPATCHER, keys: keysFor(ROLES.DISPATCHER), extra: {} },
    { role: ROLES.TECHNICIAN, keys: keysFor(ROLES.TECHNICIAN), extra: {} },
    // a claim-shaped role nobody recognises, and the empty/absent forms
    { role: "superuser", keys: [], extra: {} },
    { role: "", keys: [], extra: {} },
    // the maximal legacy key set
    { role: ROLES.ADMIN, keys: ["inventory", "jobs", "controlTower", "fieldMode", "dispatch", "scan"], extra: {} },
    // the Firestore capability feed saying yes to everything
    { role: ROLES.ADMIN, keys: keysFor(ROLES.ADMIN), extra: { hasCapability: () => true } },
    // every operational role at once, with an ACTIVE employment status behind it
    {
      role: ROLES.TECHNICIAN,
      keys: [],
      extra: { operationalRoles: ["inventoryTransferOperator", "inventoryCycleCountCounter", "warehousePicker"] },
    },
  ];
  for (const { role, keys, extra } of contaminations) {
    const ctx = eosContext(authority, extra);
    for (const [key, expected] of baseline) {
      assert.equal(isNavItemVisible(itemAt(key), role, keys, ctx), expected,
        `${key} changed its answer under the EOS source when fed role="${role}" -- a legacy input is still being consulted`);
    }
  }
});

// SANDBOX PROOF 4 OF 4 -- AN UNRESOLVED EOS AUTHORITY FAILS CLOSED.
test("SANDBOX: an unresolved EOS authority grants nothing and does NOT fall through to the legacy source", () => {
  for (const state of [EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED, EXPERIENCE_STATE.UNAVAILABLE]) {
    const ctx = eosContext(eosAuthority([], state));
    // It IS the source -- which is the property that makes the fallback impossible. A non-READY
    // authority that stopped being recognised as the source would be handed straight to
    // ROLE_NAV_ACCESS by the next line of isNavItemVisible.
    assert.equal(isEosNavigationSource(ctx), true, `a ${state} authority stopped being the source`);
    assert.deepEqual([...effectivePlaceholderRegister(ctx)], [],
      `a ${state} session was handed a non-empty placeholder register`);
    // Nothing is visible, to anybody, however much legacy authority is handed in alongside.
    for (const role of [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN, null]) {
      const visible = destinations()
        .filter(([, item]) => isNavItemVisible(item, role, keysFor(role), ctx));
      assert.deepEqual(visible.map(([k]) => k), [],
        `a ${state} EOS session reached a destination as "${role}"`);
      assert.equal(NAV_DOMAINS.some((d) => isDomainVisible(d, role, keysFor(role), ctx)), false,
        `a ${state} EOS session reached a domain as "${role}"`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//                      THE RATCHET -- WHAT EACH OF THE THREE CONSTANTS GUARANTEES
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("RATCHET: the register partitions into 20 + 42 = 62, derived from NAV_SURFACE_ACCESS", () => {
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 62);
  assert.equal(NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.length, 20);
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS.length, 42);
  assert.equal(NAV_GOVERNED_PLACEHOLDER_DESTINATIONS.length, 0);
  assert.equal(NAV_LEGACY_PLACEHOLDER_CEILING, 62);
  assert.equal(NAV_CUTOVER_PLACEHOLDER_CEILING, 20);
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_CEILING, 42);

  // The partition is a partition: disjoint, exhaustive, and computed from the criterion rather than
  // from two hand-maintained lists.
  assert.deepEqual(
    [...NAV_CUTOVER_PLACEHOLDER_DESTINATIONS, ...NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS].sort(),
    [...NAV_LEGACY_PLACEHOLDER_DESTINATIONS].sort(),
  );
  for (const destination of NAV_CUTOVER_PLACEHOLDER_DESTINATIONS) {
    assert.equal(NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS.includes(destination), false);
    assert.ok(Object.prototype.hasOwnProperty.call(NAV_SURFACE_ACCESS, destination));
  }
  for (const destination of NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS) {
    assert.equal(Object.prototype.hasOwnProperty.call(NAV_SURFACE_ACCESS, destination), false);
  }
  // The real registers are clean against every guard.
  assert.deepEqual(navigationSurfaceMapViolations(EXPERIENCE_SURFACE_KEYS), []);
  assert.deepEqual(legacyPlaceholderRegisterViolations(), []);
});

// A SIXTY-THIRD ROW IS REFUSED WHICHEVER KIND IT IS. This is the property that replaces Lane BQ's
// single number: the total going back up to 62 did not buy anybody headroom, because the two
// partitions are each at their own ceiling and a new row must land in one of them.
test("RATCHET: a 63rd legacy row is refused, and so is a reintroduced governed row", () => {
  const register = NAV_LEGACY_PLACEHOLDER_DESTINATIONS;

  // (a) A 63rd row on a destination with NO governed surface: a genuinely new ungoverned door.
  const ungovernedGrowth = legacyPlaceholderRegisterViolations({
    register: [...register, "reporting/aBrandNewUngovernedDoor"],
  });
  assert.ok(ungovernedGrowth.some((p) => p.includes("above the shrink-only ceiling of 62")));
  assert.ok(ungovernedGrowth.some((p) => p.includes("NO governed surface, above the shrink-only ceiling of 42")));

  // (b) A 63rd row on a destination that ALREADY holds a governed surface -- the exact shape of
  // "put the rows back" going one row too far. Sales Agreements is the live example: it earned its
  // surface AFTER the cutover began, so it must get its door from the surface and never from a row.
  const governedGrowth = legacyPlaceholderRegisterViolations({
    register: [...register, "customers/salesAgreements"],
  });
  assert.ok(governedGrowth.some((p) => p.includes("above the shrink-only ceiling of 62")));
  assert.ok(governedGrowth.some((p) => p.includes("ALREADY holds a governed surface, above the shrink-only ceiling of 20")));

  // (c) THE COUNT-PRESERVING SWAP, which a single total ceiling cannot see. Drop an ungoverned row,
  // add a governed one: still 62, still refused, because the partition ceilings move independently.
  const swap = legacyPlaceholderRegisterViolations({
    register: [...register.filter((d) => d !== "financials/overview"), "customers/salesAgreements"],
  });
  assert.equal(swap.some((p) => p.includes("above the shrink-only ceiling of 62")), false,
    "the swap tripped the TOTAL ceiling, so this is not testing what it claims to");
  assert.ok(swap.some((p) => p.includes("ALREADY holds a governed surface")),
    "a count-preserving swap into the cutover partition is no longer refused");

  // (d) SHRINKING IS ALWAYS FINE, in either partition. The ratchet must not obstruct the retirement
  // it exists to record -- an environment flipping the flag retires cutover rows, and this is what
  // that will look like.
  assert.deepEqual(legacyPlaceholderRegisterViolations({ register: register.slice(0, 40) }), []);
  assert.deepEqual(legacyPlaceholderRegisterViolations({
    register: register.filter((d) => !NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.includes(d)),
  }), [], "retiring the whole cutover partition -- the end state of the cutover -- is refused");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//                        THE ENVIRONMENT MATRIX -- UNCHANGED, AND PINNED
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("ENVIRONMENT MATRIX: all five environments hold the readiness they held before this lane", () => {
  const registry = JSON.parse(readFileSync(join(repoRoot, "config", "environments.json"), "utf8"));
  const actual = Object.fromEntries(
    registry.environments.map((env) => [env.id, env.readiness?.EOS_NAVIGATION_AUTHORITY_READY]),
  );
  assert.deepEqual(actual, {
    "local-emulator": false,
    "platform-sandbox": true,
    "platform-certification": false,
    "platform-integration": false,
    "taylor-parts-production": false,
  }, "config/environments.json moved -- flipping an environment is an Owner decision, not a lane's");
  // PRODUCTION, SAID TWICE. The flag is false AND there is no API, which are two independent
  // reasons the EOS source cannot be the source there and two independent things a lane could
  // accidentally change.
  const production = registry.environments.find((e) => e.id === "taylor-parts-production");
  assert.equal(production.readiness.EOS_NAVIGATION_AUTHORITY_READY, false);
  assert.equal(production.eosApi, null);
});

// PLACEHOLDER_DEFAULT_ROLES itself is untouched by any of this: the rows moved between registers,
// the literal did not gain a role and did not lose one.
test("PLACEHOLDER_DEFAULT_ROLES is unchanged -- the registers moved, the mechanism did not", () => {
  assert.deepEqual(PLACEHOLDER_DEFAULT_ROLES, ["admin", "dispatcher"]);
  assert.equal(isNavItemVisible(itemAt("administration/vehicles"), ROLES.ADMIN, [], legacy), true);
  assert.equal(isNavItemVisible(itemAt("administration/vehicles"), ROLES.TECHNICIAN, [], legacy), false);
});

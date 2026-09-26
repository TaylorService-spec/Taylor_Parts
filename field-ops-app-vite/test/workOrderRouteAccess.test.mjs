// /service/work-orders/:workOrderId and /service/work-orders/new -- WHO GETS WHICH ROUTE.
//
// Pure and offline. Exercises navigation/workOrderRouteAccess.js against real EOS navigation
// authorities built by access/experienceContext.js, the surface sets the server resolves for the
// canonical personas (functions/test/personaBusinessAccessRegression.test.mjs pins them), and the
// governed grant baseline read as data.
//
// Run: node --test test/workOrderRouteAccess.test.mjs   (also `npm test`)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  workOrderRouteAccess,
  WORK_ORDER_DETAIL_SURFACE,
  WORK_ORDER_DISPATCH_SURFACE,
} from "../src/navigation/workOrderRouteAccess.js";
import { NAV_SURFACE_ACCESS, isEosNavigationSource } from "../src/navigation/navConfig.js";
import {
  EXPERIENCE_STATE,
  EXPERIENCE_SURFACE_KEYS,
  buildNavigationAuthority,
} from "../src/access/experienceContext.js";
import { createPermissionPreviewer } from "../src/access/navPermissionPreview.js";

const here = dirname(fileURLToPath(import.meta.url));

const eosAuthority = (surfaces, state = EXPERIENCE_STATE.READY) => buildNavigationAuthority({
  state,
  context: state === EXPERIENCE_STATE.READY
    ? {
      tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null,
      workEligibility: [], operationalScopes: [], surfaces,
    }
    : null,
});
const eosContext = (surfaces, state) => ({
  operationalRoles: [], employmentStatus: "ACTIVE", eosNavigationAuthority: eosAuthority(surfaces, state),
});
const legacyContext = { operationalRoles: [], employmentStatus: "ACTIVE" };

// A previewer with the real wrapper and a literal resolver mirroring compatibilityRoles.ts for
// workOrder.create (admin/dispatcher ALLOW, technician DENY) -- the convention
// navPermissionPreviewParity.test.mjs uses, since Node cannot load the .ts resolver directly.
const FAKE_ROLES = { admin: {}, dispatcher: {}, technician: {} };
const fakeResolve = ({ assignments }) => {
  const allowed = { admin: true, dispatcher: true, technician: false }[assignments[0]?.roleId];
  return { decision: allowed ? "ALLOW" : "DENY" };
};
const previewHasPermission = createPermissionPreviewer(fakeResolve, FAKE_ROLES);

// The expression App.jsx used before this module, verbatim, for the red proof and the parity proof.
const previousExpression = (navRole) =>
  previewHasPermission("workOrder.create", navRole, { fallback: navRole === "admin" || navRole === "dispatcher" });

// Surface sets as the server resolves them for the canonical personas (subset relevant to Service).
const DISPATCHER = ["crm.accounts", "inventory.catalog", "service.coordinatedVisits", "service.dispatch", "service.workOrders"];
const SERVICE_TECHNICIAN = ["field.myWorkOrders", "service.workOrders"];
const ACCOUNTING = ["administration.auditLogs", "financials.invoices", "financials.payments"];
const GENERAL_EMPLOYEE = [];

const access = (surfaces, extra = {}) => workOrderRouteAccess({
  operationalContext: eosContext(surfaces), role: null, previewHasPermission, ...extra,
});

// ════════════════════ RED: THE DEFECT, REPRODUCED ════════════════════

test("RED PROOF -- the previous App.jsx gate emits neither route for an authorized persona under the EOS source", () => {
  const ctx = eosContext(DISPATCHER);
  assert.equal(isEosNavigationSource(ctx), true);
  // App.jsx: `const navRole = eosIsNavigationSource ? null : role;`
  const navRole = isEosNavigationSource(ctx) ? null : "dispatcher";
  assert.equal(previousExpression(navRole), false,
    "the previous expression opened a route under the EOS source -- the defect premise no longer holds");
  // The same persona, through the guard, gets both.
  assert.deepEqual({ ...access(DISPATCHER) }, { detail: true, create: true });
});

// ════════════════════ EOS SOURCE ════════════════════

test("authorized (Work Orders + Dispatch surfaces): detail AND create", () => {
  assert.deepEqual({ ...access(DISPATCHER) }, { detail: true, create: true });
  assert.deepEqual({ ...access([WORK_ORDER_DETAIL_SURFACE, WORK_ORDER_DISPATCH_SURFACE]) }, { detail: true, create: true });
});

test("read-level only (service technician): NEITHER route -- no broadening past the legacy reach", () => {
  assert.deepEqual({ ...access(SERVICE_TECHNICIAN) }, { detail: false, create: false });
  assert.deepEqual({ ...access([WORK_ORDER_DETAIL_SURFACE]) }, { detail: false, create: false });
});

test("technician-shaped authority (as the server resolves service-technician-a) gets neither route", () => {
  // personaBusinessAccessRegression.test.mjs:555 pins exactly this surface set for the technician.
  const technician = ["field.myWorkOrders", "service.workOrders"];
  for (const role of [null, "technician", "admin", "dispatcher"]) {
    const r = workOrderRouteAccess({ operationalContext: eosContext(technician), role, previewHasPermission });
    assert.deepEqual({ ...r }, { detail: false, create: false }, `technician surfaces + role ${role} opened a route`);
  }
  // Parts / shop associates / office manager resolve service.workOrders without service.dispatch too.
  assert.deepEqual({ ...access(["inventory.catalog", "inventory.balances", "receiving.checkIn", "service.workOrders"]) },
    { detail: false, create: false });
});

test("no Work Orders surface: neither route -- the Dispatch surface alone opens nothing", () => {
  assert.deepEqual({ ...access(ACCOUNTING) }, { detail: false, create: false });
  // The Dispatch surface without the Work Orders surface opens nothing either.
  assert.deepEqual({ ...access([WORK_ORDER_DISPATCH_SURFACE]) }, { detail: false, create: false });
  // field.myWorkOrders is the technician's own queue, not the record routes.
  assert.deepEqual({ ...access(["field.myWorkOrders"]) }, { detail: false, create: false });
});

test("general employee (no surfaces): nothing", () => {
  assert.deepEqual({ ...access(GENERAL_EMPLOYEE) }, { detail: false, create: false });
});

test("every non-READY EOS state grants nothing and does NOT fall through to the legacy role", () => {
  for (const state of [EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED, EXPERIENCE_STATE.UNAVAILABLE]) {
    for (const role of ["admin", "dispatcher"]) {
      const r = workOrderRouteAccess({ operationalContext: eosContext(DISPATCHER, state), role, previewHasPermission });
      assert.deepEqual({ ...r }, { detail: false, create: false }, `${state} + ${role} opened a route`);
    }
  }
});

test("no Firebase role value can influence the EOS branch -- and the previewer is never consulted", () => {
  let previewCalls = 0;
  const spy = (...args) => { previewCalls += 1; return previewHasPermission(...args); };
  const roles = [null, undefined, "", "admin", "dispatcher", "technician", "owner", "not_a_role", { toString: () => "admin" }];
  for (const surfaces of [DISPATCHER, SERVICE_TECHNICIAN, ACCOUNTING, GENERAL_EMPLOYEE]) {
    const baseline = { ...access(surfaces) };
    for (const role of roles) {
      const r = workOrderRouteAccess({ operationalContext: eosContext(surfaces), role, previewHasPermission: spy });
      assert.deepEqual({ ...r }, baseline, `role ${String(role)} changed the EOS answer for [${surfaces}]`);
    }
  }
  // An always-ALLOW previewer cannot open anything either.
  const r = workOrderRouteAccess({ operationalContext: eosContext([]), role: "admin", previewHasPermission: () => true });
  assert.deepEqual({ ...r }, { detail: false, create: false });
  assert.equal(previewCalls, 0, "the legacy previewer was consulted under the EOS source");
});

// ════════════════════ LEGACY SOURCE: THE PREVIOUS EXPRESSION, EXACTLY ════════════════════

test("legacy source: both answers equal the previous expression for every role value", () => {
  for (const role of [null, undefined, "", "admin", "dispatcher", "technician", "owner", "not_a_role"]) {
    const expected = previousExpression(role);
    const r = workOrderRouteAccess({ operationalContext: legacyContext, role, previewHasPermission });
    assert.deepEqual({ ...r }, { detail: expected, create: expected }, `legacy parity broke for role ${String(role)}`);
  }
  assert.deepEqual({ ...workOrderRouteAccess({ operationalContext: legacyContext, role: "admin", previewHasPermission }) },
    { detail: true, create: true });
  assert.deepEqual({ ...workOrderRouteAccess({ operationalContext: legacyContext, role: "technician", previewHasPermission }) },
    { detail: false, create: false });
});

test("legacy source: the previewer receives exactly the previous call -- id, role and fallback", () => {
  for (const role of ["admin", "dispatcher", "technician", null, "not_a_role"]) {
    const calls = [];
    const recorder = (...args) => { calls.push(args); return "SENTINEL"; };
    const r = workOrderRouteAccess({ operationalContext: legacyContext, role, previewHasPermission: recorder });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["workOrder.create", role, { fallback: role === "admin" || role === "dispatcher" }]);
    // The previewer's answer is passed through untouched to both routes.
    assert.equal(r.detail, "SENTINEL");
    assert.equal(r.create, "SENTINEL");
  }
  // No operationalContext at all is the legacy source too.
  assert.deepEqual({ ...workOrderRouteAccess({ operationalContext: undefined, role: "dispatcher", previewHasPermission }) },
    { detail: true, create: true });
});

// ════════════════════ THE AUTHORITY CHOICE, PINNED TO EVIDENCE ════════════════════

test("both surface keys are real EOS surfaces, and detail is the Work Orders list's own surface", () => {
  assert.ok(EXPERIENCE_SURFACE_KEYS.includes(WORK_ORDER_DETAIL_SURFACE));
  assert.ok(EXPERIENCE_SURFACE_KEYS.includes(WORK_ORDER_DISPATCH_SURFACE));
  assert.deepEqual(NAV_SURFACE_ACCESS["service/workOrders"], [WORK_ORDER_DETAIL_SURFACE]);
});

test("the server catalog still earns the two surfaces the way the guard assumes", () => {
  const src = readFileSync(join(here, "..", "..", "functions", "src", "eosOps", "experienceAuthority.ts"), "utf8");
  const pathsOf = (key) => {
    const m = src.match(new RegExp(`surface\\("${key.replace(".", "\\.")}",[^\\[]*\\[([\\s\\S]*?)\\]\\)`));
    assert.ok(m, `experienceAuthority.ts no longer declares ${key}`);
    return [...m[1].matchAll(/capabilityKey:\s*"([^"]+)"/g)].map((x) => x[1]).sort();
  };
  assert.deepEqual(pathsOf(WORK_ORDER_DISPATCH_SURFACE), ["workOrder.lifecycle.dispatch"],
    "service.dispatch gained a grant path -- re-check that every path implies workOrder.create");
  assert.deepEqual(pathsOf(WORK_ORDER_DETAIL_SURFACE),
    ["workOrder.create", "workOrder.lifecycle.dispatch", "workOrder.transition"]);
});

test("INVARIANT: every Role that earns service.dispatch holds workOrder.create AND workOrder.record.read (never over-grants)", () => {
  const baseline = JSON.parse(readFileSync(join(here, "..", "..", "functions", "src", "adminPolicy", "seed",
    "roleCapabilityAuthorityBaseline.json"), "utf8"));
  const holders = (cap) => new Set(baseline.grants.filter((g) => g.capabilityKey === cap).map((g) => g.roleKey));
  const dispatchHolders = holders("workOrder.lifecycle.dispatch");
  const createHolders = holders("workOrder.create");
  const readHolders = holders("workOrder.record.read");
  assert.deepEqual([...dispatchHolders].sort(), ["admin", "dispatcher", "fieldManager"],
    "the dispatch-authority population moved -- re-check the route reach against the legacy admin/dispatcher gate");
  for (const role of dispatchHolders) {
    assert.ok(createHolders.has(role), `${role} earns service.dispatch without workOrder.create -- the wizard would over-grant`);
    assert.ok(readHolders.has(role), `${role} earns service.dispatch without workOrder.record.read -- detail would over-grant`);
  }
  // And the technician -- Work Orders surface via transition, no dispatch -- is exactly who stays out.
  assert.equal(holders("workOrder.transition").has("technician"), true);
  assert.equal(dispatchHolders.has("technician"), false);
});

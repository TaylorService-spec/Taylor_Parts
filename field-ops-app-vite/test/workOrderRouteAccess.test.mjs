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
  workOrderRouteAccessWithReadiness,
  WORK_ORDER_DETAIL_SURFACE,
  WORK_ORDER_DISPATCH_SURFACE,
  WORK_ORDER_EOS_BACKEND,
  WORK_ORDER_EOS_BACKEND_READINESS,
  WORK_ORDER_RECORD_READ_EOS_BACKEND,
  WORK_ORDER_CREATE_EOS_BACKEND,
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

// Both backends active: the SURFACE logic in isolation. The readiness gate is tested separately below.
const { FIREBASE_ROLE_GATED, EOS_POSTGRES_ACTIVE } = WORK_ORDER_EOS_BACKEND;
const BOTH_READY = Object.freeze({ detail: EOS_POSTGRES_ACTIVE, create: EOS_POSTGRES_ACTIVE });
const guard = (args) => workOrderRouteAccessWithReadiness({ readiness: BOTH_READY, ...args });
const access = (surfaces, extra = {}) => guard({
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
  // The same persona, through the guard's surface logic with both backends active, gets both.
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
    const r = guard({ operationalContext: eosContext(technician), role, previewHasPermission });
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
      const r = guard({ operationalContext: eosContext(DISPATCHER, state), role, previewHasPermission });
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
      const r = guard({ operationalContext: eosContext(surfaces), role, previewHasPermission: spy });
      assert.deepEqual({ ...r }, baseline, `role ${String(role)} changed the EOS answer for [${surfaces}]`);
    }
  }
  // An always-ALLOW previewer cannot open anything either.
  const r = guard({ operationalContext: eosContext([]), role: "admin", previewHasPermission: () => true });
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

// ════════════════════ EOS BACKEND READINESS: SURFACES ARE NECESSARY, NOT SUFFICIENT ════════════════════

const ALL_SURFACE_SETS = { DISPATCHER, SERVICE_TECHNICIAN, ACCOUNTING, GENERAL_EMPLOYEE,
  BOTH: [WORK_ORDER_DETAIL_SURFACE, WORK_ORDER_DISPATCH_SURFACE] };

test("COMMITTED readiness is not-ready for both: the public guard emits NO route under EOS for anyone", () => {
  assert.equal(WORK_ORDER_RECORD_READ_EOS_BACKEND, FIREBASE_ROLE_GATED);
  assert.equal(WORK_ORDER_CREATE_EOS_BACKEND, FIREBASE_ROLE_GATED);
  assert.deepEqual({ ...WORK_ORDER_EOS_BACKEND_READINESS }, { detail: FIREBASE_ROLE_GATED, create: FIREBASE_ROLE_GATED });
  assert.ok(Object.isFrozen(WORK_ORDER_EOS_BACKEND_READINESS));
  for (const [name, surfaces] of Object.entries(ALL_SURFACE_SETS)) {
    for (const role of [null, "admin", "dispatcher", "technician"]) {
      const r = workOrderRouteAccess({ operationalContext: eosContext(surfaces), role, previewHasPermission });
      assert.deepEqual({ ...r }, { detail: false, create: false }, `${name} + role ${role} got a route while the backend is not ready`);
    }
  }
});

test("the public guard ignores a caller-supplied readiness -- no caller-controlled bypass", () => {
  const r = workOrderRouteAccess({
    operationalContext: eosContext(DISPATCHER), role: "dispatcher", previewHasPermission, readiness: BOTH_READY,
  });
  assert.deepEqual({ ...r }, { detail: false, create: false });
});

test("not-ready (both) -> no routes even with both surfaces granted", () => {
  const none = { detail: FIREBASE_ROLE_GATED, create: FIREBASE_ROLE_GATED };
  for (const surfaces of [DISPATCHER, [WORK_ORDER_DETAIL_SURFACE, WORK_ORDER_DISPATCH_SURFACE]]) {
    const r = workOrderRouteAccessWithReadiness({ operationalContext: eosContext(surfaces), role: "admin", previewHasPermission, readiness: none });
    assert.deepEqual({ ...r }, { detail: false, create: false });
  }
});

test("detail and create readiness gate INDEPENDENTLY -- one is never inferred from the other", () => {
  const ctx = eosContext(DISPATCHER);
  const at = (readiness) => ({ ...workOrderRouteAccessWithReadiness({ operationalContext: ctx, role: null, previewHasPermission, readiness }) });
  assert.deepEqual(at({ detail: EOS_POSTGRES_ACTIVE, create: FIREBASE_ROLE_GATED }), { detail: true, create: false });
  assert.deepEqual(at({ detail: FIREBASE_ROLE_GATED, create: EOS_POSTGRES_ACTIVE }), { detail: false, create: true });
  assert.deepEqual(at({ detail: EOS_POSTGRES_ACTIVE }), { detail: true, create: false }, "a missing create readiness was inferred from detail");
  assert.deepEqual(at({ create: EOS_POSTGRES_ACTIVE }), { detail: false, create: true }, "a missing detail readiness was inferred from create");
  assert.deepEqual(at(BOTH_READY), { detail: true, create: true });
});

test("only the exact EOS_POSTGRES_ACTIVE value is ready -- absent, malformed or truthy values are not", () => {
  const ctx = eosContext(DISPATCHER);
  for (const bad of [undefined, null, "", true, 1, "eos_postgres_active", "EOS_POSTGRES_ACTIVE ", "READY", {}, FIREBASE_ROLE_GATED]) {
    const r = workOrderRouteAccessWithReadiness({ operationalContext: ctx, role: null, previewHasPermission, readiness: { detail: bad, create: bad } });
    assert.deepEqual({ ...r }, { detail: false, create: false }, `readiness ${JSON.stringify(bad)} opened a route`);
  }
  for (const readiness of [undefined, null, {}]) {
    const r = workOrderRouteAccessWithReadiness({ operationalContext: ctx, role: null, previewHasPermission, readiness });
    assert.deepEqual({ ...r }, { detail: false, create: false });
  }
});

test("readiness never OPENS a route the surfaces do not grant, nor bypasses a non-READY authority", () => {
  for (const surfaces of [SERVICE_TECHNICIAN, ACCOUNTING, GENERAL_EMPLOYEE, [WORK_ORDER_DETAIL_SURFACE], [WORK_ORDER_DISPATCH_SURFACE]]) {
    const r = workOrderRouteAccessWithReadiness({ operationalContext: eosContext(surfaces), role: "admin", previewHasPermission, readiness: BOTH_READY });
    assert.deepEqual({ ...r }, { detail: false, create: false }, `[${surfaces}] + ready backends opened a route`);
  }
  for (const state of [EXPERIENCE_STATE.LOADING, EXPERIENCE_STATE.REFUSED, EXPERIENCE_STATE.UNAVAILABLE]) {
    const r = workOrderRouteAccessWithReadiness({ operationalContext: eosContext(DISPATCHER, state), role: "admin", previewHasPermission, readiness: BOTH_READY });
    assert.deepEqual({ ...r }, { detail: false, create: false });
  }
});

test("legacy source: readiness is never read -- the public guard and every injected readiness give the previous expression", () => {
  for (const role of [null, "admin", "dispatcher", "technician", "not_a_role"]) {
    const expected = previousExpression(role);
    assert.deepEqual({ ...workOrderRouteAccess({ operationalContext: legacyContext, role, previewHasPermission }) },
      { detail: expected, create: expected });
    for (const readiness of [undefined, BOTH_READY, { detail: FIREBASE_ROLE_GATED, create: FIREBASE_ROLE_GATED }]) {
      const r = workOrderRouteAccessWithReadiness({ operationalContext: legacyContext, role, previewHasPermission, readiness });
      assert.deepEqual({ ...r }, { detail: expected, create: expected }, `legacy answer moved with readiness for role ${role}`);
    }
  }
});

test("EVIDENCE PIN: while no EOS transport serves Work Orders, neither readiness may be flipped", () => {
  // The only EOS operations transport is the closed route map in eosOpsHttp.ts. Flipping a readiness
  // constant without a Work Order route there would re-expose an unusable screen.
  const http = readFileSync(join(here, "..", "..", "functions", "src", "eosOps", "eosOpsHttp.ts"), "utf8");
  const m = http.match(/OPERATIONS_ROUTE_BY_OPERATION[^{]*\{([\s\S]*?)\}\)/);
  assert.ok(m, "eosOpsHttp.ts no longer declares OPERATIONS_ROUTE_BY_OPERATION -- re-derive this pin");
  const servesWorkOrders = /work-?orders?/i.test(m[1]);
  if (!servesWorkOrders) {
    assert.equal(WORK_ORDER_RECORD_READ_EOS_BACKEND, FIREBASE_ROLE_GATED, "detail readiness flipped with no EOS Work Order read route");
    assert.equal(WORK_ORDER_CREATE_EOS_BACKEND, FIREBASE_ROLE_GATED, "create readiness flipped with no EOS Work Order create route");
  }
  // And the screens are still the Firebase ones the not-ready value describes.
  const hook = readFileSync(join(here, "..", "src", "hooks", "useWorkOrder.js"), "utf8");
  const wizard = readFileSync(join(here, "..", "src", "modules", "workOrders", "WorkOrderWizard.jsx"), "utf8");
  if (/firebase\/firestore/.test(hook)) assert.equal(WORK_ORDER_RECORD_READ_EOS_BACKEND, FIREBASE_ROLE_GATED);
  if (/services\/workOrderService/.test(wizard)) assert.equal(WORK_ORDER_CREATE_EOS_BACKEND, FIREBASE_ROLE_GATED);
});

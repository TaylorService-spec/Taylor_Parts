// FIN-BLOCK-001 closure — financial visibility COMPANY/BU scope binding. Pure tests over the ONE
// canonical resolver (resolveEffectivePermission) with the new governed ScopeTypes
// `operatingCompany` / `businessUnit`, plus the FIN-004 authority composition. Activation is
// SIMULATED via the resolver's activationOverrides parameter (the finance.visibility.* ids stay
// active:false and in NO environment registry — activating them remains an Owner act); everything
// else is the exact production decision path. Prereq: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { buildFinancialVisibilityAuthority, FINANCIAL_VISIBILITY_CAPABILITIES } from "../lib/finance/financialVisibility.js";
import { OPERATING_COMPANY_IDS } from "../lib/ownership/operatingCompanyAuthority.js";
import { BUSINESS_UNITS } from "../lib/finance/financialAttribution.js";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";

const COMPANY_CAP = FINANCIAL_VISIBILITY_CAPABILITIES.OPERATING_COMPANY; // finance.visibility.company
const BU_CAP = FINANCIAL_VISIBILITY_CAPABILITIES.BUSINESS_UNIT;
const CONSOLIDATED_CAP = FINANCIAL_VISIBILITY_CAPABILITIES.CONSOLIDATED;

// Simulated Owner activation for the test only — the parameter the per-environment override
// machinery feeds in a genuinely activated environment.
const ACTIVE = new Set([COMPANY_CAP, BU_CAP, CONSOLIDATED_CAP, "finance.read"]);

// A synthetic governed role carrying the visibility capabilities (no repository role carries them
// — granting stays an Owner act; the resolver is what is under test).
const FIN_ROLE = {
  id: "finViewer",
  name: "Financial Viewer (test)",
  permissions: [COMPANY_CAP, BU_CAP, CONSOLIDATED_CAP, "finance.read"],
};
const ROLES = { finViewer: FIN_ROLE };

const ts = { toMillis: () => 1_700_000_000_000 };
const assignment = (scope, over = {}) => ({
  id: "ra-test",
  principalUid: "uid-1",
  roleId: "finViewer",
  scope,
  grantedBy: "test",
  grantedAt: ts,
  status: "active",
  accessVersionAtGrant: 1,
  ...over,
});

const decide = (permissionId, assignments, targetScope, over = {}) =>
  resolveEffectivePermission({
    permissionId,
    assignments,
    roles: ROLES,
    currentAccessVersion: 1,
    target: { scope: targetScope, condition: {} },
    activationOverrides: ACTIVE,
    ...over,
  }).decision;

const companyTarget = (id) => ({ type: "operatingCompany", value: id });
const buTarget = (id) => ({ type: "businessUnit", value: id });

test("1+3: a company-scoped binding reaches exactly its own governed company", () => {
  const taylor = [assignment({ type: "operatingCompany", value: "taylor" })];
  assert.equal(decide(COMPANY_CAP, taylor, companyTarget("taylor")), "ALLOW");
  const ventana = [assignment({ type: "operatingCompany", value: "ventana" })];
  assert.equal(decide(COMPANY_CAP, ventana, companyTarget("ventana")), "ALLOW");
});

test("2: a Taylor binding REFUSES Ventana (value-matched, never widened)", () => {
  const taylor = [assignment({ type: "operatingCompany", value: "taylor" })];
  assert.equal(decide(COMPANY_CAP, taylor, companyTarget("ventana")), "DENY");
});

test("4+5: a SERVICE business-unit binding reads SERVICE and refuses PARTS", () => {
  const svc = [assignment({ type: "businessUnit", value: "SERVICE" })];
  assert.equal(decide(BU_CAP, svc, buTarget("SERVICE")), "ALLOW");
  assert.equal(decide(BU_CAP, svc, buTarget("PARTS")), "DENY");
});

test("6: a company binding does NOT imply consolidated (global target never matches a scoped assignment)", () => {
  const taylor = [assignment({ type: "operatingCompany", value: "taylor" })];
  assert.equal(decide(CONSOLIDATED_CAP, taylor, { type: "global" }), "DENY");
  assert.equal(decide(COMPANY_CAP, taylor, { type: "global" }), "DENY");
});

test("7: a BU binding does not imply company-wide access", () => {
  const svc = [assignment({ type: "businessUnit", value: "SERVICE" })];
  assert.equal(decide(COMPANY_CAP, svc, companyTarget("taylor")), "DENY");
  assert.equal(decide(BU_CAP, svc, companyTarget("taylor")), "DENY");
});

test("12: a GLOBAL assignment on an unrelated OPERATIONAL role never becomes financial reach (role carries no finance capability)", () => {
  const opsRole = { id: "ops", name: "Ops", permissions: ["workOrder.read"] };
  const a = [assignment({ type: "global" }, { roleId: "ops" })];
  const d = resolveEffectivePermission({
    permissionId: CONSOLIDATED_CAP,
    assignments: a,
    roles: { ops: opsRole },
    currentAccessVersion: 1,
    target: { scope: { type: "global" }, condition: {} },
    activationOverrides: ACTIVE,
  });
  assert.equal(d.decision, "DENY");
});

test("13: admin-style full access flows through the SAME resolver (global assignment on a role carrying the capability) — no bypass path", () => {
  const a = [assignment({ type: "global" })];
  // Global matches every scoped target — via resolveEffectivePermission, not any side channel.
  assert.equal(decide(COMPANY_CAP, a, companyTarget("taylor")), "ALLOW");
  assert.equal(decide(COMPANY_CAP, a, companyTarget("ventana")), "ALLOW");
  assert.equal(decide(CONSOLIDATED_CAP, a, { type: "global" }), "ALLOW");
});

test("14: legacy assignments retain prior semantics — location/domain/tenant/ownAssignment behavior unchanged by the new members", () => {
  const loc = [assignment({ type: "location", value: "wh-main" })];
  assert.equal(decide(COMPANY_CAP, loc, { type: "location", value: "wh-main" }), "ALLOW"); // same value-match rule as before
  assert.equal(decide(COMPANY_CAP, loc, companyTarget("taylor")), "DENY"); // a warehouse is not a company
  const tenant = [assignment({ type: "tenant", value: "t1" })];
  assert.equal(decide(COMPANY_CAP, tenant, { type: "global" }), "DENY"); // tenant stays inert vs global
});

test("15: no binding = no scoped financial reach (empty assignments deny everywhere)", () => {
  for (const target of [companyTarget("taylor"), buTarget("SERVICE"), { type: "global" }]) {
    assert.equal(decide(COMPANY_CAP, [], target), "DENY");
  }
});

test("dormant reality: WITHOUT activation, even a bound company assignment denies (active:false wins)", () => {
  const taylor = [assignment({ type: "operatingCompany", value: "taylor" })];
  const d = resolveEffectivePermission({
    permissionId: COMPANY_CAP,
    assignments: taylor,
    roles: ROLES,
    currentAccessVersion: 1,
    target: { scope: companyTarget("taylor"), condition: {} },
    // no activationOverrides — production reality today
  });
  assert.equal(d.decision, "DENY");
  assert.equal(d.reason, "inactivePermission");
});

test("catalog: finance.visibility.* remain registered active:false (activation is an Owner act, not this change)", () => {
  for (const id of Object.values(FINANCIAL_VISIBILITY_CAPABILITIES)) {
    const entry = PERMISSION_CATALOG.find((p) => p.id === id);
    assert.ok(entry, `${id} registered`);
    assert.equal(entry.active, false, `${id} stays active:false`);
  }
});

test("R-32 binding policy composes: a role may forbid global carriage of the company capability", () => {
  const restricted = { ...FIN_ROLE, scopesByPermission: { [COMPANY_CAP]: ["operatingCompany"] } };
  const roles = { finViewer: restricted };
  const globalAssign = [assignment({ type: "global" })];
  const scopedAssign = [assignment({ type: "operatingCompany", value: "taylor" })];
  const run = (assignments, target) =>
    resolveEffectivePermission({
      permissionId: COMPANY_CAP, assignments, roles, currentAccessVersion: 1,
      target: { scope: target, condition: {} }, activationOverrides: ACTIVE,
    }).decision;
  assert.equal(run(globalAssign, companyTarget("taylor")), "DENY"); // global carriage forbidden by the binding policy
  assert.equal(run(scopedAssign, companyTarget("taylor")), "ALLOW");
});

// ---- 8/9/16: the predicate side — caller-supplied ids can never expand reach ----

const invoice = (over = {}) => ({
  companyId: "taylor",
  creditedSalespersonId: "emp-1",
  lineBusinessUnitIds: ["SERVICE"],
  ...over,
});

test("8+9: reach comes only from grants — caller-supplied company/BU ids do not exist in the predicate's inputs", () => {
  const authority = buildFinancialVisibilityAuthority({
    factFamilyAllowed: true,
    grants: [{ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }],
  });
  // The predicate takes only STORED facts; there is no caller-parameter path at all. A Ventana
  // record stays invisible no matter what the caller asked for.
  assert.equal(authority.isInvoiceVisible(invoice()), true);
  assert.equal(authority.isInvoiceVisible(invoice({ companyId: "ventana" })), false);
});

test("16: a mixed-BU invoice does not leak across a BU scope (every line must match)", () => {
  const authority = buildFinancialVisibilityAuthority({
    factFamilyAllowed: true,
    grants: [{ scope: "BUSINESS_UNIT", businessUnitId: "SERVICE" }],
  });
  assert.equal(authority.isInvoiceVisible(invoice({ lineBusinessUnitIds: ["SERVICE", "SERVICE"] })), true);
  assert.equal(authority.isInvoiceVisible(invoice({ lineBusinessUnitIds: ["SERVICE", "PARTS"] })), false);
  assert.equal(authority.isInvoiceVisible(invoice({ lineBusinessUnitIds: [] })), false); // nothing attributable — fail closed
});

test("governed value sets are the canonical vocabularies (no second vocabulary minted)", () => {
  assert.deepEqual(Object.values(OPERATING_COMPANY_IDS).sort(), ["taylor", "ventana"]);
  assert.deepEqual([...BUSINESS_UNITS], ["SERVICE", "EQUIPMENT_SALES", "PARTS", "INSTALLATION"]);
});

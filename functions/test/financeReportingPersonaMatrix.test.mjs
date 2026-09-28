// Finance + Reporting — persona authority MATRIX on the (transitional) Firebase runtime resolver.
// Run: node --test test/financeReportingPersonaMatrix.test.mjs   (after `npm run build`)
//
// WHAT THIS PINS. The Financials pages and the Report Builder still resolve authority through
// resolveEffectivePermission over COMPATIBILITY_ROLES + GOVERNED_BUSINESS_ROLES, with per-environment
// activation overrides. Every other suite proves one role or one scope at a time. This one states
// the WHOLE holder set per capability, so any widening — a new role quietly gaining finance reach,
// a reserved visibility scope activating, a salesperson or technician reaching AR — fails here by
// name rather than passing unnoticed.
//
// It is a regression pin, not a policy source: the expected sets below are what the governed role
// bundles already say at this commit (Owner rulings FIN-004 2026-09-02, #1744, CERT-FIN-02; the
// sandbox activation registry). Changing one is a governed decision, and this file is where that
// decision shows up in review.
//
// RESERVED SCOPES STAY INACTIVE. finance.visibility.{self,team,businessUnit,company} are registered
// and granted in role bundles but NOT activated in any environment (ruling: A′ / #1981 governs,
// reserved visibility scopes remain inactive). The matrix asserts they resolve to NOBODY.
//
// Firebase retirement: this file adds no Firebase dependency — it exercises the pure resolver only.
// It is deleted with the resolver when the Financials/Reporting reads move to the EOS API.
import assert from "node:assert/strict";
import test from "node:test";

const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } = await import(
  "../lib/access/environmentCapabilityOverrides.js"
);
const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
const { buildFinancialVisibilityAuthority } = await import("../lib/finance/financialVisibility.js");
const { readFinancialFacts } = await import("../lib/finance/financialReportingRead.js");

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const SANDBOX = "eos-platform-sandbox";
const PRODUCTION = "taylor-parts";
const CERTIFICATION = "eos-platform-certification";

const overridesFor = (projectId) => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);

const decide = (roleId, permissionId, projectId, scope = { type: "global" }, assignmentScope = { type: "global" }) =>
  resolveEffectivePermission({
    permissionId,
    assignments: [{ id: "a", principalUid: "u", roleId, scope: assignmentScope, status: "active", accessVersionAtGrant: 0 }],
    roles: ROLES,
    currentAccessVersion: 0,
    target: { scope, condition: { operationalRoleActive: () => true } },
    activationOverrides: overridesFor(projectId),
  }).decision;

const holders = (permissionId, projectId) =>
  Object.keys(ROLES).filter((r) => decide(r, permissionId, projectId) === "ALLOW").sort();

// ═══════════════ The pinned sandbox matrix ═══════════════

const FINANCE_COMMAND_HOLDERS = ["accountingManager", "admin", "controller", "financeManager", "generalManager", "owner"];

const SANDBOX_EXPECTED = Object.freeze({
  // Fact-family gate: held widely, but it confers NO reach on its own (see reach tests below).
  "finance.read": [
    "accountingManager", "admin", "controller", "fieldManager", "financeManager", "generalManager", "owner",
    "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson", "shopAssociate", "shopManager",
  ],
  "finance.visibility.consolidated": ["accountingManager", "admin", "financeManager", "generalManager", "owner"],
  // Reserved scopes — registered, bundled, NOT activated anywhere.
  "finance.visibility.self": [],
  "finance.visibility.team": [],
  "finance.visibility.businessUnit": [],
  "finance.visibility.company": [],
  "finance.invoice.issue": [...FINANCE_COMMAND_HOLDERS, "partsManager"].sort(),
  "finance.adjustment.record": [...FINANCE_COMMAND_HOLDERS, "partsManager"].sort(),
  "finance.payment.apply": FINANCE_COMMAND_HOLDERS,
  "finance.refund.record": FINANCE_COMMAND_HOLDERS,
  // Report Builder definitions.
  "report.definition.read": ["admin", "owner", "reportViewer"],
  "report.definition.create": ["admin", "owner", "reportAuthor"],
  "report.definition.rename": ["admin", "owner", "reportAuthor"],
  "report.definition.duplicate": ["admin", "owner", "reportAuthor"],
  "report.definition.delete": ["admin", "owner"],
  // Object-level report reads, and the one finance-sensitive customer field.
  "report.customer.read": ["admin", "owner", "reportViewer"],
  "report.customer.field.paymentTerms.read": ["admin", "owner", "reportFinanceViewer"],
});

for (const [permissionId, expected] of Object.entries(SANDBOX_EXPECTED)) {
  test(`sandbox holder set for ${permissionId} is exactly the governed set`, () => {
    assert.deepEqual(holders(permissionId, SANDBOX), [...expected].sort());
  });
}

test("production and certification resolve every finance and reporting capability to NOBODY", () => {
  for (const projectId of [PRODUCTION, CERTIFICATION]) {
    for (const permissionId of Object.keys(SANDBOX_EXPECTED)) {
      assert.deepEqual(holders(permissionId, projectId), [], `${permissionId} must deny everyone in ${projectId}`);
    }
  }
});

// ═══════════════ Reach = fact family AND an ACTIVE scope ═══════════════

const reachOf = (roleId, projectId = SANDBOX) => {
  const factFamilyAllowed = decide(roleId, "finance.read", projectId) === "ALLOW";
  const grants = decide(roleId, "finance.visibility.consolidated", projectId) === "ALLOW" ? [{ scope: "CONSOLIDATED" }] : [];
  return buildFinancialVisibilityAuthority({ factFamilyAllowed, grants });
};

// The canonical personas that must NOT reach Financials — the nearby unauthorized population.
const NO_REACH_PERSONAS = [
  "salesperson", "salesManager", "technician", "dispatcher", "officeManager", "partsAssociate", "partsManager",
  "warehouseAssociate", "warehouseManager", "generalEmployee", "reportViewer", "reportAuthor", "reportFinanceViewer",
  "controller", "purchasingManager", "shopManager", "shopAssociate", "fieldManager", "operationsManager",
];
const REACH_PERSONAS = ["owner", "admin", "generalManager", "accountingManager", "financeManager"];

for (const roleId of NO_REACH_PERSONAS) {
  test(`NEGATIVE: ${roleId} has no financial reach in sandbox (listFinancialFacts/listAccountInvoiceAr refuse)`, () => {
    assert.equal(reachOf(roleId).anyReach, false);
  });
}

for (const roleId of REACH_PERSONAS) {
  test(`${roleId} reaches Financials in sandbox only through CONSOLIDATED`, () => {
    const a = reachOf(roleId);
    assert.equal(a.anyReach, true);
    assert.deepEqual([...a.grantedScopes], ["CONSOLIDATED"]);
    assert.equal(reachOf(roleId, PRODUCTION).anyReach, false, "production confers no reach");
  });
}

test("a salesperson holding finance.read reaches NOTHING: the fact family without an active scope reads no row", async () => {
  const a = reachOf("salesperson");
  assert.equal(a.factFamilyAllowed, true, "precondition: salesperson holds the fact-family gate");
  const rows = [{ id: "i1", data: { companyId: "taylor", accountId: "a1", currency: "USD", totalMinor: 100, attribution: { creditedSalespersonId: "e1" }, lines: [{ businessUnitId: "PARTS" }] } }];
  let read = false;
  const make = (r) => ({ where: () => make(r), limit: () => make(r), async get() { read = true; return { size: r.length, docs: r.map((x) => ({ id: x.id, data: () => x.data })) }; } });
  const db = { collection: () => make(rows), runTransaction: async (fn) => fn({ get: (q) => q.get() }) };
  const out = await readFinancialFacts(db, a, {}, 50);
  assert.equal(out.status, "unavailable");
  assert.equal(out.completeness.status, "NOT_READ");
  assert.equal(out.completeness.reason, "NO_REACH");
  assert.equal(out.invoices.length, 0);
  assert.equal(read, false, "no collection was read for a principal without reach");
});

// ═══════════════ Company A vs company B ═══════════════

test("a company-bound assignment (company A) confers no reach while the company scope is reserved/inactive", () => {
  for (const companyId of ["taylor", "ventana"]) {
    const scoped = { type: "operatingCompany", value: companyId };
    assert.equal(decide("financeManager", "finance.visibility.company", SANDBOX, scoped, scoped), "DENY");
    // …and a company-bound assignment never satisfies the GLOBAL consolidated target.
    assert.equal(decide("financeManager", "finance.visibility.consolidated", SANDBOX, { type: "global" }, scoped), "DENY");
  }
});

test("consolidated reach sees company A and company B; a company filter only narrows", async () => {
  const rows = [
    { id: "a-1", data: { companyId: "taylor", accountId: "acct-a", currency: "USD", totalMinor: 100, lines: [{ businessUnitId: "PARTS" }] } },
    { id: "b-1", data: { companyId: "ventana", accountId: "acct-b", currency: "USD", totalMinor: 200, lines: [{ businessUnitId: "SERVICE" }] } },
  ];
  const make = (r) => ({
    where(f, _o, v) { return make(r.filter((x) => x.data[f] === v)); },
    limit(n) { return make(r.slice(0, n)); },
    async get() { return { size: r.length, docs: r.map((x) => ({ id: x.id, data: () => x.data })) }; },
  });
  const db = { collection: (n) => make(n === "invoices" ? rows : []), runTransaction: async (fn) => fn({ get: (q) => q.get() }) };
  const a = reachOf("accountingManager");
  const all = await readFinancialFacts(db, a, {}, 50);
  assert.equal(all.completeness.status, "COMPLETE");
  assert.deepEqual(all.invoices.map((i) => i.invoiceId).sort(), ["a-1", "b-1"]);
  const onlyB = await readFinancialFacts(db, a, { companyId: "ventana" }, 50);
  assert.deepEqual(onlyB.invoices.map((i) => i.invoiceId), ["b-1"]);
  assert.deepEqual(onlyB.byCompany.map((r) => r.key), ["ventana"], "rollups follow the narrowed set, never the whole book");
});

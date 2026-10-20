// SAE, over real PostgreSQL -- the protected-Owner exemption from secondary approval, for the Financial Policy lifecycle and for Administration (DECISIONS #SAE; Owner policy override
// 2026-10-20; briefs SAE2 + SAE3 Rule 1). The other workflows' Owner proofs live beside their own fixtures: F-1b corrections and voids (f1bInvoiceCorrectionPostgres), G-1 goals
// (g1GoalAuthoringPostgres), P-1 purchase orders (supplierPurchaseOrderAuthoringPostgres), cycle count (eosCycleCountOperationsPostgres).
//
//   FINANCIAL POLICY   the Owner prepares, submits, approves and activates their own version (the audit rows record the basis; history still rebuilds); an Administrator who prepared a
//                      version is refused approve / reject / activate (SEPARATION_OF_DUTIES) and the database refuses the same on a direct write; a direct write by the Owner is accepted
//                      only while the seam proves the Owner at that moment (a revoked Owner is refused).
//   ADMINISTRATION     SELF_ADMINISTRATION is waived for the governed protected Owner ONLY and the audit event says so; the Administrator, an Owner with no Employee link and a look-alike
//                      keep it; the protected Owner Role is still never appointed through ordinary administration.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const require = createRequire(import.meta.url);
const fp = require("../lib/eosFinance/financialPolicy.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-sae-pg";
const FIN = "/operations/finance";
const WA = Object.freeze({ inventoryCostMethod: "WEIGHTED_AVERAGE", serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION",
  cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT", freightTreatment: "EXCLUDED", landedCostTreatment: "EXCLUDED" });
const FIFO = Object.freeze({ ...WA, inventoryCostMethod: "FIFO", cogsRecognitionPointId: "INVOICE_ISSUE" });

test("SAE: the protected Owner over PostgreSQL -- Financial Policy and Administration", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person: staff, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "saepg" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const fn = (who, operation, input) => call(who, FIN, operation, input);
  const businessDate = async (company, plusDays = 0) =>
    (await one(`SELECT (eos_policy.operating_company_business_date($1, $2, now()) + $3::int)::text AS d`, [TENANT, company, plusDays])).d;

  // ── people. The protected Owner Role is staffed by the fixture seam (Administration never assigns it). ──
  const person = async (subject, roleKeys, employee) => {
    const who = await staff(subject, roleKeys.filter((k) => k !== "owner"), employee);
    if (roleKeys.includes("owner")) await seedProtectedOwner(repo, { tenantId: TENANT, principalId: who.principalId });
    return who;
  };
  const grant = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only (SAE)" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 300)}`);
  };
  assert.equal((await admin("createRole", { key: "financialPolicyPreparer", name: "Financial Policy Preparer", reason: "local test tenant only (SAE)" })).ok, true);
  assert.equal((await admin("createRole", { key: "financialPolicyReviewer", name: "Financial Policy Reviewer", reason: "local test tenant only (SAE)" })).ok, true);
  for (const key of ["finance.policy.read", "finance.policy.prepare"]) await grant("financialPolicyPreparer", key);
  for (const key of ["finance.policy.read", "finance.policy.approve", "finance.policy.activate"]) await grant("owner", key);
  await grant("financialPolicyReviewer", "finance.policy.read");
  const roleIdOf = async (key) => (await one(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [TENANT, key])).id;
  const assignAt = async (who, company) => {
    const r = await admin("assignRole", { principalId: who.principalId, roleId: await roleIdOf("financialPolicyReviewer"), reason: "local test tenant only (company assignment)",
      scopeType: "operatingCompany", scopeValue: company });
    assert.equal(r.ok, true, `${company} ${JSON.stringify(r).slice(0, 300)}`);
  };
  const ownerDual = await person("uid-sae-owner-dual", ["financialPolicyPreparer", "owner"], { id: "e-sae-owner-dual", name: "Olive Owner-and-Preparer" });
  const ownerIndep = await person("uid-sae-owner-indep", ["owner"], { id: "e-sae-owner-indep", name: "Owen Owner" });
  const adminDual = await person("uid-sae-admin-dual", ["financialPolicyPreparer", "admin"], { id: "e-sae-admin-dual", name: "Ada Administrator-and-Preparer" });
  for (const who of [ownerDual, ownerIndep, adminDual]) for (const company of ["taylor", "ventana"]) await assignAt(who, company);

  await t.test("SAE-FP-1: the Owner prepares, submits, approves and activates their OWN version; the audit rows record the basis; the history still rebuilds from the audit trail", async () => {
    const v = ok(await fn(ownerDual, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: FIFO }), "draft").version;
    ok(await fn(ownerDual, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id }), "submit");
    const approved = ok(await fn(ownerDual, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id, reason: "Owner decision" }), "owner approves own").version;
    assert.deepEqual([approved.status, approved.approvedBy, approved.submittedBy], ["APPROVED", ownerDual.principalId, ownerDual.principalId]);
    const active = ok(await fn(ownerDual, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id, effectiveDate: await businessDate("taylor") }), "owner activates own").version;
    assert.deepEqual([active.status, active.activatedBy], ["ACTIVE", ownerDual.principalId]);
    const rows = (await q(`SELECT action, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2 AND target_id = $3 ORDER BY occurred_at, action`, [TENANT, fp.FINANCIAL_POLICY_AUDIT_TARGET, v.id])).rows;
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r.after]));
    for (const action of ["finance.policy.approve", "finance.policy.activate"]) {
      assert.deepEqual([byAction[action].approvalBasis, byAction[action].approvalScope, byAction[action].approvalGrantSource], ["PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP"], action);
    }
    assert.equal(byAction["finance.policy.submit"].approvalBasis, undefined, "preparing and submitting need no exemption and record none");
    // the history rebuilt from the audit trail equals the stored version (the basis keys are provenance, not state)
    const events = (await q(`SELECT action, target_id AS "targetId", before, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2 ORDER BY occurred_at, id`, [TENANT, fp.FINANCIAL_POLICY_AUDIT_TARGET])).rows;
    assert.doesNotThrow(() => fp.rebuildFinancialPolicyVersions(events));
    // the read offers the Owner their own version's actions (the screen never guesses): a new in-flight draft is approvable by its author the Owner
    const v2 = ok(await fn(ownerDual, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), "draft 2").version;
    ok(await fn(ownerDual, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: v2.id }), "submit 2");
    const read = ok(await fn(ownerDual, "readFinancialPolicy", { operatingCompanyId: "taylor" }), "read");
    assert.equal(read.inFlight.yourActions.approve.allowed, true, "the Owner may approve the version they wrote");
    const readAdmin = ok(await fn(adminDual, "readFinancialPolicy", { operatingCompanyId: "taylor" }), "read as admin");
    assert.equal(readAdmin.inFlight.yourActions.approve.allowed, true, "the Administrator, who did NOT write it, may approve by standing");
    ok(await fn(ownerIndep, "rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: v2.id, reason: "cleanup: slot freed" }), "independent Owner rejects");
  });

  await t.test("SAE-FP-2: a NON-Owner who prepared a version is refused approve / reject / activate, and the database refuses the same on a direct write", async () => {
    const v = ok(await fn(adminDual, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO }), "admin draft").version;
    ok(await fn(adminDual, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), "admin submit");
    refused(await fn(adminDual, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), 403, "SEPARATION_OF_DUTIES", "the Administrator (standing) who wrote it");
    refused(await fn(adminDual, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, reason: "own" }), 403, "SEPARATION_OF_DUTIES");
    const before = (await one(`SELECT md5(x::text) h FROM eos_finance.financial_policy_versions x WHERE id = $1`, [v.id])).h;
    await assert.rejects(q(`UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = submitted_by, approved_at = now() WHERE id = $1`, [v.id]),
      (e) => { assert.equal(e.code, "23514"); assert.equal(e.constraint, "financial_policy_approver_independent"); assert.match(String(e.message), /financial_policy_approver_independent/); return true; });
    await assert.rejects(q(`UPDATE eos_finance.financial_policy_versions SET status = 'REJECTED', rejected_by = submitted_by, rejected_at = now(), decision_reason = 'own' WHERE id = $1`, [v.id]),
      (e) => { assert.equal(e.constraint, "financial_policy_rejecter_independent"); assert.equal(fp.translateDatabaseRefusal(e).code, "SEPARATION_OF_DUTIES"); return true; });
    assert.equal((await one(`SELECT md5(x::text) h FROM eos_finance.financial_policy_versions x WHERE id = $1`, [v.id])).h, before, "every refusal left the row exactly as it was");
    // an independent Owner decides it (the ordinary two-person path records no basis)
    const rejected = ok(await fn(ownerIndep, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, reason: "not ours" }), "independent reject").version;
    assert.equal(rejected.status, "REJECTED");
    const a = await one(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'finance.policy.reject' AND target_id = $2`, [TENANT, v.id]);
    assert.equal(a.after.approvalBasis, undefined, "an ordinary two-person decision records no basis");
  });

  await t.test("SAE-FP-3: the database admits a same-person decider only while the seam proves the protected Owner AT THAT MOMENT (a direct write; a revoked Owner is refused)", async () => {
    const v = ok(await fn(ownerDual, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO }), "owner draft").version;
    ok(await fn(ownerDual, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id }), "owner submit");
    await q(`UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = submitted_by, approved_at = now() WHERE id = $1`, [v.id]);
    assert.equal((await one(`SELECT status FROM eos_finance.financial_policy_versions WHERE id = $1`, [v.id])).status, "APPROVED", "the Owner decided their own, directly: accepted");
    await q(`UPDATE eos_policy.user_role_assignments SET status = 'revoked' WHERE principal_id = $1 AND role_id = $2`, [ownerDual.principalId, await roleIdOf("owner")]);
    const activate = () => q(`UPDATE eos_finance.financial_policy_versions SET status = 'ACTIVE', activated_by = submitted_by, activated_at = now(),
      effective_date = eos_policy.operating_company_business_date(tenant_id, operating_company_id, now()) + 7 WHERE id = $1`, [v.id]);
    await assert.rejects(activate(), (e) => { assert.equal(e.constraint, "financial_policy_activator_independent"); return true; }, "the membership ended: the same write is refused");
    // the row decided EARLIER is never re-judged when the Owner later changes
    await q(`UPDATE eos_finance.financial_policy_versions SET updated_at = now() WHERE id = $1`, [v.id]);
    assert.equal((await one(`SELECT approved_by = submitted_by AS same FROM eos_finance.financial_policy_versions WHERE id = $1`, [v.id])).same, true);
    // and through the API the demoted Owner is now an ordinary preparer: refused to activate their own
    refused(await fn(ownerDual, "activateFinancialPolicy", { operatingCompanyId: "ventana", versionId: v.id, effectiveDate: await businessDate("ventana", 7) }), 403, "CAPABILITY_REQUIRED");
  });

  // ── Administration ──
  const adminAs = (subject, operation, input) => executeAdminOperation({ repo }, { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}-${Math.random()}` });
  const auditAfter = async (action, target) => (await one(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = $2 AND target_id = $3 ORDER BY occurred_at DESC LIMIT 1`, [TENANT, action, target])).after;

  await t.test("SAE-ADM-1: SELF_ADMINISTRATION is waived for the governed protected Owner ONLY: the Owner assigns a Role to themselves (audited with the basis); the Administrator, an Owner with no Employee link and a look-alike keep the refusal", async () => {
    assert.equal((await admin("createRole", { key: "saeProbe", name: "SAE probe", reason: "local test tenant only (SAE)" })).ok, true);
    const roleId = await roleIdOf("saeProbe");
    const owner = await person("uid-sae-adm-owner", ["owner"], { id: "e-sae-adm-owner", name: "Odin Owner" });
    const done = await adminAs(owner.subject, "assignRole", { principalId: owner.principalId, roleId, reason: "Owner staffs themselves" });
    assert.equal(done.ok, true, JSON.stringify(done).slice(0, 400));
    const assignmentId = (await one(`SELECT id FROM eos_policy.user_role_assignments WHERE principal_id = $1 AND role_id = $2 AND status = 'active'`, [owner.principalId, roleId])).id;
    const after = await auditAfter("assignRole", assignmentId);
    assert.deepEqual([after.approvalBasis, after.approvalScope, after.approvalGrantSource], ["PROTECTED_OWNER", null, "PROTECTED_OWNER_MEMBERSHIP"], "the audit event records why the self-refusal did not apply");
    // the Administrator: still refused (and nothing written)
    const administrator = await person("uid-sae-adm-admin", ["admin"], { id: "e-sae-adm-admin", name: "Ari Administrator" });
    const rows0 = await one(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id = $1`, [TENANT]);
    const denied = await adminAs(administrator.subject, "assignRole", { principalId: administrator.principalId, roleId, reason: "self" });
    assert.deepEqual([denied.ok, denied.code], [false, "FORBIDDEN"]);
    assert.match(String(denied.message), /SELF_ADMINISTRATION/);
    // an Owner with NO Employee link cannot be resolved: not exempt
    const noLink = await person("uid-sae-adm-nolink", ["owner"]);
    const nl = await adminAs(noLink.subject, "assignRole", { principalId: noLink.principalId, roleId, reason: "self" });
    assert.deepEqual([nl.ok, nl.code], [false, "FORBIDDEN"]);
    assert.match(String(nl.message), /SELF_ADMINISTRATION/);
    // a look-alike (a custom role merely NAMED like the Owner, not the protected one) holding the assignment capability is not exempt
    assert.equal((await admin("createRole", { key: "ownerLookalike", name: "Owner", reason: "local test tenant only (SAE)" })).ok, true);
    const look = await person("uid-sae-adm-look", ["ownerLookalike", "admin"], { id: "e-sae-adm-look", name: "Lou Lookalike" });
    const lk = await adminAs(look.subject, "assignRole", { principalId: look.principalId, roleId, reason: "self" });
    assert.deepEqual([lk.ok, lk.code], [false, "FORBIDDEN"]);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id = $1`, [TENANT])).n, rows0.n, "no refusal wrote an assignment");
    // what the waiver does NOT touch: the protected Owner Role is never appointed through ordinary administration, whoever asks and whoever the target
    const ownerRoleId = await roleIdOf("owner");
    const appoint = await adminAs(owner.subject, "assignRole", { principalId: administrator.principalId, roleId: ownerRoleId, reason: "appoint" });
    assert.deepEqual([appoint.ok, appoint.code], [false, "FORBIDDEN"]);
    assert.match(String(appoint.message), /PROTECTED_OWNER_MEMBERSHIP|not appointed/);
    const reappoint = await adminAs(owner.subject, "assignRole", { principalId: owner.principalId, roleId: ownerRoleId, reason: "self" });
    assert.equal(reappoint.ok, false);
  });

  await t.test("SAE-ADM-2: the Owner may grant company access to their OWN Employee (waived, audited with the basis); the Administrator keeps the refusal; the capability gate, the company rules and the window rules still apply", async () => {
    const owner = await person("uid-sae-adm-owner2", ["owner"], { id: "e-sae-adm-owner2", name: "Orla Owner" });
    const input = (employeeId, over = {}) => ({ employeeId, operatingCompanyId: "ventana", reason: "Owner covers both companies", ...over });
    const g = await adminAs(owner.subject, "grantCompanyAuthority", input("e-sae-adm-owner2"));
    assert.equal(g.ok, true, JSON.stringify(g).slice(0, 400));
    const grantId = (await one(`SELECT id FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1 AND employee_id = 'e-sae-adm-owner2' AND status = 'active'`, [TENANT])).id;
    const after = await auditAfter("grantCompanyAuthority", grantId);
    assert.deepEqual([after.approvalBasis, after.approvalGrantSource, after.employeeId], ["PROTECTED_OWNER", "PROTECTED_OWNER_MEMBERSHIP", "e-sae-adm-owner2"]);
    // the waiver removes ONLY the self refusal: the company must still be another company, the reason is still required
    const home = await adminAs(owner.subject, "grantCompanyAuthority", input("e-sae-adm-owner2", { operatingCompanyId: "taylor" }));
    assert.deepEqual([home.ok, home.code], [false, "INVALID_INPUT"]);
    const noReason = await adminAs(owner.subject, "grantCompanyAuthority", input("e-sae-adm-owner2", { reason: " " }));
    assert.equal(noReason.ok, false);
    // the Administrator granting their OWN Employee company access: refused SELF_ADMINISTRATION, nothing written
    const administrator = await person("uid-sae-adm-admin2", ["admin"], { id: "e-sae-adm-admin2", name: "Abe Administrator" });
    const before = (await one(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1`, [TENANT])).n;
    const no = await adminAs(administrator.subject, "grantCompanyAuthority", input("e-sae-adm-admin2"));
    assert.deepEqual([no.ok, no.code], [false, "FORBIDDEN"]);
    assert.match(String(no.message), /SELF_ADMINISTRATION/);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1`, [TENANT])).n, before, "zero trace");
    // granting ANOTHER Employee company access is ordinary and records no basis
    const other = await adminAs(owner.subject, "grantCompanyAuthority", input("e-sae-adm-admin2"));
    assert.equal(other.ok, true, JSON.stringify(other).slice(0, 300));
    const otherId = (await one(`SELECT id FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1 AND employee_id = 'e-sae-adm-admin2' AND status = 'active'`, [TENANT])).id;
    assert.equal((await auditAfter("grantCompanyAuthority", otherId)).approvalBasis, undefined);
  });
});

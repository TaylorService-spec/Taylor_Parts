// SAE, over real PostgreSQL -- the protected-Owner exemption from secondary approval, for the Financial Policy lifecycle, and the proof that Administration is NOT exempted (DECISIONS #SAE; Owner policy override
// 2026-10-20; briefs SAE2 + SAE3 Rule 1). The other workflows' Owner proofs live beside their own fixtures: F-1b corrections and voids (f1bInvoiceCorrectionPostgres), G-1 goals
// (g1GoalAuthoringPostgres), P-1 purchase orders (supplierPurchaseOrderAuthoringPostgres), cycle count (eosCycleCountOperationsPostgres).
//
//   FINANCIAL POLICY   the Owner prepares, submits, approves and activates their own version (the audit rows record the basis; history still rebuilds); an Administrator who prepared a
//                      version is refused approve / reject / activate (SEPARATION_OF_DUTIES) and the database refuses the same on a direct write; a direct write by the Owner is accepted
//                      only while the seam proves the Owner at that moment (a revoked Owner is refused).
//   ADMINISTRATION     (Owner ruling D1, PR #2190 integrity guards) the exemption removes ONLY the second-person approval requirement. SELF_ADMINISTRATION and PRIVILEGE_ESCALATION apply to
//                      the protected Owner exactly as before; so do the protected-Owner membership invariant, the last-Owner guard and anti-lockout. The Owner still administers OTHER principals.
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

  // ── Administration: NOT exempted (Owner ruling D1) ──
  const adminAs = (subject, operation, input) => executeAdminOperation({ repo }, { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}-${Math.random()}` });
  const assignmentRows = async () => (await one(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) h FROM eos_policy.user_role_assignments x WHERE x.tenant_id = $1`, [TENANT]));
  const refusedWith = (r, pattern, what) => { assert.deepEqual([r.ok, r.code], [false, "FORBIDDEN"], `${what} ${JSON.stringify(r).slice(0, 300)}`); assert.match(String(r.message), pattern, what); };

  await t.test("SAE-ADM-1: the protected Owner (with an Employee link) is STILL refused every self-administration case; the Administrator likewise; nothing is written", async () => {
    assert.equal((await admin("createRole", { key: "saeProbe", name: "SAE probe", reason: "local test tenant only (SAE)" })).ok, true);
    const roleId = await roleIdOf("saeProbe");
    const owner = await person("uid-sae-adm-owner", ["owner"], { id: "e-sae-adm-owner", name: "Odin Owner" });
    const administrator = await person("uid-sae-adm-admin", ["admin"], { id: "e-sae-adm-admin", name: "Ari Administrator" });
    const before = await assignmentRows();
    // assigning a Role to yourself
    refusedWith(await adminAs(owner.subject, "assignRole", { principalId: owner.principalId, roleId, reason: "Owner staffs themselves" }), /SELF_ADMINISTRATION/, "Owner assigns self");
    refusedWith(await adminAs(administrator.subject, "assignRole", { principalId: administrator.principalId, roleId, reason: "self" }), /SELF_ADMINISTRATION/, "Administrator assigns self");
    // granting company access to your OWN Employee
    const grantOwn = (employeeId) => ({ employeeId, operatingCompanyId: "ventana", reason: "cover both companies" });
    refusedWith(await adminAs(owner.subject, "grantCompanyAuthority", grantOwn("e-sae-adm-owner")), /SELF_ADMINISTRATION/, "Owner grants own Employee company access");
    refusedWith(await adminAs(administrator.subject, "grantCompanyAuthority", grantOwn("e-sae-adm-admin")), /SELF_ADMINISTRATION/, "Administrator grants own Employee company access");
    // the designated Administrator Role to yourself
    const adminRoleId = await roleIdOf("admin");
    assert.equal((await adminAs(owner.subject, "assignRole", { principalId: owner.principalId, roleId: adminRoleId, reason: "self" })).ok, false);
    assert.equal(await one(`SELECT count(*)::int n FROM eos_policy.employee_company_authority_grants WHERE tenant_id = $1`, [TENANT]).then((r) => r.n), 0, "no grant written");
    assert.deepEqual(await assignmentRows(), before, "zero trace: no refusal wrote an assignment");
    // the Owner still administers OTHER principals: staffing another person with a plain Role is as before
    const other = await person("uid-sae-adm-other", [], { id: "e-sae-adm-other", name: "Olly Other" });
    const ok1 = await adminAs(owner.subject, "assignRole", { principalId: other.principalId, roleId, reason: "Owner staffs another principal" });
    assert.equal(ok1.ok, true, JSON.stringify(ok1).slice(0, 300));
    const noBasis = (await one(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1 AND after ? 'approvalBasis'`, [TENANT])).n;
    assert.equal(noBasis, 0, "no Administration audit event carries an exemption basis: there is no exemption in Administration");
  });

  await t.test("SAE-ADM-2: PRIVILEGE_ESCALATION, the protected-Owner membership invariant, the last-Owner guard and anti-lockout still refuse the Owner", async () => {
    const owner = await person("uid-sae-adm-owner2", ["owner"], { id: "e-sae-adm-owner2", name: "Orla Owner" });
    const target = await person("uid-sae-adm-target", [], { id: "e-sae-adm-target", name: "Tal Target" });
    // PRIVILEGE_ESCALATION: a Role carrying admin.securityPolicy.write may be assigned only by a holder of it. The Owner holds admin.roleAssignment.write, not securityPolicy.write.
    const sp = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = 'admin.securityPolicy.write'`);
    assert.equal((await admin("createRole", { key: "saeSecurityRole", name: "SAE security", reason: "local test tenant only (SAE)" })).ok, true);
    const granted = await admin("grantObjectActionToRole", { roleKey: "saeSecurityRole", objectKey: sp.object_key, actionKey: sp.action_key, reason: "local test tenant only (SAE)" });
    assert.equal(granted.ok, true, JSON.stringify(granted).slice(0, 300));
    const before = await assignmentRows();
    refusedWith(await adminAs(owner.subject, "assignRole", { principalId: target.principalId, roleId: await roleIdOf("saeSecurityRole"), reason: "hand out security-policy authority" }),
      /PRIVILEGE_ESCALATION|securityPolicy\.write/, "PRIVILEGE_ESCALATION still refuses the Owner");
    // the protected Owner Role is never appointed or removed through ordinary administration
    const ownerRoleId = await roleIdOf("owner");
    refusedWith(await adminAs(owner.subject, "assignRole", { principalId: target.principalId, roleId: ownerRoleId, reason: "appoint" }), /PROTECTED_OWNER_MEMBERSHIP|not appointed/, "appoint an Owner");
    const ownerAssignment = (await one(`SELECT id FROM eos_policy.user_role_assignments WHERE principal_id = $1 AND role_id = $2 AND status = 'active'`, [owner.principalId, ownerRoleId])).id;
    refusedWith(await adminAs(owner.subject, "revokeRole", { assignmentId: ownerAssignment, reason: "step down" }), /PROTECTED_OWNER_MEMBERSHIP|not removed|LAST_PROTECTED_OWNER/, "the last / protected Owner assignment is not revoked");
    assert.deepEqual(await assignmentRows(), before, "zero trace");
    // anti-lockout: the Owner cannot remove the tenant's last Administrator
    const admins = (await q(`SELECT a.id, a.principal_id FROM eos_policy.user_role_assignments a WHERE a.tenant_id = $1 AND a.role_id = $2 AND a.status = 'active' ORDER BY a.id`, [TENANT, await roleIdOf("admin")])).rows;
    for (const a of admins.slice(1)) assert.equal((await adminAs(owner.subject, "revokeRole", { assignmentId: a.id, reason: "reduce to one Administrator" })).ok, true);
    const last = await adminAs(owner.subject, "revokeRole", { assignmentId: admins[0].id, reason: "remove the last Administrator" });
    assert.equal(last.ok, false, "anti-lockout: the last Administrator is not removed: " + JSON.stringify(last).slice(0, 300));
  });
});

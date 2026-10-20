// SAE Rule 2, over real PostgreSQL -- the DELEGATED self-approval exemption (DECISIONS #SAE-2; Owner direction SAE3; controller decisions Q1-Q3; Owner ruling D3).
//
//   FAMILY        seven keys on ONE Object, registered with NO grants.
//   ADMINISTRATION  ONLY the verified protected Owner grants / revokes a key (to a Role or directly to a Principal) and staffs a Role that carries one; the Administrator -- who holds
//                 admin.securityPolicy.write -- is refused with ZERO trace; the preview is gated the same way; every grant / revoke is ONE audited decision and takes effect on the next call;
//                 the Owner is still refused SELF_ADMINISTRATION for a Role they hold or themselves (D1).
//   SEAM          the SQL proof (eos_policy.has_delegated_self_approval_exemption / is_delegated_exempt_employee) and the TypeScript seam agree for role grants, direct grants, the
//                 all-workflows key, a wrong-scope key, an expired grant, a disabled assignment, a missing / terminated / relinked Employee and a role merely NAMED like a key; the SQL never
//                 answers NULL.
//   FINANCIAL POLICY  a delegated Financials grantee decides their own version (basis DELEGATED_EXEMPTION + source in the audit; the history still rebuilds); a Purchasing-only grantee and an
//                 unflagged Administrator are refused; the database agrees on a direct write; a revoke is immediate.
//   D3            a delegated grantee who is an Administrator is STILL refused SELF_ADMINISTRATION, still cannot grant the family onward, still holds no business capability from the key.
// The F-1b, G-1, P-1 and cycle-count delegated proofs live beside their fixtures (f1bInvoiceCorrectionPostgres, g1GoalAuthoringPostgres, supplierPurchaseOrderAuthoringPostgres).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";
import { FIELD_GROUPS } from "./support/authorityPreviewFixture.mjs";

const require = createRequire(import.meta.url);
const fp = require("../lib/eosFinance/financialPolicy.js");
const core = require("../lib/access/secondaryApprovalExemptionCore.js");
const seam = require("../lib/access/secondaryApprovalExemption.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { createAuthorityChangePreview } = require("../lib/eosOps/authorityChangePreview.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-sae2-pg";
const FIN = "/operations/finance";
const OBJECT = "selfApprovalExemption";
const KEYS = Object.values(core.SELF_APPROVAL_EXEMPT_KEYS);
const FIFO = Object.freeze({ inventoryCostMethod: "FIFO", serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION", cogsRecognitionPointId: "INVOICE_ISSUE", freightTreatment: "EXCLUDED", landedCostTreatment: "EXCLUDED" });
const WA = Object.freeze({ ...FIFO, inventoryCostMethod: "WEIGHTED_AVERAGE", cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT" });
const SITE_OF = { FINANCIALS: "finance.invoiceCorrection", PURCHASING: "purchasing.supplierPurchaseOrder", INVENTORY: "inventory.cycleCount", GOALS: "goals.performanceGoal" };

test("SAE Rule 2: the delegated self-approval exemption over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person: staff, pool, call, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "sae2pg" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const fn = (who, operation, input) => call(who, FIN, operation, input);
  const simulator = createAuthorityChangePreview({ pool, fieldGroups: FIELD_GROUPS });
  const adminAs = (subject, operation, input) => executeAdminOperation({ repo, previewAuthorityChange: simulator },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}-${Math.random()}` });
  const businessDate = async (company, plusDays = 0) => (await one(`SELECT (eos_policy.operating_company_business_date($1, $2, now()) + $3::int)::text AS d`, [TENANT, company, plusDays])).d;
  const roleIdOf = async (key) => (await one(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [TENANT, key])).id;

  const person = async (subject, roleKeys, employee) => {
    const who = await staff(subject, roleKeys.filter((k) => k !== "owner"), employee);
    if (roleKeys.includes("owner")) await seedProtectedOwner(repo, { tenantId: TENANT, principalId: who.principalId });
    return who;
  };

  // ── the Financial Policy fixture (as the foundation suite): a Preparer Role, a Reviewer Role for company reach, the Owner's reserved approve / activate ──
  const grantAsFixture = async (roleKey, key) => {
    const c = await one(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key]);
    const r = await admin("grantObjectActionToRole", { roleKey, objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only (SAE-2)" });
    assert.equal(r.ok, true, `${roleKey} ${key} ${JSON.stringify(r).slice(0, 300)}`);
  };
  for (const key of ["financialPolicyPreparer", "financialPolicyReviewer", "saeFinLead", "saePurchLead", "saeAllLead", "exemptFinancials"]) {
    assert.equal((await admin("createRole", { key, name: key, reason: "local test tenant only (SAE-2)" })).ok, true, key);
  }
  for (const key of ["finance.policy.read", "finance.policy.prepare"]) await grantAsFixture("financialPolicyPreparer", key);
  for (const key of ["finance.policy.read", "finance.policy.approve", "finance.policy.activate"]) await grantAsFixture("owner", key);
  await grantAsFixture("financialPolicyReviewer", "finance.policy.read");
  const assignAt = async (who, company) => {
    const r = await admin("assignRole", { principalId: who.principalId, roleId: await roleIdOf("financialPolicyReviewer"), reason: "local test tenant only (company assignment)", scopeType: "operatingCompany", scopeValue: company });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  };

  const owner = await person("uid-sae2-owner", ["owner"], { id: "e-sae2-owner", name: "Odin Owner" });
  const adminDual = await person("uid-sae2-admin", ["admin", "financialPolicyPreparer"], { id: "e-sae2-admin", name: "Ada Admin-and-Preparer" });
  const adminPlain = await person("uid-sae2-admin-plain", ["admin", "financialPolicyPreparer"], { id: "e-sae2-admin-plain", name: "Abe Admin-and-Preparer" });
  const ownerIndep = await person("uid-sae2-owner2", ["owner"], { id: "e-sae2-owner2", name: "Owen Owner" });
  for (const who of [adminDual, adminPlain, ownerIndep]) for (const company of ["taylor", "ventana"]) await assignAt(who, company);
  const finUser = await person("uid-sae2-fin", ["saeFinLead"], { id: "e-sae2-fin", name: "Fin Lead" });
  const purchUser = await person("uid-sae2-purch", ["saePurchLead"], { id: "e-sae2-purch", name: "Pat Purchasing" });
  const allUser = await person("uid-sae2-all", ["saeAllLead"], { id: "e-sae2-all", name: "Al Allworkflows" });
  const directUser = await person("uid-sae2-direct", [], { id: "e-sae2-direct", name: "Dee Direct" });
  const plainUser = await person("uid-sae2-plain", [], { id: "e-sae2-plain", name: "Pia Plain" });
  const noEmployee = await person("uid-sae2-noemp", ["saeFinLead"]);
  const terminated = await person("uid-sae2-term", ["saeFinLead"], { id: "e-sae2-term", name: "Tom Terminated", status: "TERMINATED" });
  const lookalike = await person("uid-sae2-look", ["exemptFinancials"], { id: "e-sae2-look", name: "Lou Lookalike" });

  const grantRows = () => count(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = ANY($1)`, [KEYS]);
  const directRows = () => count(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = ANY($1)`, [KEYS]);
  const auditRows = () => count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1 AND action IN ('grantObjectActionToRole','revokeObjectActionFromRole','grantObjectActionToPrincipal','revokeObjectActionFromPrincipal','assignRole')`, [TENANT]);
  const traces = async () => ({ roles: await grantRows(), direct: await directRows(), audits: await auditRows(), assignments: await count(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id = $1`, [TENANT]) });
  const grantRole = (who, roleKey, scope) => adminAs(who.subject, "grantObjectActionToRole", { roleKey, objectKey: OBJECT, actionKey: core.SELF_APPROVAL_EXEMPT_ACTIONS[scope], reason: "SAE-2 proof" });
  const revokeRole = (who, roleKey, scope) => adminAs(who.subject, "revokeObjectActionFromRole", { roleKey, objectKey: OBJECT, actionKey: core.SELF_APPROVAL_EXEMPT_ACTIONS[scope], reason: "SAE-2 proof" });
  const grantDirect = (who, target, scope, extra = {}) => adminAs(who.subject, "grantObjectActionToPrincipal", { principalId: target.principalId, objectKey: OBJECT, actionKey: core.SELF_APPROVAL_EXEMPT_ACTIONS[scope], reason: "SAE-2 proof", ...extra });
  const revokeDirect = (who, target, scope) => adminAs(who.subject, "revokeObjectActionFromPrincipal", { principalId: target.principalId, objectKey: OBJECT, actionKey: core.SELF_APPROVAL_EXEMPT_ACTIONS[scope], reason: "SAE-2 proof" });
  const sqlHas = async (who, scope) => (await one(`SELECT eos_policy.has_delegated_self_approval_exemption($1, $2, $3) AS b`, [TENANT, who.principalId, scope])).b;
  const tsGrants = (who) => seam.delegatedExemptionGrants(pool, TENANT, who.principalId);

  await t.test("FAMILY: seven capabilities on one Object, BUSINESS_ACTION, registered with NO grants; the Administrator holds none by standing; descriptions say the grant is global and confers only the exemption", async () => {
    const rows = (await q(`SELECT key, object_key, action_key, action_kind, description FROM eos_policy.capabilities WHERE key = ANY($1) ORDER BY key`, [KEYS])).rows;
    assert.equal(rows.length, 7);
    assert.ok(rows.every((r) => r.object_key === OBJECT && r.action_kind === "BUSINESS_ACTION"));
    assert.deepEqual(rows.map((r) => r.action_key).sort(), Object.values(core.SELF_APPROVAL_EXEMPT_ACTIONS).sort());
    for (const r of rows) {
      assert.match(r.description, /ALL operating companies until company scope ships/, r.key);
      assert.match(r.description, /ONLY the second-person exemption/, r.key);
      assert.match(r.description, /ONLY the governed protected Owner/, r.key);
    }
    assert.deepEqual([await grantRows(), await directRows()], [0, 0], "no Role and no Principal holds a key");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE capability_key = ANY($1)`, [KEYS]), 0);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.objects WHERE tenant_id = $1 AND key = $2`, [TENANT, OBJECT]), 1, "the Object is seeded");
    for (const who of [adminDual, owner, plainUser]) {
      const r = await seam.resolveSecondaryApprovalExemption(pool, TENANT, who.principalId, "finance.policy");
      assert.equal(r.basis ?? "none", who === owner ? "PROTECTED_OWNER" : "none", "before any grant nobody but the Owner is exempt (the Administrator's standing supplies no family key)");
    }
  });

  await t.test("ADMIN-1 OWNER-ONLY: the Administrator is refused every grant, revoke and staffing of the family with ZERO trace; the Owner grants to a Role and directly, one audited decision each", async () => {
    const before = await traces();
    const denied = [
      await grantRole(adminDual, "saeFinLead", "FINANCIALS"), await grantRole(adminDual, "saeFinLead", "ALL"),
      await revokeRole(adminDual, "saeFinLead", "FINANCIALS"),
      await grantDirect(adminDual, directUser, "FINANCIALS"), await revokeDirect(adminDual, directUser, "FINANCIALS"),
      await grantDirect(adminDual, adminDual, "ALL"), // an Administrator granting THEMSELVES the exemption
    ];
    for (const r of denied) {
      assert.deepEqual([r.ok, r.code], [false, "FORBIDDEN"], JSON.stringify(r).slice(0, 300));
      assert.match(String(r.message), /only the governed protected Owner/);
    }
    assert.deepEqual(await traces(), before, "zero trace: no grant, no assignment, no audit row");
    // the Owner: a Role grant, a direct grant, with an audit row each
    const g1 = await grantRole(owner, "saeFinLead", "FINANCIALS");
    assert.equal(g1.ok, true, JSON.stringify(g1).slice(0, 400));
    assert.equal((await grantRole(owner, "saePurchLead", "PURCHASING")).ok, true);
    assert.equal((await grantRole(owner, "saeAllLead", "ALL")).ok, true);
    const g2 = await grantDirect(owner, directUser, "FINANCIALS");
    assert.equal(g2.ok, true, JSON.stringify(g2).slice(0, 400));
    assert.deepEqual(await traces(), { ...before, roles: before.roles + 3, direct: before.direct + 1, audits: before.audits + 4 }, "four grants, four audit rows");
    const audit = await one(`SELECT actor_uid, action, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'grantObjectActionToRole' ORDER BY occurred_at LIMIT 1`, [TENANT]);
    assert.equal(audit.actor_uid, owner.principalId);
    assert.equal(audit.after.capabilityKey, "approval.selfApproval.exemptFinancials");
    assert.equal(audit.after.granteeKey, "saeFinLead");
    // staffing: the Administrator cannot hand the exemption out through a Role that carries it; the Owner can
    const roleId = await roleIdOf("saeFinLead");
    const stuck = await adminAs(adminDual.subject, "assignRole", { principalId: plainUser.principalId, roleId, reason: "staffing" });
    assert.deepEqual([stuck.ok, stuck.code], [false, "FORBIDDEN"]);
    assert.match(String(stuck.message), /only the governed protected Owner/);
    const staffed = await adminAs(owner.subject, "assignRole", { principalId: plainUser.principalId, roleId, reason: "Owner staffs a Financials-exempt Role" });
    assert.equal(staffed.ok, true, JSON.stringify(staffed).slice(0, 300));
    // ... and removing an assignment only reduces authority: the ordinary gate applies as before
    const aid = (await one(`SELECT id FROM eos_policy.user_role_assignments WHERE principal_id = $1 AND role_id = $2 AND status = 'active'`, [plainUser.principalId, roleId])).id;
    assert.equal((await adminAs(adminDual.subject, "revokeRole", { assignmentId: aid, reason: "staffing change" })).ok, true, "an Administrator may still end an assignment");
  });

  await t.test("ADMIN-2 D1: the Owner is STILL refused SELF_ADMINISTRATION -- granting the exemption to a Role they hold or to themselves -- and nothing is written", async () => {
    const before = await traces();
    const toHeldRole = await grantRole(owner, "owner", "FINANCIALS");
    assert.deepEqual([toHeldRole.ok, toHeldRole.code], [false, "FORBIDDEN"]);
    assert.match(String(toHeldRole.message), /SELF_ADMINISTRATION|may not grant a capability to a Role it holds/);
    const toSelf = await grantDirect(owner, owner, "ALL");
    assert.deepEqual([toSelf.ok, toSelf.code], [false, "FORBIDDEN"]);
    assert.match(String(toSelf.message), /SELF_ADMINISTRATION|may not .* itself/);
    assert.deepEqual(await traces(), before, "zero trace");
    // a grant may not carry a condition: the family is not conditionable (CONDITIONABLE_GRANTS), so the exemption is never narrowed by a path the seam does not evaluate
    const conditioned = await adminAs(owner.subject, "grantObjectActionToRole", { roleKey: "saeAllLead", objectKey: OBJECT, actionKey: "exemptGoals", reason: "conditioned",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } });
    assert.equal(conditioned.ok, false, JSON.stringify(conditioned).slice(0, 300));
    assert.deepEqual(await traces(), before, "a refused conditioned grant leaves no trace");
  });

  await t.test("ADMIN-3 PREVIEW: previewAuthorityChange of a family grant is gated on the Owner (the Administrator is FORBIDDEN, nothing simulated); the Owner's preview would apply and leaves no trace", async () => {
    const change = { operation: "grantObjectActionToRole", input: { roleKey: "saePurchLead", objectKey: OBJECT, actionKey: "exemptGoals", reason: "preview" } };
    const before = await traces();
    const denied = await adminAs(adminDual.subject, "previewAuthorityChange", { change });
    assert.deepEqual([denied.ok, denied.code], [false, "FORBIDDEN"]);
    const preview = await adminAs(owner.subject, "previewAuthorityChange", { change });
    assert.equal(preview.ok, true, JSON.stringify(preview).slice(0, 500));
    assert.equal(preview.data.outcome, "WOULD_APPLY");
    assert.deepEqual(await traces(), before, "a preview leaves no trace");
    // an ordinary change keeps its ordinary gate: the Administrator previews it, the Owner (no admin.securityPolicy.write) is FORBIDDEN
    const ordinary = { operation: "grantObjectActionToRole", input: { roleKey: "saePurchLead", objectKey: "workOrder", actionKey: "read", reason: "preview" } };
    assert.equal((await adminAs(adminDual.subject, "previewAuthorityChange", { change: ordinary })).ok, true);
    assert.deepEqual((({ ok, code }) => [ok, code])(await adminAs(owner.subject, "previewAuthorityChange", { change: ordinary })), [false, "FORBIDDEN"]);
  });

  await t.test("SEAM PARITY: the SQL proof and the TypeScript seam agree for role grants, a direct grant, the all key, a wrong-scope key, no Employee, a terminated Employee, a look-alike role; the SQL never answers NULL", async () => {
    const people = { finUser, purchUser, allUser, directUser, plainUser, noEmployee, terminated, lookalike, adminDual, owner };
    const scopes = ["FINANCIALS", "PURCHASING", "SALES", "INVENTORY", "SERVICE", "GOALS"];
    const expectOf = (label, scope) => ({
      finUser: scope === "FINANCIALS", purchUser: scope === "PURCHASING", allUser: true, directUser: scope === "FINANCIALS",
      plainUser: false, noEmployee: false, terminated: false, lookalike: false, adminDual: false, owner: false, // the Owner is exempt by Rule 1, not by a grant
    })[label];
    for (const [label, who] of Object.entries(people)) {
      for (const scope of scopes) {
        const sql = await sqlHas(who, scope);
        assert.equal(typeof sql, "boolean", `${label}/${scope}: never NULL`);
        // plainUser was staffed with saeFinLead earlier and then had the assignment revoked, so it holds nothing
        assert.equal(sql, expectOf(label, scope), `${label}/${scope}`);
        const ts = (await tsGrants(who)).some((g) => g.scopeKey === scope || g.scopeKey === "ALL") && (await one(`SELECT eos_policy.eligible_employee_of($1, $2) AS e`, [TENANT, who.principalId])).e !== null;
        assert.equal(ts, sql, `${label}/${scope}: the two seams agree`);
        if (SITE_OF[scope] && label !== "owner") {
          const r = await seam.resolveSecondaryApprovalExemption(pool, TENANT, who.principalId, SITE_OF[scope]);
          assert.equal(r.exempt, sql, `${label}/${scope}: the resolved seam agrees`);
          if (r.exempt) assert.deepEqual([r.basis, r.scopeKey], ["DELEGATED_EXEMPTION", scope]);
        }
      }
    }
    for (const bad of ["", "ALL", "financials", "BOGUS", null]) assert.equal((await one(`SELECT eos_policy.has_delegated_self_approval_exemption($1, $2, $3) AS b`, [TENANT, allUser.principalId, bad])).b, false, `scope ${bad}`);
    assert.equal((await one(`SELECT eos_policy.has_delegated_self_approval_exemption($1, $2, 'GOALS') AS b`, [TENANT, "no-such-principal"])).b, false);
    assert.equal((await one(`SELECT eos_policy.is_delegated_exempt_employee($1, $2, NULL, 'GOALS') AS b`, [TENANT, allUser.principalId])).b, false, "a NULL employee is FALSE, not NULL");
    assert.equal((await one(`SELECT eos_policy.is_delegated_exempt_employee($1, $2, 'e-sae2-all', 'GOALS') AS b`, [TENANT, allUser.principalId])).b, true);
    assert.equal((await one(`SELECT eos_policy.is_delegated_exempt_employee($1, $2, 'e-someone-else', 'GOALS') AS b`, [TENANT, allUser.principalId])).b, false);
    // sources are recorded
    assert.deepEqual((await tsGrants(finUser)).map((g) => g.source), ["role:saeFinLead"]);
    assert.match((await tsGrants(directUser))[0].source, /^direct:/);
  });

  await t.test("SEAM LIFECYCLE: a revoke takes effect on the NEXT call; an expired direct grant, a disabled assignment, a scoped assignment and a relinked Employee confer nothing", async () => {
    const before = await sqlHas(directUser, "FINANCIALS");
    assert.equal(before, true);
    const rev = await revokeDirect(owner, directUser, "FINANCIALS");
    assert.equal(rev.ok, true, JSON.stringify(rev).slice(0, 300));
    assert.equal(await sqlHas(directUser, "FINANCIALS"), false, "revoked: immediate");
    assert.deepEqual(await tsGrants(directUser), []);
    // an expiring direct grant
    const soon = await grantDirect(owner, directUser, "GOALS", { expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(soon.ok, true, JSON.stringify(soon).slice(0, 300));
    assert.equal(await sqlHas(directUser, "GOALS"), true);
    await q(`UPDATE eos_policy.principal_capabilities SET expires_at = now() - interval '1 minute' WHERE tenant_id = $1 AND principal_id = $2`, [TENANT, directUser.principalId]);
    assert.equal(await sqlHas(directUser, "GOALS"), false, "expired");
    assert.deepEqual(await tsGrants(directUser), []);
    // a Role grant stops when the ASSIGNMENT is disabled
    const aid = (await one(`SELECT id FROM eos_policy.user_role_assignments WHERE principal_id = $1 AND role_id = $2 AND status = 'active'`, [finUser.principalId, await roleIdOf("saeFinLead")])).id;
    assert.equal(await sqlHas(finUser, "FINANCIALS"), true);
    await q(`UPDATE eos_policy.user_role_assignments SET status = 'disabled' WHERE id = $1`, [aid]);
    assert.equal(await sqlHas(finUser, "FINANCIALS"), false, "assignment ended");
    assert.deepEqual(await tsGrants(finUser), []);
    await q(`UPDATE eos_policy.user_role_assignments SET status = 'active' WHERE id = $1`, [aid]);
    assert.equal(await sqlHas(finUser, "FINANCIALS"), true);
    // a SCOPED assignment of the carrying Role is not a delegated exemption (global grants only until PR-3)
    const scoped = await person("uid-sae2-scoped", [], { id: "e-sae2-scoped", name: "Sam Scoped" });
    const scopedAssign = await adminAs(owner.subject, "assignRole", { principalId: scoped.principalId, roleId: await roleIdOf("saeFinLead"), reason: "scoped staffing", scopeType: "operatingCompany", scopeValue: "taylor" });
    assert.equal(scopedAssign.ok, true, JSON.stringify(scopedAssign).slice(0, 300));
    assert.equal(await sqlHas(scoped, "FINANCIALS"), false, "scoped: nothing");
    assert.deepEqual(await tsGrants(scoped), []);
    // RELINK: the Employee moves to another Principal -- the old Principal has no Employee (not exempt), the new one holds no grant (not exempt)
    const newcomer = await person("uid-sae2-newcomer", [], null);
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE principal_id = $1`, [finUser.principalId]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ('lnk-sae2-relink',$1,$2,'e-sae2-fin','taylor','OPERATOR_ASSERTED','active','fixture','relinked the Employee')`, [TENANT, newcomer.principalId]);
    assert.equal(await sqlHas(finUser, "FINANCIALS"), false, "no active Employee link");
    assert.equal(await sqlHas(newcomer, "FINANCIALS"), false, "the new Principal holds no grant");
    assert.equal((await seam.resolveSecondaryApprovalExemption(pool, TENANT, newcomer.principalId, "finance.policy")).exempt, false);
  });

  await t.test("FINANCIAL POLICY: a delegated Financials grantee approves and activates their OWN version (basis DELEGATED_EXEMPTION + source); the history rebuilds; a Purchasing-only grantee and an unflagged Administrator are refused; the database agrees; a revoke is immediate (D3 tests 4, 6, 7)", async () => {
    // adminDual holds approve / activate / prepare by standing + Preparer. Give adminDual a DIRECT Financials grant, adminPlain nothing, and a Purchasing-only direct grant to a third.
    const g = await grantDirect(owner, adminDual, "FINANCIALS");
    assert.equal(g.ok, true, JSON.stringify(g).slice(0, 300));
    const v = ok(await fn(adminDual, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: FIFO }), "draft").version;
    ok(await fn(adminDual, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id }), "submit");
    const approved = ok(await fn(adminDual, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id, reason: "delegated decision" }), "delegated approves own").version;
    assert.deepEqual([approved.status, approved.approvedBy, approved.submittedBy], ["APPROVED", adminDual.principalId, adminDual.principalId]);
    const active = ok(await fn(adminDual, "activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: v.id, effectiveDate: await businessDate("taylor") }), "delegated activates own").version;
    assert.equal(active.status, "ACTIVE");
    const rows = (await q(`SELECT action, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2 AND target_id = $3`, [TENANT, fp.FINANCIAL_POLICY_AUDIT_TARGET, v.id])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.action, r.after]));
    for (const action of ["finance.policy.approve", "finance.policy.activate"]) {
      assert.deepEqual([by[action].approvalBasis, by[action].approvalScope], ["DELEGATED_EXEMPTION", "FINANCIALS"], action);
      assert.match(by[action].approvalGrantSource, /^direct:/, action);
    }
    const events = (await q(`SELECT action, target_id AS "targetId", before, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2 ORDER BY occurred_at, id`, [TENANT, fp.FINANCIAL_POLICY_AUDIT_TARGET])).rows;
    assert.doesNotThrow(() => fp.rebuildFinancialPolicyVersions(events));
    // the Administrator WITHOUT a grant: standing holds approve, but the second-person requirement stays
    const u = ok(await fn(adminPlain, "saveFinancialPolicyDraft", { operatingCompanyId: "ventana", policy: FIFO }), "plain draft").version;
    ok(await fn(adminPlain, "submitFinancialPolicy", { operatingCompanyId: "ventana", versionId: u.id }), "plain submit");
    refused(await fn(adminPlain, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: u.id }), 403, "SEPARATION_OF_DUTIES", "non-exempt users keep the second-person requirement");
    refused(await fn(adminPlain, "rejectFinancialPolicy", { operatingCompanyId: "ventana", versionId: u.id, reason: "own" }), 403, "SEPARATION_OF_DUTIES");
    // a Purchasing-only direct grant does not reach a Financials site
    assert.equal((await grantDirect(owner, adminPlain, "PURCHASING")).ok, true);
    refused(await fn(adminPlain, "approveFinancialPolicy", { operatingCompanyId: "ventana", versionId: u.id }), 403, "SEPARATION_OF_DUTIES", "a Purchasing-only grantee cannot self-approve a Financials action");
    // the database says the same on a direct write: the grantee is accepted, the unflagged are not
    const before = (await one(`SELECT md5(x::text) h FROM eos_finance.financial_policy_versions x WHERE id = $1`, [u.id])).h;
    await assert.rejects(q(`UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = submitted_by, approved_at = now() WHERE id = $1`, [u.id]),
      (e) => { assert.equal(e.constraint, "financial_policy_approver_independent"); return true; });
    assert.equal((await one(`SELECT md5(x::text) h FROM eos_finance.financial_policy_versions x WHERE id = $1`, [u.id])).h, before, "zero mutation");
    // ... the all-workflows key counts for Financials; and a REVOKE is immediate
    assert.equal((await revokeDirect(owner, adminPlain, "PURCHASING")).ok, true);
    assert.equal((await grantDirect(owner, adminPlain, "ALL")).ok, true);
    await q(`UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = submitted_by, approved_at = now() WHERE id = $1`, [u.id]);
    assert.equal((await one(`SELECT status FROM eos_finance.financial_policy_versions WHERE id = $1`, [u.id])).status, "APPROVED", "the all-workflows grantee is accepted at the database too");
    assert.equal((await revokeDirect(owner, adminPlain, "ALL")).ok, true);
    const w = ok(await fn(adminDual, "saveFinancialPolicyDraft", { operatingCompanyId: "taylor", policy: WA }), "draft 2").version;
    ok(await fn(adminDual, "submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: w.id }), "submit 2");
    assert.equal((await revokeDirect(owner, adminDual, "FINANCIALS")).ok, true);
    refused(await fn(adminDual, "approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: w.id }), 403, "SEPARATION_OF_DUTIES", "revoked: the very next call keeps the second person");
    await assert.rejects(q(`UPDATE eos_finance.financial_policy_versions SET status = 'REJECTED', rejected_by = submitted_by, rejected_at = now(), decision_reason = 'own' WHERE id = $1`, [w.id]),
      (e) => { assert.equal(e.constraint, "financial_policy_rejecter_independent"); return true; });
    // an independent Owner clears the in-flight versions
    ok(await fn(ownerIndep, "rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: w.id, reason: "cleanup" }), "cleanup");
  });

  await t.test("D3: a delegated grantee who is an Administrator is STILL refused SELF_ADMINISTRATION, cannot grant the family onward, and gains no business capability from the key", async () => {
    assert.equal((await grantDirect(owner, adminPlain, "ALL")).ok, true);
    const before = await traces();
    const selfAssign = await adminAs(adminPlain.subject, "assignRole", { principalId: adminPlain.principalId, roleId: await roleIdOf("saeFinLead"), reason: "self" });
    assert.deepEqual([selfAssign.ok, selfAssign.code], [false, "FORBIDDEN"]);
    const selfGrant = await grantDirect(adminPlain, adminPlain, "FINANCIALS");
    assert.deepEqual([selfGrant.ok, selfGrant.code], [false, "FORBIDDEN"]);
    const onward = await grantDirect(adminPlain, plainUser, "FINANCIALS");
    assert.deepEqual([onward.ok, onward.code], [false, "FORBIDDEN"], "no onward delegation: only the Owner grants");
    assert.match(String(onward.message), /only the governed protected Owner/);
    assert.deepEqual(await traces(), before, "zero trace");
    // a key adds no capability: the holder's effective capabilities do not include any business key because of it
    const eff = await adminAs(owner.subject, "getPrincipalEffectiveAccess", { principalId: directUser.principalId });
    if (eff.ok) {
      const keys = JSON.stringify(eff.data);
      assert.doesNotMatch(keys, /finance\.adjustment\.approve|finance\.policy\.approve|supplier\.purchaseOrder\.approve|performance\.goal\.approve/, "the exemption supplies no approval capability");
    }
    assert.equal((await revokeDirect(owner, adminPlain, "ALL")).ok, true);
  });
});

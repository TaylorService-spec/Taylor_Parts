// PROTECTED ADMINISTRATOR AUTHORITY (Owner ruling 2026-10-09, DECISIONS #223) -- PR-1, against PostgreSQL through the
// real Administration API and the real operational resolver, on a baseline-equal tenant.
//
//   Standing          the designated protected admin Role, global, never alongside the protected Owner.
//   Full authority    the system authority is resolved centrally with no grant row: Workflow Builder / Assignments,
//                     warehouse configuration without an Employee WAREHOUSE scope, a newly registered system capability.
//   Not a worker      no business approval, financial or worker execution key is implied; no Work Eligibility or scope.
//   Delegation        Owner appoints; an Administrator appoints and removes OTHER Administrators; self-appointment and
//                     self-removal are refused; the last Administrator is never removed; the protected Owner is never
//                     touched; no Owner/Administrator dual membership; no cross-tenant appointment.
//   Audit             every membership change and every Administrator administration write records its authority.
//   Restricted        every other persona's capability set is exactly its grants.
//
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-padmin";
const PREFIX = "padmin";
const ADMIN_SUBJECT = `uid-${PREFIX}-admin`;

test("protected Administrator: standing, full system authority, delegation, audit -- restricted personas unchanged",
  { skip: SKIP, concurrency: false }, async (t) => {
    const { q, repo, person, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: PREFIX });
    const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
    const { resolvePrincipalContext } = require("../lib/adminPolicy/principalContext.js");
    const { resolveOperationalContext, capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
    const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
    const { assignEmployeeOperationalScope } = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
    const { isImpliedForProtectedAdministrator, PROTECTED_ADMINISTRATOR } = require("../lib/adminPolicy/protectedAdministrator.js");

    const api = (subject, operation, input = {}, deps = {}) => executeAdminOperation({ repo, ...deps },
      { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: deps.tenant ?? null }, operation, input, requestId: `r-${randomUUID()}` });
    const uidOf = async (subject) => (await resolvePrincipalContext(repo, { externalSubject: subject, identityProvider: "firebase" })).uid;
    const operational = (subject) => resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
    const adminRoleId = (await repo.getRoleByKey(T, "admin")).id;
    const activeAdminAssignment = async (principalId) => (await repo.listAssignmentsForPrincipal(T, principalId))
      .find((a) => a.status === "active" && a.roleId === adminRoleId);
    const auditFor = async (action, targetId) => (await q(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = $2 AND target_id = $3`, [T, action, targetId])).rows;
    const catalog = (await q(`SELECT key, object_key AS "objectKey", action_kind AS "actionKind" FROM eos_policy.capabilities`)).rows;
    const expectedImplied = catalog.filter(isImpliedForProtectedAdministrator).map((c) => c.key);

    const first = await uidOf(ADMIN_SUBJECT); // the bootstrapped Administrator
    const owner = await person("uid-padmin-owner", []);
    await seedProtectedOwner(repo, { tenantId: T, principalId: owner.principalId });
    const tech = await person("uid-padmin-tech", ["technician"], { id: "e-padmin-tech", name: "Tess Tech", technician: true });
    const dispatcher = await person("uid-padmin-dispatcher", ["dispatcher"]);
    const partsManager = await person("uid-padmin-pm", ["partsManager"]);
    const candidate = await person("uid-padmin-candidate", [], { id: "e-padmin-candidate", name: "Casey Candidate" });

    await t.test("full system authority by standing: every implied key, unconditioned, with no grant row", async () => {
      const ctx = await operational(ADMIN_SUBJECT);
      assert.deepEqual([...ctx.protectedAdministratorKeys].sort(), [...expectedImplied].sort());
      for (const key of expectedImplied) assert.equal(ctx.capabilities.has(key), true, key);
      for (const key of ["workflowDefinition.create", "workflowDefinition.edit", "workflowDefinition.version", "workflowDefinition.bindRole",
        "workflowDefinition.publish", "warehouse.record.manage", "admin.administratorRole.assign", "admin.employeeFunctionalRole.write"]) {
        assert.equal(ctx.capabilities.has(key), true, `${key} implied`);
      }
      const rows = (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                              WHERE rc.tenant_id = $1 AND rc.role_id = $2 AND c.key LIKE 'workflowDefinition.%' AND c.key <> 'workflowDefinition.read'`, [T, adminRoleId])).rows;
      assert.deepEqual(rows, [], "standing writes no grant row");
      // Effective Access says WHY: Protected Administrator, not a grant.
      const explained = await api(ADMIN_SUBJECT, "getPrincipalEffectiveAccess", { principalId: first });
      assert.equal(explained.ok, true, explained.message);
      const publish = JSON.stringify(explained.data).includes(PROTECTED_ADMINISTRATOR);
      assert.equal(publish, true, "Effective Access names the Protected Administrator provenance");
    });

    await t.test("not a worker, not an approver: no business-approval, financial or execution key is implied", async () => {
      const ctx = await operational(ADMIN_SUBJECT);
      const implied = (await q(`SELECT key, action_kind AS kind FROM eos_policy.capabilities WHERE key = ANY($1::text[])`, [[...ctx.protectedAdministratorKeys]])).rows;
      assert.equal(implied.some((r) => r.kind === "BUSINESS_ACTION"), false, "no BUSINESS_ACTION is ever implied");
      for (const key of ["reorder.request.read.queue", "salesAgreement.tradeIn.approve", "finance.settlement.record", "workOrder.lifecycle.complete",
        "inventory.stock.receive", "reorder.request.approve"]) {
        assert.equal(ctx.protectedAdministratorKeys.has(key), false, `${key} not implied`);
      }
      // Standing creates no Employee assignment of any kind.
      assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility WHERE tenant_id = $1`, [T])).rows[0].n), 1, "only the technician's fixture eligibility");
    });

    await t.test("a newly registered system-administration capability is covered with no grant; a new business act is not", async () => {
      await q(`INSERT INTO eos_policy.capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
                 ('cap_padmin_cfg', 'padminTest.configure', 'test', 'padminTest', 'configure', 'ADMIN_ACTION', 'Configure'),
                 ('cap_padmin_exe', 'padminTest.execute', 'test', 'padminTest', 'execute', 'BUSINESS_ACTION', 'Execute')`);
      const ctx = await operational(ADMIN_SUBJECT);
      assert.equal(ctx.capabilities.has("padminTest.configure"), true);
      assert.equal(ctx.capabilities.has("padminTest.execute"), false);
      await q(`DELETE FROM eos_policy.capabilities WHERE id IN ('cap_padmin_cfg', 'cap_padmin_exe')`);
    });

    await t.test("Workflow Builder and Assignments: every workflow decision allowed, a draft is created -- nothing published", async () => {
      const mine = await api(ADMIN_SUBJECT, "readMyWorkflowAdministration");
      assert.equal(mine.ok, true, mine.message);
      for (const [op, d] of Object.entries(mine.data.operations)) assert.equal(d.allowed, true, op);
      const list = await api(ADMIN_SUBJECT, "listWorkflows");
      assert.equal(list.ok, true, list.message);
      const draft = await api(ADMIN_SUBJECT, "createWorkflowDraft", { key: "padminTest", name: "PR-1 proof", objectKey: "workOrder",
        definition: { steps: [{ key: "A", label: "A", initial: true }, { key: "B", label: "B", terminal: true }], actions: [] }, reason: "PR-1 proof" });
      assert.equal(draft.ok, true, draft.message);
      const audited = await auditFor("createWorkflowDraft", draft.data.version.id);
      assert.equal(audited.length, 1);
      assert.equal(audited[0].after.authorizedBy.standing, PROTECTED_ADMINISTRATOR, "workflow administration audit names the authority");
    });

    await t.test("Warehouse configuration without an Employee WAREHOUSE scope (the configuration gate admits it)", async () => {
      const scopes = Number((await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE tenant_id = $1`, [T])).rows[0].n);
      const seen = [];
      const configuration = async (operation) => { seen.push(operation); return { stub: true }; };
      const r = await api(ADMIN_SUBJECT, "listWarehouses", {}, { configuration });
      assert.equal(r.ok, true, r.message);
      assert.deepEqual(seen, ["listWarehouses"]);
      assert.equal((await api(dispatcher.subject, "listWarehouses", {}, { configuration })).ok, false, "a dispatcher still needs the grant");
      assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE tenant_id = $1`, [T])).rows[0].n), scopes, "no scope created");
    });

    await t.test("Owner appoints an Administrator (R1); that Administrator has the same standing; audited R1", async () => {
      const r = await api("uid-padmin-owner", "assignRole", { principalId: candidate.principalId, roleId: adminRoleId, reason: "Owner appoints" });
      assert.equal(r.ok, true, r.message);
      const audited = await auditFor("assignRole", r.data.id);
      assert.equal(audited[0].after.authorizedBy.capabilityKey, "admin.administratorRole.assign");
      const ctx = await operational("uid-padmin-candidate");
      assert.deepEqual([...ctx.protectedAdministratorKeys].sort(), [...expectedImplied].sort(), "one tier: the same authority");
    });

    const third = await person("uid-padmin-third", []);
    await t.test("an Administrator appoints and removes ANOTHER Administrator; each audited PROTECTED_ADMINISTRATOR", async () => {
      const a = await api(ADMIN_SUBJECT, "assignRole", { principalId: third.principalId, roleId: adminRoleId, reason: "Administrator appoints" });
      assert.equal(a.ok, true, a.message);
      assert.equal((await auditFor("assignRole", a.data.id))[0].after.authorizedBy.standing, PROTECTED_ADMINISTRATOR);
      const r = await api(ADMIN_SUBJECT, "revokeRole", { assignmentId: a.data.id, reason: "Administrator removes" });
      assert.equal(r.ok, true, r.message);
      const removed = await auditFor("revokeRole", a.data.id);
      assert.equal(removed.length, 1);
      assert.equal(removed[0].after.authorizedBy.standing, PROTECTED_ADMINISTRATOR);
      assert.equal((await operational("uid-padmin-third")).protectedAdministratorKeys.size, 0, "removal ends standing");
    });

    await t.test("self-appointment and self-removal stay governed", async () => {
      const mine = await activeAdminAssignment(first);
      const self = await api(ADMIN_SUBJECT, "revokeRole", { assignmentId: mine.id, reason: "self" });
      assert.equal(self.ok, false);
      assert.match(self.message, /SELF_ADMINISTRATION/);
      const selfAssign = await api("uid-padmin-candidate", "assignRole", { principalId: candidate.principalId, roleId: adminRoleId, reason: "self" });
      assert.equal(selfAssign.ok, false);
      assert.match(selfAssign.message, /SELF_ADMINISTRATION/);
    });

    await t.test("the protected Owner is never appointed or removed by an Administrator; no Owner/Administrator dual membership", async () => {
      const ownerRoleId = (await repo.getRoleByKey(T, "owner")).id;
      const appoint = await api(ADMIN_SUBJECT, "assignRole", { principalId: candidate.principalId, roleId: ownerRoleId, reason: "x" });
      assert.match(appoint.message, /PROTECTED_OWNER_MEMBERSHIP/);
      const ownerAssignment = (await repo.listAssignmentsForPrincipal(T, owner.principalId)).find((a) => a.status === "active" && a.roleId === ownerRoleId);
      const remove = await api(ADMIN_SUBJECT, "revokeRole", { assignmentId: ownerAssignment.id, reason: "x" });
      assert.equal(remove.ok, false);
      assert.match(remove.message, /PROTECTED_OWNER|LAST_PROTECTED_OWNER/);
      const dual = await api(ADMIN_SUBJECT, "assignRole", { principalId: owner.principalId, roleId: adminRoleId, reason: "x" });
      assert.equal(dual.ok, false);
      assert.match(dual.message, /PROTECTED_ROLE_CONFLICT/);
      assert.equal(dual.code, "FORBIDDEN");
    });

    await t.test("the last Administrator is never removed; after a governed replacement it may be", async () => {
      // Two Administrators now: first, candidate. The Owner removes candidate (allowed), then may not remove the last.
      const cand = await activeAdminAssignment(candidate.principalId);
      assert.equal((await api("uid-padmin-owner", "revokeRole", { assignmentId: cand.id, reason: "Owner removes" })).ok, true);
      const last = await activeAdminAssignment(first);
      const refused = await api("uid-padmin-owner", "revokeRole", { assignmentId: last.id, reason: "Owner removes the last" });
      assert.equal(refused.ok, false, "the last Administrator stays");
      assert.match(refused.message, /last|WOULD_REMOVE_LAST_ADMINISTRATION_PATH/);
      // Governed replacement: appoint a successor first, then the removal is allowed.
      const successor = await api("uid-padmin-owner", "assignRole", { principalId: third.principalId, roleId: adminRoleId, reason: "successor" });
      assert.equal(successor.ok, true, successor.message);
      const removed = await api("uid-padmin-owner", "revokeRole", { assignmentId: last.id, reason: "replaced" });
      assert.equal(removed.ok, true, removed.message);
      assert.equal((await operational(ADMIN_SUBJECT)).protectedAdministratorKeys.size, 0);
      // Restore the first Administrator for the remaining cases (appointed by the successor -- delegation again).
      assert.equal((await api("uid-padmin-third", "assignRole", { principalId: first, roleId: adminRoleId, reason: "restore" })).ok, true);
    });

    await t.test("cross-tenant: no appointment of another tenant's principal; no reach into another tenant", async () => {
      await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t-padmin-other', 't-padmin-other', 'other')`);
      // A principal that is a member of ANOTHER tenant only (fixture rows; the foreign tenant has no administrator here).
      const foreignId = "p-padmin-foreign";
      await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, display_name) VALUES ($1, 'uid-padmin-foreign', 'firebase', 'Foreign')`, [foreignId]);
      await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-padmin-foreign', 't-padmin-other', $1)`, [foreignId]);
      const r = await api(ADMIN_SUBJECT, "assignRole", { principalId: foreignId, roleId: adminRoleId, reason: "x" });
      assert.equal(r.ok, false);
      assert.match(r.message, /not an active member of this tenant/);
      const asked = await api(ADMIN_SUBJECT, "listWorkflows", {}, { tenant: "t-padmin-other" });
      assert.equal(asked.ok, false, "a stated tenant is checked, never adopted");
    });

    await t.test("an inactive or suspended Administrator receives no authority", async () => {
      await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE tenant_id = $1 AND principal_id = $2`, [T, third.principalId]);
      assert.equal((await api("uid-padmin-third", "listWorkflows")).ok, false, "inactive (disabled) membership");
      await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE tenant_id = $1 AND principal_id = $2`, [T, third.principalId]);
      await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [third.principalId]);
      assert.equal((await api("uid-padmin-third", "listWorkflows")).ok, false, "disabled principal");
      await q(`UPDATE eos_policy.principals SET status = 'active' WHERE id = $1`, [third.principalId]);
    });

    await t.test("Administrator Employee administration is audited with its authority (Workforce)", async () => {
      const ctx = await operational(ADMIN_SUBJECT);
      const actor = { tenantId: T, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
        scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
      const r = await assignEmployeeOperationalScope({ pool }, actor, { employeeId: "e-padmin-tech", scopeType: "REORDER_QUEUE", scopeId: "taylor", reason: "PR-1 proof" });
      assert.equal(r.outcome, "ASSIGNED");
      const audited = (await q(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'employee.operationalScope.assign' AND target_id = 'e-padmin-tech'`, [T])).rows;
      assert.equal(audited.length, 1);
      assert.equal(audited[0].after.authorizedBy.standing, PROTECTED_ADMINISTRATOR);
    });

    await t.test("restricted personas: capabilities are exactly their grants; no workflow authority; no standing", async () => {
      for (const who of [owner, tech, dispatcher, partsManager]) {
        const subject = who.subject;
        const ctx = await operational(subject);
        assert.equal(ctx.protectedAdministratorKeys.size, 0, subject);
        const granted = await capabilitiesForRoleKeys(pool, T, ctx.principalContext.heldRoleKeys);
        assert.deepEqual([...ctx.capabilities].filter((k) => !granted.has(k)), [], `${subject}: nothing beyond its grants`);
        const mine = await api(subject, "readMyWorkflowAdministration");
        if (mine.ok) for (const [op, d] of Object.entries(mine.data.operations)) assert.equal(d.allowed, false, `${subject} ${op}`);
      }
      // A non-Administrator still cannot appoint an Administrator.
      const r = await api(dispatcher.subject, "assignRole", { principalId: candidate.principalId, roleId: adminRoleId, reason: "x" });
      assert.equal(r.ok, false);
    });
  });

// FUNCTIONAL ROLE authority against a real postgres:16 (migration 1762819200000).
//
// A Functional Role is an Employee's BUSINESS RESPONSIBILITY. It grants NOTHING; in a workflow it only NARROWS.
//
//   A. the schema: no capability column, nothing granted, key collisions refused in BOTH directions, INACTIVE refused
//      for assignment, one open row per (Employee, Functional Role), no overlap, history kept, deactivation with
//      holders refused, tenant-composite FKs, a binding names exactly the target its kind says
//   B. the governed commands: capability gate, ONE audit event per change (none for NO_CHANGE), tenant isolation,
//      no self-assignment, INACTIVE refused, deactivation fails closed (holders; ACTIVE workflow binding)
//   C. the reads, tenant-isolated; the Employee change history names the Functional Role actions
//   D. explainEffectiveAccess shows Functional Roles as EMPLOYEE FACTS and nothing derives from them
//   E. the workflow runtime over the real evaluator: the four narrowing cases, and publish validation
//
// Nothing hand-builds a capability set: every actor is resolved by resolveOperationalContext from PostgreSQL. The
// suite migrates its OWN disposable database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const commands = require("../lib/eosWorkforce/commands/employeeFunctionalRoleCommands.js");
const reads = require("../lib/eosWorkforce/reads/functionalRoleReads.js");
const vocab = require("../lib/eosWorkforce/functionalRoleVocabulary.js");
const eligibilityVocab = require("../lib/eosWorkforce/workEligibilityVocabulary.js");
const history = require("../lib/eosWorkforce/reads/employeeChangeHistoryRead.js");
const selfCaps = require("../lib/eosWorkforce/reads/myWorkforceCapabilities.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const { postgresWorkflowFunctionalRoleFacts } = require("../lib/eosOps/functionalRoleFacts.js");
const { postgresContextualReader } = require("../lib/eosOps/contextualAuthorization.js");
const { operationalWorkflowAuthority } = require("../lib/adminPolicy/workflowAuthority.js");
const { createWorkflowDraft } = require("../lib/adminPolicy/workflowCommands.js");
const { publishWorkflowVersion, validateStoredWorkflowVersion } = require("../lib/adminPolicy/workflowLifecycle.js");
const { startWorkflowInstance, transitionWorkflowInstance } = require("../lib/adminPolicy/workflowInstances.js");
const { deriveWorkflowResponsibilities, loadActiveWorkflowDefinitions } = require("../lib/adminPolicy/workflowResponsibilities.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
const refusal = async (fn) => { try { await fn(); return null; } catch (err) { return err.message; } };
const refused = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
const REASON = "functional role proof";

test("Functional Role authority: schema, governed commands, reads, effective access and workflow narrowing", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `fr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture" });
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["frAdmin", "fieldLead", "clerk", "wfAdmin"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await repo.transact(fixture(tenantId), (tx) => tx.createObject({ key: "workOrder", label: "Work Order", labelPlural: null, description: null, origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false }));
  }
  /** An Administration grant, as grantObjectActionToRole would record it (the fixture skips the governance ceremony). */
  const grant = (tenantId, roleKey, capabilityKey) => q(
    `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
     SELECT 'rc_fr_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, 'fixture:administration', 'fixture', 'fixture'
       FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
     ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [tenantId, roleKey, capabilityKey]);
  for (const tenantId of ["t1", "t2"]) {
    await grant(tenantId, "frAdmin", vocab.EMPLOYEE_FUNCTIONAL_ROLE_WRITE);
    await grant(tenantId, "frAdmin", "employee.record.read");
    await grant(tenantId, "frAdmin", "admin.principalAccess.read");
    await grant(tenantId, "fieldLead", "workOrder.transition");
    await grant(tenantId, "clerk", "employee.record.read");
    for (const a of ["create", "edit", "version", "bindRole", "publish", "read"]) await grant(tenantId, "wfAdmin", `workflowDefinition.${a}`);
  }
  const makePrincipal = async (tenantId, subject, roleKeys) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    for (const roleKey of roleKeys) {
      await repo.transact(fixture(tenantId), async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({
          principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active",
          grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
        });
      });
    }
    return { principalId, subject, tenantId };
  };
  const context = (p) => resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: p.subject, requestedTenantId: null });
  const actorOf = async (p) => {
    const ctx = await context(p);
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
      conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements };
  };
  const employee = (id, tenant = "t1") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant]);
  const link = (principal, employeeId) => q(
    `INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
     VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'fixture-operator', 'test fixture')`,
    [`epl-${employeeId}`, principal.tenantId, principal.principalId, employeeId]);

  const admin = await makePrincipal("t1", "uid-fr-admin", ["frAdmin"]);
  const admin2 = await makePrincipal("t1", "uid-fr-admin-2", ["frAdmin"]);
  const clerk = await makePrincipal("t1", "uid-fr-clerk", ["clerk"]);
  const lead = await makePrincipal("t1", "uid-fr-lead", ["fieldLead"]);
  const leadNoDuty = await makePrincipal("t1", "uid-fr-lead-2", ["fieldLead"]);
  // Holds only employee.record.read (clerk): no workflow capability, no bound Security Role.
  const dutyOnly = await makePrincipal("t1", "uid-fr-duty-only", ["clerk"]);
  const wfAdmin = await makePrincipal("t1", "uid-fr-wf", ["wfAdmin"]);
  const t2Admin = await makePrincipal("t2", "uid-fr-t2-admin", ["frAdmin"]);
  for (const id of ["e-1", "e-2", "e-admin", "e-lead", "e-lead-2", "e-duty"]) await employee(id);
  await employee("e-t2", "t2");
  await link(admin, "e-admin");
  await link(lead, "e-lead");
  await link(leadNoDuty, "e-lead-2");
  await link(dutyOnly, "e-duty");

  const deps = { pool };
  const adminActor = await actorOf(admin);
  const admin2Actor = await actorOf(admin2);
  const clerkActor = await actorOf(clerk);
  const t2Actor = await actorOf(t2Admin);
  const audits = async (tenant = "t1") => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1`, [tenant])).rows[0].n);
  const auditsOf = async (action) => (await q(`SELECT target_kind, target_id, before, after, reason, actor_uid FROM eos_policy.audit_events WHERE action = $1 ORDER BY occurred_at, id`, [action])).rows;

  // ════════════════════ A. schema ════════════════════

  await t.test("A: the schema can express no access, and the migration grants the capability to nobody", async () => {
    const cols = async (table) => (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'eos_workforce' AND table_name = $1 ORDER BY column_name`, [table])).rows.map((r) => r.column_name);
    for (const column of [...await cols("functional_roles"), ...await cols("employee_functional_role_assignments")]) {
      assert.doesNotMatch(column, /capab|permission|grant|scope|access|security/, column);
    }
    assert.deepEqual((await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeFunctionalRole_write'`)).rows,
      [{ key: "admin.employeeFunctionalRole.write", object_key: "employee", action_key: "setFunctionalRole", action_kind: "ADMIN_ACTION" }]);
    const byMigration = (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE c.key = $1 AND rc.granted_by <> 'fixture:administration'`, [vocab.EMPLOYEE_FUNCTIONAL_ROLE_WRITE])).rows[0].n;
    assert.equal(byMigration, 0, "no migration or bootstrap grants it");
    // The DB collision list mirrors the Work Eligibility platform vocabulary exactly.
    assert.deepEqual((await q(`SELECT eos_workforce.functional_role_reserved_eligibility_codes() AS c`)).rows[0].c, [...eligibilityVocab.WORK_ELIGIBILITY_CODES]);
    const check = (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'work_eligibility_code_known'`)).rows[0].d;
    for (const code of eligibilityVocab.WORK_ELIGIBILITY_CODES) assert.match(check, new RegExp(code));
  });

  const raw = {
    role: (id, key, status = "ACTIVE", tenant = "t1") => q(
      `INSERT INTO eos_workforce.functional_roles (tenant_id, id, key, name, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, 'fx', 'fx')`,
      [tenant, id, key, `Name ${key}`, status]),
    assign: (id, employeeId, roleId, from = "2026-01-01T00:00:00Z", tenant = "t1") => q(
      `INSERT INTO eos_workforce.employee_functional_role_assignments (id, tenant_id, employee_id, functional_role_id, effective_from, assigned_by, reason)
       VALUES ($1, $2, $3, $4, $5, 'fx', 'fixture')`, [id, tenant, employeeId, roleId, from]),
  };

  await t.test("A: key collisions are refused by the database in BOTH directions, case/punctuation-insensitively", async () => {
    assert.match(await refusal(() => raw.role("fr_rawcollide1", "field-lead")) ?? "", /FUNCTIONAL_ROLE_KEY_COLLISION.*Security Role/);
    assert.match(await refusal(() => raw.role("fr_rawcollide2", "service-technician")) ?? "", /FUNCTIONAL_ROLE_KEY_COLLISION.*Work Eligibility/);
    await raw.role("fr_rawwarranty", "warranty-desk");
    const reverse = await refusal(() => repo.transact(fixture("t1"), (tx) => tx.createRole({ key: "warrantyDesk", name: "x", description: null, origin: "CUSTOM", protected: false })));
    assert.match(reverse ?? "", /FUNCTIONAL_ROLE_KEY_COLLISION|could not|refus/i, "a Security Role may not be created onto a Functional Role key");
    // Another tenant is unaffected: the rule is per tenant.
    await raw.role("fr_rawwarranty", "warranty-desk", "ACTIVE", "t2");
    assert.match(await refusal(() => q(`UPDATE eos_workforce.functional_roles SET key = 'other-key' WHERE id = 'fr_rawwarranty' AND tenant_id = 't1'`)) ?? "", /FUNCTIONAL_ROLE_IMMUTABLE/);
    assert.match(await refusal(() => q(`DELETE FROM eos_workforce.functional_roles WHERE id = 'fr_rawwarranty' AND tenant_id = 't1'`)) ?? "", /never deleted/);
  });

  await t.test("A: assignments -- INACTIVE refused, one open per role, no overlap, history kept, tenant-composite FKs", async () => {
    await raw.role("fr_rawinactive", "dormant-duty", "INACTIVE");
    assert.match(await refusal(() => raw.assign("a-x0", "e-1", "fr_rawinactive")) ?? "", /FUNCTIONAL_ROLE_INACTIVE/);
    await raw.assign("a-x1", "e-1", "fr_rawwarranty");
    assert.match(await refusal(() => raw.assign("a-x2", "e-1", "fr_rawwarranty", "2026-06-01T00:00:00Z")) ?? "", /OVERLAP|one_open_per_role/);
    // Cross-tenant: a t2 Functional Role for a t1 Employee (and vice versa) has no composite key to reference.
    assert.match(await refusal(() => raw.assign("a-x3", "e-t2", "fr_rawwarranty", undefined, "t1")) ?? "", /foreign key|employee_fk/);
    assert.match(await refusal(() => q(`DELETE FROM eos_workforce.employee_functional_role_assignments WHERE id = 'a-x1'`)) ?? "", /DELETE is refused/);
    assert.match(await refusal(() => q(`UPDATE eos_workforce.employee_functional_role_assignments SET reason = 'rewritten' WHERE id = 'a-x1'`)) ?? "", /only permitted change/);
    // Deactivation with a current holder is refused by the database itself.
    assert.match(await refusal(() => q(`UPDATE eos_workforce.functional_roles SET status = 'INACTIVE' WHERE tenant_id = 't1' AND id = 'fr_rawwarranty'`)) ?? "", /FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS/);
    await q(`UPDATE eos_workforce.employee_functional_role_assignments SET effective_to = now(), ended_by = 'fx', ended_at = now() WHERE id = 'a-x1'`);
    assert.match(await refusal(() => q(`UPDATE eos_workforce.employee_functional_role_assignments SET effective_to = now() + interval '1 day' WHERE id = 'a-x1'`)) ?? "", /ended assignment is immutable/);
    await raw.assign("a-x4", "e-1", "fr_rawwarranty", new Date(Date.now() + 1000).toISOString());
  });

  await t.test("A: a workflow binding names exactly the target its kind says", async () => {
    const draft = (await q(`SELECT v.id FROM eos_policy.workflow_versions v LIMIT 1`)).rows[0];
    assert.equal(draft, undefined, "no workflows yet; the CHECK is proved below through the governed path");
    const def = (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'workflow_role_bindings_target_matches_kind'`)).rows[0].d;
    assert.match(def, /SECURITY_ROLE.*role_id IS NOT NULL.*functional_role_id IS NULL/s);
    assert.match(def, /FUNCTIONAL_ROLE.*role_id IS NULL.*functional_role_id IS NOT NULL/s);
  });

  // ════════════════════ B. commands ════════════════════

  let warranty;
  let returns;
  await t.test("B: the capability gate -- a holder of employee.record.read only is refused; nothing is written", async () => {
    const before = await audits();
    const err = await refused(() => commands.createFunctionalRole(deps, clerkActor, { key: "returns-desk", name: "Returns desk" }));
    assert.deepEqual([err.code, err.category], ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
    assert.equal(await audits(), before);
    assert.equal(clerkActor.capabilities.has(vocab.EMPLOYEE_FUNCTIONAL_ROLE_WRITE), false);
  });

  await t.test("B: create -- ACTIVE, one audit event, collision refusals from the command, duplicate refused", async () => {
    const before = await audits();
    const made = await commands.createFunctionalRole(deps, adminActor, { key: "claims-coordinator", name: "Claims coordinator", description: "Owns warranty claims", reason: REASON });
    assert.equal(made.outcome, "CREATED");
    assert.match(made.functionalRole.functionalRoleId, /^fr_/);
    assert.equal(made.functionalRole.status, "ACTIVE");
    warranty = made.functionalRole;
    assert.equal(await audits(), before + 1, "exactly one audit event");
    const [event] = (await auditsOf(vocab.FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION)).filter((e) => e.target_id === warranty.functionalRoleId);
    assert.deepEqual([event.target_kind, event.actor_uid, event.after.key, event.reason], ["functionalRole", admin.principalId, "claims-coordinator", REASON]);
    for (const [key, pattern] of [["frAdmin", /Security Role "frAdmin"/], ["fr-admin", /Security Role "frAdmin"/], ["parts-operations", /Work Eligibility code PARTS_OPERATIONS/]]) {
      const err = await refused(() => commands.createFunctionalRole(deps, adminActor, { key, name: `N ${key}` }));
      assert.ok(err, key);
      assert.equal(err.code, key === "frAdmin" ? "FUNCTIONAL_ROLE_KEY_INVALID" : "FUNCTIONAL_ROLE_KEY_COLLISION", key);
      if (key !== "frAdmin") assert.match(err.message, pattern);
    }
    const dup = await refused(() => commands.createFunctionalRole(deps, adminActor, { key: "claims-coordinator", name: "Another" }));
    assert.equal(dup.code, "FUNCTIONAL_ROLE_KEY_TAKEN");
    const dupName = await refused(() => commands.createFunctionalRole(deps, adminActor, { key: "claims-two", name: "claims COORDINATOR" }));
    assert.equal(dupName.code, "FUNCTIONAL_ROLE_NAME_TAKEN");
    // Authority fields are refused as unknown input.
    const forged = await refused(() => commands.createFunctionalRole(deps, adminActor, { key: "x-duty", name: "X", tenantId: "t2" }));
    assert.equal(forged.code, "INPUT_FIELD_NOT_ACCEPTED");
    assert.equal(await audits(), before + 1);
    returns = (await commands.createFunctionalRole(deps, adminActor, { key: "returns-desk", name: "Returns desk" })).functionalRole;
  });

  await t.test("B: metadata update -- one audit event; NO_CHANGE writes none; the key never changes", async () => {
    const before = await audits();
    const updated = await commands.updateFunctionalRoleMetadata(deps, adminActor, { functionalRoleId: warranty.functionalRoleId, name: "Warranty claims coordinator", reason: REASON });
    assert.deepEqual([updated.outcome, updated.functionalRole.key, updated.functionalRole.name], ["UPDATED", "claims-coordinator", "Warranty claims coordinator"]);
    assert.equal(await audits(), before + 1);
    const same = await commands.updateFunctionalRoleMetadata(deps, adminActor, { functionalRoleId: warranty.functionalRoleId, name: "Warranty claims coordinator" });
    assert.equal(same.outcome, "NO_CHANGE");
    assert.equal(await audits(), before + 1, "a NO_CHANGE writes no audit event");
    const keyEdit = await refused(() => commands.updateFunctionalRoleMetadata(deps, adminActor, { functionalRoleId: warranty.functionalRoleId, key: "renamed" }));
    assert.equal(keyEdit.code, "INPUT_FIELD_NOT_ACCEPTED");
  });

  await t.test("B: tenant isolation -- a t2 administrator cannot see, change or assign a t1 Functional Role or Employee", async () => {
    const before = [await audits("t1"), await audits("t2")];
    for (const call of [
      () => commands.updateFunctionalRoleMetadata(deps, t2Actor, { functionalRoleId: warranty.functionalRoleId, name: "Hijack" }),
      () => commands.setFunctionalRoleStatus(deps, t2Actor, { functionalRoleId: warranty.functionalRoleId, status: "INACTIVE", reason: REASON }),
      () => commands.assignEmployeeFunctionalRole(deps, t2Actor, { employeeId: "e-t2", functionalRoleId: warranty.functionalRoleId, reason: REASON }),
      () => commands.assignEmployeeFunctionalRole(deps, t2Actor, { employeeId: "e-1", functionalRoleId: warranty.functionalRoleId, reason: REASON }),
      () => reads.listFunctionalRoleHolders(deps, t2Actor, { functionalRoleId: warranty.functionalRoleId }),
    ]) {
      const err = await refused(call);
      assert.equal(err?.category, "NOT_FOUND", err?.message);
    }
    const t2Own = (await commands.createFunctionalRole(deps, t2Actor, { key: "claims-coordinator", name: "Claims coordinator" })).functionalRole;
    const cross = await refused(() => commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-1", functionalRoleId: t2Own.functionalRoleId, reason: REASON }));
    assert.equal(cross.code, "FUNCTIONAL_ROLE_NOT_FOUND");
    assert.deepEqual([await audits("t1"), await audits("t2")], [before[0], before[1] + 1]);
    // t2 sees its own catalog only: its governed entry and the raw fixture row from section A.
    assert.deepEqual((await reads.listFunctionalRoles(deps, t2Actor, {})).items.map((i) => i.key), ["claims-coordinator", "warranty-desk"]);
  });

  let assignment;
  await t.test("B: assign / end -- one audit event each, NO_CHANGE writes none, reason required, no self-assignment", async () => {
    const before = await audits();
    const noReason = await refused(() => commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-1", functionalRoleId: warranty.functionalRoleId }));
    assert.equal(noReason.code, "REASON_REQUIRED");
    const self = await refused(() => commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-admin", functionalRoleId: warranty.functionalRoleId, reason: REASON }));
    assert.deepEqual([self.code, self.category], ["FUNCTIONAL_ROLE_SELF_ASSIGNMENT", "FORBIDDEN"]);
    const past = await refused(() => commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-1", functionalRoleId: warranty.functionalRoleId, reason: REASON, effectiveFrom: "2020-01-01T00:00:00Z" }));
    assert.equal(past.code, "EFFECTIVE_DATE_IN_PAST");
    assert.equal(await audits(), before);

    assignment = await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-1", functionalRoleId: warranty.functionalRoleId, reason: REASON });
    assert.equal(assignment.outcome, "ASSIGNED");
    const again = await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-1", functionalRoleId: warranty.functionalRoleId, reason: REASON });
    assert.deepEqual([again.outcome, again.assignmentId], ["NO_CHANGE", assignment.assignmentId]);
    // Several current Functional Roles per Employee are normal.
    await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-1", functionalRoleId: returns.functionalRoleId, reason: REASON });
    assert.equal(await audits(), before + 2);
    const [event] = (await auditsOf(vocab.FUNCTIONAL_ROLE_ASSIGN_ACTION)).filter((e) => e.after.assignmentId === assignment.assignmentId);
    assert.deepEqual([event.target_kind, event.target_id, event.after.functionalRoleKey, event.reason], ["employee", "e-1", "claims-coordinator", REASON]);
    // Another administrator may assign to the first administrator's Employee: the rule is "not yourself".
    const other = await commands.assignEmployeeFunctionalRole(deps, admin2Actor, { employeeId: "e-admin", functionalRoleId: returns.functionalRoleId, reason: REASON });
    assert.equal(other.outcome, "ASSIGNED");
    const ended = await commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: "e-admin", assignmentId: other.assignmentId, reason: "not needed" });
    assert.equal(ended.outcome, "ENDED", "ending your own Functional Role only narrows, and is allowed");
    const endAgain = await commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: "e-admin", assignmentId: other.assignmentId, reason: "again" });
    assert.equal(endAgain.outcome, "NO_CHANGE");
    assert.equal(await audits(), before + 4);
    const wrongEmployee = await refused(() => commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: "e-2", assignmentId: assignment.assignmentId, reason: REASON }));
    assert.equal(wrongEmployee.code, "FUNCTIONAL_ROLE_ASSIGNMENT_NOT_FOUND");
  });

  await t.test("B: a scheduled assignment is not current; cancelling it before it starts leaves a zero-length period", async () => {
    const start = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const scheduled = await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-2", functionalRoleId: returns.functionalRoleId, reason: REASON, effectiveFrom: start });
    assert.equal(scheduled.effectiveFrom, start);
    const listed = await reads.listEmployeeFunctionalRoles(deps, adminActor, { employeeId: "e-2" });
    assert.deepEqual([listed.current.length, listed.scheduled.length], [0, 1]);
    const cancelled = await commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: "e-2", assignmentId: scheduled.assignmentId, reason: "cancelled" });
    assert.equal(cancelled.effectiveTo, start);
    assert.equal((await reads.listEmployeeFunctionalRoles(deps, adminActor, { employeeId: "e-2" })).items[0].state, "ENDED");
  });

  await t.test("B: deactivation FAILS CLOSED while holders exist; INACTIVE refuses assignment; reactivation works", async () => {
    const before = await audits();
    const noReason = await refused(() => commands.setFunctionalRoleStatus(deps, adminActor, { functionalRoleId: returns.functionalRoleId, status: "INACTIVE" }));
    assert.equal(noReason.code, "REASON_REQUIRED");
    const held = await refused(() => commands.setFunctionalRoleStatus(deps, adminActor, { functionalRoleId: returns.functionalRoleId, status: "INACTIVE", reason: REASON }));
    assert.deepEqual([held.code, held.category], ["FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS", "CONFLICT"]);
    assert.equal(await audits(), before, "a refusal ends nothing implicitly and writes nothing");
    const current = (await reads.listFunctionalRoleHolders(deps, adminActor, { functionalRoleId: returns.functionalRoleId })).holders;
    for (const h of current) {
      await commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: h.employee.employeeId, assignmentId: h.assignmentId, reason: "retiring the responsibility" });
    }
    const off = await commands.setFunctionalRoleStatus(deps, adminActor, { functionalRoleId: returns.functionalRoleId, status: "INACTIVE", reason: REASON });
    assert.equal(off.functionalRole.status, "INACTIVE");
    const inactive = await refused(() => commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-2", functionalRoleId: returns.functionalRoleId, reason: REASON }));
    assert.deepEqual([inactive.code, inactive.category], ["FUNCTIONAL_ROLE_INACTIVE", "PRECONDITION_FAILED"]);
    const on = await commands.setFunctionalRoleStatus(deps, adminActor, { functionalRoleId: returns.functionalRoleId, status: "ACTIVE", reason: REASON });
    assert.equal(on.functionalRole.status, "ACTIVE");
    assert.equal(await audits(), before + current.length + 2);
  });

  // ════════════════════ C. reads ════════════════════

  await t.test("C: reads -- catalog with holder counts, holders, an Employee's roles, audit history, change history", async () => {
    const catalog = (await reads.listFunctionalRoles(deps, clerkActor, {})).items;
    const byKey = Object.fromEntries(catalog.map((i) => [i.key, i]));
    assert.equal(byKey["claims-coordinator"].currentHolderCount, 1);
    const holders = await reads.listFunctionalRoleHolders(deps, clerkActor, { functionalRoleId: warranty.functionalRoleId });
    assert.deepEqual(holders.holders.map((h) => [h.employee.employeeId, h.state]), [["e-1", "CURRENT"]]);
    const mine = await reads.listEmployeeFunctionalRoles(deps, clerkActor, { employeeId: "e-1" });
    assert.deepEqual(mine.current.map((c) => c.key).sort(), ["claims-coordinator"]);
    const log = await reads.listFunctionalRoleHistory(deps, clerkActor, { functionalRoleId: warranty.functionalRoleId });
    assert.deepEqual(log.items.map((i) => i.action).sort(), [
      vocab.FUNCTIONAL_ROLE_ASSIGN_ACTION, vocab.FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION, vocab.FUNCTIONAL_ROLE_CATALOG_UPDATE_ACTION].sort());
    const changes = await history.listEmployeeChangeHistory(deps, clerkActor, { employeeId: "e-1" });
    assert.ok(changes.items.some((i) => i.action === vocab.FUNCTIONAL_ROLE_ASSIGN_ACTION && i.after.functionalRoleKey === "claims-coordinator"));
    // No read capability beyond employee.record.read, and a caller without it is refused.
    const nobody = await makePrincipal("t1", "uid-fr-nobody", []);
    const err = await refused(async () => reads.listFunctionalRoles(deps, await actorOf(nobody), {}));
    assert.equal(err.code, "CAPABILITY_REQUIRED");
    // The self-capability read offers the write control only to its holders.
    assert.deepEqual((await selfCaps.readMyWorkforceCapabilities(deps, adminActor, {})).capabilities.includes(vocab.EMPLOYEE_FUNCTIONAL_ROLE_WRITE), true);
    assert.deepEqual((await selfCaps.readMyWorkforceCapabilities(deps, clerkActor, {})).capabilities.includes(vocab.EMPLOYEE_FUNCTIONAL_ROLE_WRITE), false);
  });

  // ════════════════════ D. effective access ════════════════════

  await t.test("D: explainEffectiveAccess shows Functional Roles as EMPLOYEE FACTS; no capability, surface or decision derives from them", async () => {
    const before = await explainEffectiveAccess(repo, pool, { tenantId: "t1", principalId: dutyOnly.principalId });
    assert.deepEqual(before.employeeFacts, { functionalRoles: [], grantsCapabilities: false });
    const given = await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-duty", functionalRoleId: warranty.functionalRoleId, reason: REASON });
    const after = await explainEffectiveAccess(repo, pool, { tenantId: "t1", principalId: dutyOnly.principalId });
    assert.deepEqual(after.employeeFacts.functionalRoles.map((f) => [f.key, f.assignmentId]), [["claims-coordinator", given.assignmentId]]);
    assert.equal(after.employeeFacts.grantsCapabilities, false);
    const strip = (x) => ({ capabilities: x.capabilities, conditionallyHeld: x.conditionallyHeld, surfaces: x.surfaces, roles: x.securityRoleKeys,
      actions: x.actions.map((a) => [a.capabilityKey, a.result, a.reasonCode, a.sourceRoles.length]) });
    assert.deepEqual(strip(after), strip(before), "assigning a Functional Role changes NO capability, surface or action decision");
    assert.deepEqual(after.capabilities, ["employee.record.read"]);
    assert.equal(after.actions.find((a) => a.capabilityKey === "workOrder.transition").result, "DENIED");
    // The operational context the runtime uses is equally untouched.
    const ctx = await context(dutyOnly);
    assert.deepEqual([...ctx.capabilities], ["employee.record.read"]);
  });

  // ════════════════════ E. workflow ════════════════════

  const wfActor = { tenantId: "t1", uid: wfAdmin.principalId, heldRoleKeys: ["wfAdmin"] };
  const runtimeFor = async (p) => {
    const ctx = await context(p);
    return {
      actor: { tenantId: "t1", principalId: ctx.principalContext.uid, heldRoleKeys: ctx.principalContext.heldRoleKeys },
      authority: operationalWorkflowAuthority(postgresContextualReader(pool), {
        tenantId: "t1", principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
        conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements,
      }, "workOrder"),
      facts: postgresWorkflowFunctionalRoleFacts(pool, "t1", ctx.principalContext.uid),
    };
  };
  const DEF = {
    steps: [{ key: "open", label: "Open", initial: true }, { key: "claimed", label: "Claimed" }, { key: "done", label: "Done", terminal: true }],
    actions: [
      { key: "claim", label: "Claim", from: "open", to: "claimed", capabilityKey: "workOrder.transition", roleKeys: ["fieldLead"], functionalRoleKeys: ["claims-coordinator"] },
      { key: "finish", label: "Finish", from: "claimed", to: "done", capabilityKey: "workOrder.transition", roleKeys: ["fieldLead"] },
    ],
  };

  await t.test("E: publish validation -- an INACTIVE Functional Role binding refuses publish; unknown keys refuse the save", async () => {
    const unknown = await refused(() => createWorkflowDraft(repo, wfActor, { key: "woUnknown", name: "x", objectKey: "workOrder",
      definition: { ...DEF, actions: [{ ...DEF.actions[0], functionalRoleKeys: ["no-such-duty"] }, DEF.actions[1]] }, reason: REASON }));
    assert.match(unknown.message, /UNKNOWN_FUNCTIONAL_ROLE: no-such-duty/);
    // returns-desk has no holders now: deactivate it, then bind it.
    await commands.setFunctionalRoleStatus(deps, adminActor, { functionalRoleId: returns.functionalRoleId, status: "INACTIVE", reason: REASON });
    const draft = await createWorkflowDraft(repo, wfActor, { key: "woInactive", name: "x", objectKey: "workOrder",
      definition: { ...DEF, actions: [{ ...DEF.actions[0], functionalRoleKeys: ["returns-desk"] }, DEF.actions[1]] }, reason: REASON });
    const result = await validateStoredWorkflowVersion(repo, wfActor, draft.version.id);
    assert.deepEqual(result.errors.map((e) => e.code), ["INACTIVE_FUNCTIONAL_ROLE"]);
    const pub = await refused(() => publishWorkflowVersion(repo, wfActor, { versionId: draft.version.id, reason: REASON }));
    assert.equal(pub.code, "WORKFLOW_VALIDATION_FAILED");
    // The database refuses a binding whose target contradicts its kind, even on a draft.
    const bad = await refusal(() => q(`INSERT INTO eos_policy.workflow_role_bindings (id, tenant_id, workflow_version_id, action_key, role_id, created_by, updated_by, binding_kind, functional_role_id)
      VALUES ('wrb-bad', 't1', $1, 'claim', $2, 'fx', 'fx', 'FUNCTIONAL_ROLE', $3)`, [draft.version.id, roleIds["t1:fieldLead"], warranty.functionalRoleId]));
    assert.match(bad ?? "", /workflow_role_bindings_target_matches_kind/);
  });

  await t.test("E: the four narrowing cases over the real evaluator; a Functional Role never grants", async () => {
    const draft = await createWorkflowDraft(repo, wfActor, { key: "woClaims", name: "Claims", objectKey: "workOrder", definition: DEF, reason: REASON });
    assert.equal(draft.functionalBindingCount, 1);
    await publishWorkflowVersion(repo, wfActor, { versionId: draft.version.id, reason: REASON });
    // e-lead holds claims-coordinator; e-lead-2 does not; e-duty holds it but has no Security Role or capability.
    await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-lead", functionalRoleId: warranty.functionalRoleId, reason: REASON });
    const run = async (p, recordId, actionKey) => {
      const r = await runtimeFor(p);
      return refused(() => transitionWorkflowInstance(repo, r.actor, { objectKey: "workOrder", recordId, actionKey, reason: REASON }, r.authority, r.facts));
    };
    for (const recordId of ["wo-1", "wo-2", "wo-3", "wo-4"]) await startWorkflowInstance(repo, wfActor, { workflowKey: "woClaims", recordId, reason: REASON });

    // 1. Security Role + capability + Functional Role -> allowed.
    assert.equal(await run(lead, "wo-1", "claim"), null);
    // 2. Functional Role WITHOUT capability (and without a bound Security Role) -> refused.
    const dutyOnlyErr = await run(dutyOnly, "wo-2", "claim");
    assert.match(dutyOnlyErr.message, /WORKFLOW_ACTION_REFUSED: claim refused: notBoundToRole/);
    // 3. Security Role + capability WITHOUT the Functional Role on a FUNCTIONAL_ROLE-bound action -> refused.
    const noDuty = await run(leadNoDuty, "wo-2", "claim");
    assert.match(noDuty.message, /claim refused: functionalRoleRequired \(FUNCTIONAL_ROLE_REQUIRED\)/);
    // 4. No FUNCTIONAL_ROLE binding -> unchanged: the action without one is performed by the principal WITHOUT the
    //    Functional Role, exactly as before the binding kind existed.
    assert.equal(await run(lead, "wo-1", "finish"), null);
    assert.equal(await run(lead, "wo-3", "claim"), null);
    assert.equal(await run(leadNoDuty, "wo-3", "finish"), null);
    // Without composed facts, a FUNCTIONAL_ROLE-bound action is refused rather than decided without them.
    const r = await runtimeFor(lead);
    const noFacts = await refused(() => transitionWorkflowInstance(repo, r.actor, { objectKey: "workOrder", recordId: "wo-4", actionKey: "claim", reason: REASON }, r.authority));
    assert.match(noFacts.message, /functionalRoleFactsUnavailable/);
    // Ending the Functional Role removes ONLY the narrowing permission; the capability is untouched.
    const leadRoles = await reads.listEmployeeFunctionalRoles(deps, adminActor, { employeeId: "e-lead" });
    await commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: "e-lead", assignmentId: leadRoles.current[0].assignmentId, reason: REASON });
    assert.match((await run(lead, "wo-4", "claim")).message, /functionalRoleRequired/);
    assert.ok((await context(lead)).capabilities.has("workOrder.transition"));
  });

  await t.test("E: responsibilities name the Functional Role source; deactivation is refused while an ACTIVE workflow binds it", async () => {
    await commands.assignEmployeeFunctionalRole(deps, adminActor, { employeeId: "e-lead", functionalRoleId: warranty.functionalRoleId, reason: REASON });
    const explained = await explainEffectiveAccess(repo, pool, { tenantId: "t1", principalId: lead.principalId });
    const derived = deriveWorkflowResponsibilities(lead.principalId, await loadActiveWorkflowDefinitions(repo, "t1"), explained);
    const claim = derived.responsibilities.find((x) => x.workflowKey === "woClaims" && x.actionKey === "claim");
    assert.deepEqual([claim.source, claim.viaFunctionalRoles], ["WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY", ["claims-coordinator"]]);
    const dutyExplained = await explainEffectiveAccess(repo, pool, { tenantId: "t1", principalId: dutyOnly.principalId });
    const dutyDerived = deriveWorkflowResponsibilities(dutyOnly.principalId, await loadActiveWorkflowDefinitions(repo, "t1"), dutyExplained);
    assert.deepEqual(dutyDerived.responsibilities, [], "a Functional Role alone confers no responsibility");
    assert.equal(dutyDerived.boundWithoutAuthority.find((x) => x.actionKey === "claim").source, "FUNCTIONAL_ROLE_BINDING_ONLY");

    // End every holder, then try to deactivate: the ACTIVE workflow binding still refuses it.
    for (const h of (await reads.listFunctionalRoleHolders(deps, adminActor, { functionalRoleId: warranty.functionalRoleId })).holders) {
      await commands.endEmployeeFunctionalRoleAssignment(deps, adminActor, { employeeId: h.employee.employeeId, assignmentId: h.assignmentId, reason: REASON });
    }
    const bound = await refused(() => commands.setFunctionalRoleStatus(deps, adminActor, { functionalRoleId: warranty.functionalRoleId, status: "INACTIVE", reason: REASON }));
    assert.deepEqual([bound.code, bound.category], ["FUNCTIONAL_ROLE_BOUND_TO_ACTIVE_WORKFLOW", "CONFLICT"]);
  });
});

test("the Functional Role migration's DOWN refuses while any Functional Role fact exists, and reverses cleanly when empty", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { readdirSync } = await import("node:fs");
  const MIGRATION = "1762819200000_employee-functional-role-authority.sql";
  const files = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const steps = files.length - files.indexOf(MIGRATION); // counted, never "down 1": a later migration must not hijack the proof
  const name = `frdown_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)));
  const run = (...args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  run("up");
  await withClient(dbUrlFor(name), async (c) => {
    await c.query(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
    await c.query(`INSERT INTO eos_workforce.functional_roles (tenant_id, id, key, name, status, created_by, updated_by) VALUES ('t1','fr_downproof1','down-proof','Down proof','ACTIVE','fx','fx')`);
  });
  assert.throws(() => run("down", String(steps)), (err) => /refuses to reverse: 1 Functional Role/.test(String(err.stderr)));
  await withClient(dbUrlFor(name), (c) => c.query(`ALTER TABLE eos_workforce.functional_roles DISABLE TRIGGER functional_roles_guard; DELETE FROM eos_workforce.functional_roles`));
  run("down", String(steps));
  const gone = await withClient(dbUrlFor(name), (c) => c.query(`SELECT to_regclass('eos_workforce.functional_roles') AS t, (SELECT count(*)::int FROM eos_policy.capabilities WHERE key = 'admin.employeeFunctionalRole.write') AS n`));
  assert.deepEqual(gone.rows[0], { t: null, n: 0 });
  run("up");
});

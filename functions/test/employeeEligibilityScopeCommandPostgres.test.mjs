// Step C: the governed Administration commands and reads for WORK ELIGIBILITY and OPERATIONAL SCOPE, against a real
// postgres:16.
//
// Steps A and B built the two authorities' schemas. This suite proves the COMMANDS on top of them, and above all that
// the three authorities the legacy `operationalRoles` field conflated stay SEPARATE under mutation:
//
//   SECURITY CAPABILITY   admin.employeeWorkEligibility.write / admin.employeeOperationalScope.write, each its own
//                         narrow capability -- neither is admin.employeeProfile.write, neither is
//                         admin.employeeJobRole.write, and neither substitutes for the other
//   WORK ELIGIBILITY      what KIND of work the Employee is qualified for
//   OPERATIONAL SCOPE     WHICH warehouses the Employee covers
//
// Nothing here hand-builds a capability set: Roles and grants come from the EXISTING Role-catalog reconciliation, and
// every actor is resolved through the EXISTING operational context resolver, so the capability the command checks is
// the one PostgreSQL really derived for that Principal. The suite migrates its OWN disposable database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const eligibility = require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js");
const scopes = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
const eligibilityReads = require("../lib/eosWorkforce/reads/workEligibilityReads.js");
const scopeReads = require("../lib/eosWorkforce/reads/operationalScopeReads.js");
const jobRoles = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
const http = require("../lib/eosWorkforce/workforceHttp.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

test("Work Eligibility and Operational Scope Administration commands over the real Workforce and policy authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_step_c_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["admin", "warehouseManager"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "employee-capability-grants:test" });
  }
  const makePrincipal = async (tenantId, subject, roleKey) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await repo.transact(fixture(tenantId), async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({
        principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
      });
    });
    return { principalId, subject };
  };
  const resolveActor = async (principal) => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: principal.subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };
  };
  const employee = (id, tenant = "t1") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant],
  );
  const warehouse = (id, tenant = "t1", status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, 'taylor', $3, 'Somewhere, AZ', $4, 'NATIVE', 'fixture', 'fixture')`, [id, tenant, `WH ${id}`, status],
  );

  const admin = await makePrincipal("t1", "firebase-uid-admin", "admin");
  const whManager = await makePrincipal("t1", "firebase-uid-wh-manager", "warehouseManager");
  const t2Admin = await makePrincipal("t2", "firebase-uid-t2-admin", "admin");
  await employee("e-1");
  await employee("e-2");
  await employee("e-t2", "t2");
  // e-linked is the Employee record of the admin Principal: the Principal id must never stand in for the Employee id.
  await employee("e-linked");
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
           VALUES ('epl-admin', 't1', $1, 'e-linked', 'taylor', 'OPERATOR_ASSERTED', 'fixture-operator', 'test fixture')`, [admin.principalId]);
  await warehouse("wh-main");
  await warehouse("wh-north");
  await warehouse("wh-retired", "t1", "INACTIVE");
  await warehouse("wh-t2", "t2");

  const deps = { pool };
  const adminActor = await resolveActor(admin);
  const t2AdminActor = await resolveActor(t2Admin);

  const qualRows = async (id) => (await q(
    `SELECT qualification_code, effective_to IS NULL AS current, assigned_by, ended_by FROM eos_workforce.employee_work_eligibility
      WHERE employee_id = $1 ORDER BY effective_from, id`, [id])).rows;
  const scopeRows = async (id) => (await q(
    `SELECT scope_type, scope_id, effective_to IS NULL AS current, assigned_by, ended_by FROM eos_workforce.employee_operational_scopes
      WHERE employee_id = $1 ORDER BY effective_from, id`, [id])).rows;
  const auditsFor = async (id) => (await q(
    `SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events
      WHERE target_kind = 'employee' AND target_id = $1 ORDER BY occurred_at, id`, [id])).rows;

  // Everything a qualification or a scope must NEVER touch, snapshotted: Security Role assignments and capability
  // grants, Job Role assignments, Employee lifecycle/profile/operating-company facts, reporting relationships, and
  // every ownership/accountability record that exists.
  const untouchable = async () => ({
    roleAssignments: (await q(`SELECT principal_id, role_id, status FROM eos_policy.user_role_assignments ORDER BY 1, 2`)).rows,
    roleCapabilities: (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n,
    jobRoleAssignments: (await q(`SELECT employee_id, job_role_id, effective_to FROM eos_workforce.employee_job_role_assignments ORDER BY 1, 2`)).rows,
    employees: (await q(`SELECT id, employment_status::text, operating_company_id, job_title, updated_at FROM eos_workforce.employees ORDER BY id`)).rows,
    reporting: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships`)).rows[0].n,
    ownership: (await q(`SELECT count(*)::int n FROM eos_commercial.ownership_handoffs`)).rows[0].n,
  });

  await t.test("the two capabilities are granted to the administrator Roles only -- never to warehouseManager", async () => {
    assert.ok(adminActor.capabilities.has("admin.employeeWorkEligibility.write"));
    assert.ok(adminActor.capabilities.has("admin.employeeOperationalScope.write"));
    const whActor = await resolveActor(whManager);
    assert.ok(!whActor.capabilities.has("admin.employeeWorkEligibility.write"), "warehouseManager gained the qualification capability");
    assert.ok(!whActor.capabilities.has("admin.employeeOperationalScope.write"), "warehouseManager gained the scope capability");
  });

  await t.test("qualifications: assign, multiple concurrent codes, duplicate is NO_CHANGE, end, re-assign appends history", async () => {
    const first = await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "SERVICE_TECHNICIAN", reason: "passed certification" });
    assert.equal(first.outcome, "ASSIGNED");

    // A second, DIFFERENT code is a separate concurrent qualification -- not a replacement.
    assert.equal((await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "WAREHOUSE_OPERATIONS" })).outcome, "ASSIGNED");
    assert.deepEqual((await qualRows("e-1")).map((r) => [r.qualification_code, r.current]),
      [["SERVICE_TECHNICIAN", true], ["WAREHOUSE_OPERATIONS", true]]);

    // Re-assigning a code already held currently changes nothing and opens no second row.
    const dup = await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "SERVICE_TECHNICIAN" });
    assert.equal(dup.outcome, "NO_CHANGE");
    assert.equal(dup.qualificationId, first.qualificationId);
    assert.equal((await qualRows("e-1")).length, 2);

    const ended = await eligibility.endEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "SERVICE_TECHNICIAN", reason: "certification lapsed" });
    assert.equal(ended.outcome, "ENDED");
    // Ending is idempotent, and it never deletes: the ended period stays.
    assert.equal((await eligibility.endEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "SERVICE_TECHNICIAN" })).outcome, "NO_CHANGE");

    // Re-qualifying later appends a NEW period rather than reopening the old one.
    assert.equal((await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "SERVICE_TECHNICIAN" })).outcome, "ASSIGNED");
    const rows = await qualRows("e-1");
    assert.equal(rows.filter((r) => r.qualification_code === "SERVICE_TECHNICIAN").length, 2);
    assert.equal(rows.filter((r) => r.qualification_code === "SERVICE_TECHNICIAN" && r.current).length, 1);

    // The audit names the EOS Principal, never a Firebase uid, and carries the stated reason.
    const audits = (await auditsFor("e-1")).filter((a) => a.action.startsWith("employee.workEligibility."));
    assert.deepEqual(audits.map((a) => [a.action, a.actor_uid, a.reason]), [
      ["employee.workEligibility.assign", admin.principalId, "passed certification"],
      ["employee.workEligibility.assign", admin.principalId, null],
      ["employee.workEligibility.end", admin.principalId, "certification lapsed"],
      ["employee.workEligibility.assign", admin.principalId, null],
    ]);
    assert.notEqual(admin.principalId, admin.subject, "the Principal id must not be the Firebase subject");
  });

  await t.test("qualification reads: current list, full history, unknown Employee refused", async () => {
    const current = await eligibilityReads.listEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1" });
    assert.deepEqual(current.items.map((i) => i.qualificationCode), ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
    assert.ok(current.items.every((i) => i.current && i.effectiveTo === null));
    assert.match(current.items[0].label, /Service Technician/);

    const history = await eligibilityReads.listEmployeeWorkEligibilityHistory(deps, adminActor, { employeeId: "e-1" });
    assert.equal(history.items.length, 3, "the ended period is kept in history");
    assert.equal(history.current.length, 2);
    // The row's `reason` is the reason it was ASSIGNED, and the history trigger makes it immutable -- so ending a
    // qualification cannot overwrite it. The reason it ENDED is carried by the audit event instead.
    assert.equal(history.items.filter((i) => !i.current)[0].reason, "passed certification");
    assert.equal((await auditsFor("e-1")).find((a) => a.action === "employee.workEligibility.end").reason, "certification lapsed");

    // An Employee with no qualifications reads as an empty list -- never as something inferred.
    assert.deepEqual((await eligibilityReads.listEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-2" })).items, []);
    await assert.rejects(eligibilityReads.listEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-nope" }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
  });

  await t.test("scopes: assign, multiple concurrent warehouses, duplicate is NO_CHANGE, end, reads report the target", async () => {
    const first = await scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-main", reason: "covers Phoenix" });
    assert.equal(first.outcome, "ASSIGNED");
    assert.equal((await scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-north" })).outcome, "ASSIGNED");

    const dup = await scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-main" });
    assert.equal(dup.outcome, "NO_CHANGE");
    assert.equal(dup.operationalScopeId, first.operationalScopeId);

    const current = await scopeReads.listEmployeeOperationalScopes(deps, adminActor, { employeeId: "e-1" });
    assert.deepEqual(current.items.map((i) => [i.scopeType, i.scopeId, i.warehouseStatus]),
      [["WAREHOUSE", "wh-main", "ACTIVE"], ["WAREHOUSE", "wh-north", "ACTIVE"]]);
    assert.equal(current.items[0].scopeName, "WH wh-main");

    assert.equal((await scopes.endEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-north" })).outcome, "ENDED");
    assert.equal((await scopes.endEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-north" })).outcome, "NO_CHANGE");
    const history = await scopeReads.listEmployeeOperationalScopeHistory(deps, adminActor, { employeeId: "e-1" });
    assert.equal(history.items.length, 2);
    assert.equal(history.current.length, 1);
    assert.deepEqual((await auditsFor("e-1")).filter((a) => a.action.startsWith("employee.operationalScope.")).map((a) => a.action),
      ["employee.operationalScope.assign", "employee.operationalScope.assign", "employee.operationalScope.end"]);
  });

  await t.test("scope targets: unknown, inactive and cross-tenant warehouses are all REFUSED, and nothing is written", async () => {
    const before = await scopeRows("e-2");
    await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-nope" }),
      (e) => e.code === "WAREHOUSE_NOT_FOUND");
    await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-retired" }),
      (e) => e.code === "WAREHOUSE_INACTIVE");
    // A warehouse of ANOTHER tenant is NOT_FOUND, never "inactive" and never assignable: its existence is not confirmed.
    await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-t2" }),
      (e) => e.code === "WAREHOUSE_NOT_FOUND");
    // The scope type stays closed: nothing generalizes WAREHOUSE.
    for (const scopeType of ["OPERATING_COMPANY", "LOCATION", "GLOBAL", "warehouse", ""]) {
      await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType, scopeId: "wh-main" }),
        (e) => e.code === "OPERATIONAL_SCOPE_TYPE_INVALID", `scopeType ${JSON.stringify(scopeType)} was accepted`);
    }
    assert.deepEqual(await scopeRows("e-2"), before);
  });

  await t.test("an already-assigned scope survives its warehouse going INACTIVE: no silent revocation, and it stays removable", async () => {
    await scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-north" });
    await q(`UPDATE eos_ops.warehouses SET status = 'INACTIVE' WHERE tenant_id = 't1' AND id = 'wh-north'`);
    try {
      const listed = await scopeReads.listEmployeeOperationalScopes(deps, adminActor, { employeeId: "e-2" });
      assert.deepEqual(listed.items.map((i) => [i.scopeId, i.warehouseStatus]), [["wh-north", "INACTIVE"]],
        "the read must SURFACE the remediation case, not hide or drop it");
      // Assigning it anew is refused, but ending the existing scope must still work.
      await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-north" }),
        (e) => e.code === "WAREHOUSE_INACTIVE");
      assert.equal((await scopes.endEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-north" })).outcome, "ENDED");
    } finally {
      await q(`UPDATE eos_ops.warehouses SET status = 'ACTIVE' WHERE tenant_id = 't1' AND id = 'wh-north'`);
    }
  });

  await t.test("CAPABILITY: the right capability is required, and no neighbouring capability substitutes for it", async () => {
    // A Role holding ONLY admin.employeeProfile.write, and one holding ONLY admin.employeeJobRole.write. Both are
    // "Employee administration" capabilities; neither may mutate a qualification or a scope.
    const only = async (capabilityKey, subject) => {
      const role = await repo.transact(fixture("t1"), (tx) => tx.createRole({ key: `only-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
               SELECT $2, 't1', $1, id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities WHERE key = $3`,
        [role.id, `rc-${subject}`, capabilityKey]);
      roleIds[`t1:only-${subject}`] = role.id;
      return resolveActor(await makePrincipal("t1", `firebase-uid-${subject}`, `only-${subject}`));
    };
    const profileOnly = await only("admin.employeeProfile.write", "profile-only");
    const jobRoleOnly = await only("admin.employeeJobRole.write", "job-role-only");
    const eligibilityOnly = await only("admin.employeeWorkEligibility.write", "eligibility-only");
    const scopeOnly = await only("admin.employeeOperationalScope.write", "scope-only");

    assert.ok(profileOnly.capabilities.has("admin.employeeProfile.write") && !profileOnly.capabilities.has("admin.employeeWorkEligibility.write"));
    assert.ok(jobRoleOnly.capabilities.has("admin.employeeJobRole.write") && !jobRoleOnly.capabilities.has("admin.employeeOperationalScope.write"));

    const qualInput = { employeeId: "e-2", qualificationCode: "SERVICE_TECHNICIAN" };
    const scopeInput = { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-main" };
    const refusedByCapability = (e) => e.code === "CAPABILITY_REQUIRED" && e.category === "FORBIDDEN";

    for (const [label, actor] of [["profile-write only", profileOnly], ["job-role-write only", jobRoleOnly], ["scope-write only", scopeOnly]]) {
      await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, actor, qualInput), refusedByCapability, `${label} assigned a qualification`);
      await assert.rejects(eligibility.endEmployeeWorkEligibility(deps, actor, qualInput), refusedByCapability, `${label} ended a qualification`);
    }
    for (const [label, actor] of [["profile-write only", profileOnly], ["job-role-write only", jobRoleOnly], ["eligibility-write only", eligibilityOnly]]) {
      await assert.rejects(scopes.assignEmployeeOperationalScope(deps, actor, scopeInput), refusedByCapability, `${label} assigned a scope`);
      await assert.rejects(scopes.endEmployeeOperationalScope(deps, actor, scopeInput), refusedByCapability, `${label} ended a scope`);
    }
    // The two decomposition capabilities are separate authorities: each opens ONLY its own door.
    assert.equal((await eligibility.assignEmployeeWorkEligibility(deps, eligibilityOnly, qualInput)).outcome, "ASSIGNED");
    assert.equal((await scopes.assignEmployeeOperationalScope(deps, scopeOnly, scopeInput)).outcome, "ASSIGNED");
  });

  await t.test("JOB ROLE alone creates no qualification and no scope; a qualification/scope creates no Job Role", async () => {
    await jobRoles.createJobRole(deps, adminActor, { jobRoleId: "service-technician", displayName: "Service Technician" });
    // A SECOND Job Role, so the "another Employee's Job Role leaked a qualification" check below has one to use. It
    // was `parts-warehouse` until the 2026-09-25 canonical ruling retired that id and createJobRole began refusing
    // it; parts-associate is one of the four positions it was fused from.
    await jobRoles.createJobRole(deps, adminActor, { jobRoleId: "parts-associate", displayName: "Parts Associate" });
    await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-linked", jobRoleId: "service-technician" });
    // Holding the Service Technician Job Role produced NO SERVICE_TECHNICIAN qualification and NO warehouse scope.
    assert.deepEqual(await qualRows("e-linked"), []);
    assert.deepEqual(await scopeRows("e-linked"), []);
    assert.deepEqual((await eligibilityReads.listEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-linked" })).items, []);

    await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-1", jobRoleId: "parts-associate" });
    assert.deepEqual(await qualRows("e-linked"), [], "another Employee's Job Role leaked a qualification");
  });

  await t.test("SECURITY ROLE alone creates no qualification and no scope", async () => {
    // The warehouseManager Principal holds a Security Role whose legacy meaning fused 'warehouse work' with 'which
    // warehouse'. Its Employee record must still have neither qualification nor scope.
    await employee("e-wh-manager");
    assert.deepEqual(await qualRows("e-wh-manager"), []);
    assert.deepEqual(await scopeRows("e-wh-manager"), []);
    const everyQualification = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility WHERE employee_id = 'e-wh-manager'`)).rows[0].n;
    const everyScope = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE employee_id = 'e-wh-manager'`)).rows[0].n;
    assert.equal(everyQualification + everyScope, 0);
  });

  await t.test("INDEPENDENCE: a qualification mutation changes no scope/Job Role/Security Role/manager/company, and vice versa", async () => {
    const before = await untouchable();
    const scopesBefore = await scopeRows("e-1");
    await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "WAREHOUSE_OPERATIONS" }); // already held -> NO_CHANGE
    await eligibility.endEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "WAREHOUSE_OPERATIONS" });
    await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-1", qualificationCode: "WAREHOUSE_OPERATIONS" });
    assert.deepEqual(await untouchable(), before, "a qualification mutation touched another authority");
    assert.deepEqual(await scopeRows("e-1"), scopesBefore, "a qualification mutation changed an operational scope");

    const qualsBefore = await qualRows("e-1");
    const before2 = await untouchable();
    await scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-north" });
    await scopes.endEmployeeOperationalScope(deps, adminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-north" });
    assert.deepEqual(await untouchable(), before2, "a scope mutation touched another authority");
    assert.deepEqual(await qualRows("e-1"), qualsBefore, "a scope mutation changed a qualification");
  });

  await t.test("TENANCY and identity: another tenant's Employee, and a Principal id used as an Employee id, are NOT_FOUND", async () => {
    for (const command of [
      () => eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-t2", qualificationCode: "SERVICE_TECHNICIAN" }),
      () => scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-t2", scopeType: "WAREHOUSE", scopeId: "wh-main" }),
      () => eligibility.assignEmployeeWorkEligibility(deps, t2AdminActor, { employeeId: "e-1", qualificationCode: "SERVICE_TECHNICIAN" }),
      () => scopes.assignEmployeeOperationalScope(deps, t2AdminActor, { employeeId: "e-1", scopeType: "WAREHOUSE", scopeId: "wh-t2" }),
      // PRINCIPAL != EMPLOYEE: the actor's own Principal id is not an Employee id, even though it IS linked to e-linked.
      () => eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: admin.principalId, qualificationCode: "SERVICE_TECHNICIAN" }),
      () => scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: admin.principalId, scopeType: "WAREHOUSE", scopeId: "wh-main" }),
      // ...and neither is the Firebase subject.
      () => eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: admin.subject, qualificationCode: "SERVICE_TECHNICIAN" }),
    ]) {
      await assert.rejects(command, (e) => e.code === "EMPLOYEE_NOT_FOUND" && e.category === "NOT_FOUND");
    }
    assert.deepEqual(await qualRows("e-t2"), []);
    assert.deepEqual(await scopeRows("e-t2"), []);
  });

  await t.test("MEMBERSHIP: a disabled membership and a disabled Principal both refuse, even holding the capability", async () => {
    const temp = await makePrincipal("t1", "firebase-uid-temp-admin", "admin");
    const tempActor = await resolveActor(temp);
    assert.ok(tempActor.capabilities.has("admin.employeeWorkEligibility.write"));
    const input = { employeeId: "e-2", qualificationCode: "WAREHOUSE_OPERATIONS" };
    const scopeInput = { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-north" };

    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1`, [temp.principalId]);
    await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, tempActor, input), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    await assert.rejects(scopes.assignEmployeeOperationalScope(deps, tempActor, scopeInput), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");

    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1`, [temp.principalId]);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [temp.principalId]);
    await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, tempActor, input), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    await assert.rejects(scopes.assignEmployeeOperationalScope(deps, tempActor, scopeInput), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
  });

  await t.test("INPUT: authority-bearing and unknown fields are refused; the vocabulary is closed", async () => {
    for (const extra of ["tenantId", "principalId", "capabilities", "securityRole", "jobRoleId", "operatingCompanyId", "effectiveFrom", "assignedBy"]) {
      await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-2", qualificationCode: "SERVICE_TECHNICIAN", [extra]: "x" }),
        (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", `qualification accepted ${extra}`);
      await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "wh-main", [extra]: "x" }),
        (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", `scope accepted ${extra}`);
    }
    // The qualification vocabulary is exactly two codes: no legacy operationalRole value is admissible.
    for (const code of ["TECHNICIAN", "WAREHOUSE_ASSOCIATE", "WAREHOUSE_MANAGER", "service_technician", "", null]) {
      await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-2", qualificationCode: code }),
        (e) => e.code === "WORK_ELIGIBILITY_CODE_INVALID", `qualificationCode ${JSON.stringify(code)} was accepted`);
    }
    await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "a/b", qualificationCode: "SERVICE_TECHNICIAN" }), (e) => e.code === "EMPLOYEE_ID_REQUIRED");
    await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-2", scopeType: "WAREHOUSE", scopeId: "a/b" }), (e) => e.code === "EMPLOYEE_ID_REQUIRED");
    await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-2", qualificationCode: "SERVICE_TECHNICIAN", reason: " untrimmed " }), (e) => e.code === "REASON_INVALID");
  });

  await t.test("ATOMICITY: an audit failure rolls back the qualification AND the scope write completely", async () => {
    // A dedicated Employee, so every command below genuinely MUTATES: a NO_CHANGE writes no audit event and would
    // never reach the injected failure, which would make this proof vacuous.
    await employee("e-atomic");
    await eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-atomic", qualificationCode: "SERVICE_TECHNICIAN" });
    await scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-atomic", scopeType: "WAREHOUSE", scopeId: "wh-main" });
    const qualsBefore = await qualRows("e-atomic");
    const scopesBefore = await scopeRows("e-atomic");
    const auditsBefore = await auditsFor("e-atomic");

    await q(`CREATE FUNCTION test_refuse_step_c_audit() RETURNS trigger AS $$ BEGIN
               IF NEW.action LIKE 'employee.workEligibility.%' OR NEW.action LIKE 'employee.operationalScope.%'
                 THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER test_refuse_step_c_audit BEFORE INSERT ON eos_policy.audit_events FOR EACH ROW EXECUTE FUNCTION test_refuse_step_c_audit()`);
    try {
      const opaque = (e) => e.code === "COMMAND_FAILED" && !/injected|relation|function/i.test(e.message);
      // One of each: a qualification opened, a qualification ended, a scope opened, a scope ended.
      await assert.rejects(eligibility.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-atomic", qualificationCode: "WAREHOUSE_OPERATIONS" }), opaque);
      await assert.rejects(eligibility.endEmployeeWorkEligibility(deps, adminActor, { employeeId: "e-atomic", qualificationCode: "SERVICE_TECHNICIAN" }), opaque);
      await assert.rejects(scopes.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "e-atomic", scopeType: "WAREHOUSE", scopeId: "wh-north" }), opaque);
      await assert.rejects(scopes.endEmployeeOperationalScope(deps, adminActor, { employeeId: "e-atomic", scopeType: "WAREHOUSE", scopeId: "wh-main" }), opaque);
    } finally {
      await q(`DROP TRIGGER test_refuse_step_c_audit ON eos_policy.audit_events`);
      await q(`DROP FUNCTION test_refuse_step_c_audit()`);
    }
    assert.deepEqual(await qualRows("e-atomic"), qualsBefore, "a failed qualification command left a row behind or ended one");
    assert.deepEqual(await scopeRows("e-atomic"), scopesBefore, "a failed scope command left a row behind or ended one");
    assert.deepEqual(await auditsFor("e-atomic"), auditsBefore, "a failed command left an audit event behind");
  });

  await t.test("the transport exposes the step C operations, and no step C module reaches for Firebase", async () => {
    for (const op of ["listEmployeeWorkEligibility", "listEmployeeWorkEligibilityHistory", "listEmployeeOperationalScopes", "listEmployeeOperationalScopeHistory"]) {
      assert.ok(http.WORKFORCE_READ_OPERATIONS.includes(op), `${op} is not a registered read`);
    }
    for (const op of ["assignEmployeeWorkEligibility", "endEmployeeWorkEligibility", "assignEmployeeOperationalScope", "endEmployeeOperationalScope"]) {
      assert.ok(http.WORKFORCE_COMMAND_OPERATIONS.includes(op), `${op} is not a registered command`);
    }
    // Loading the step C modules must not pull in any firebase package, directly or transitively.
    const probe = spawnSync(process.execPath, ["-e", `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.exit(97)}return l.call(this,r,...a)};` +
      `require("./lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js");require("./lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");` +
      `require("./lib/eosWorkforce/reads/workEligibilityReads.js");require("./lib/eosWorkforce/reads/operationalScopeReads.js")`], { cwd: FUNCTIONS_DIR });
    assert.notEqual(probe.status, 97, "a step C module loaded a firebase package");
    assert.equal(probe.status, 0, probe.stderr?.toString());
  });
});

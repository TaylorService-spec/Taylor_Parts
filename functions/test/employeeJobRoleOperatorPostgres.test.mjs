// LANE BT (reprise) -- GOVERNED JOB ROLE ASSIGNMENT THROUGH THE OPERATOR WRAPPER, against a real postgres:16.
//
// The subject: scripts/administerEmployeeCli.js `--command assignEmployeeJobRole`, which drives the
// EXISTING governed writer employeeJobRoleCommands.assignEmployeeJobRole under the EXISTING capability
// admin.employeeJobRole.write. The wrapper adds no command, no capability, no SQL and no second gate;
// what this suite has to prove is that it adds no AUTHORITY and no SIDE EFFECT either.
//
// WHY IT EXISTS. Phase 2C of the live Persona Foundation apply had no operator that could assign a Job
// Role: scripts/seedPersonaAuthorityDimensionsCli.js plans Job Role steps its executor never wired and
// dies with `commands[step.command] is not a function` (recorded as a KNOWN DEFECT in that file's
// header; the Owner ruled it is NOT repaired in this wave). This is the bounded replacement -- ONE
// Employee, ONE position, per invocation.
//
// THE DENIALS ARE THE POINT. Nothing here fixes a refusal by granting the capability to the refused
// persona: `generalManager` is the unauthorized persona throughout and stays that way, and the
// separately-granted Principal holds admin.employeeProfile.write ONLY, which is how "the Job Role
// capability is its own" is proved rather than asserted.
//
// AND THE REFUSALS ARE NON-VACUOUS. Every refused run below is paired with a run that differs in
// exactly ONE input and SUCCEEDS, so a refusal can never be an accident of a broken fixture.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = require("../scripts/administerEmployeeCli.js");
const creation = require("../lib/eosWorkforce/commands/employeeCreationCommand.js");
const profileCmd = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
const linkCmd = require("../lib/eosWorkforce/commands/employeePrincipalLinkCommands.js");
const jobRoleCmd = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
const jobRoleSeed = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");
const actorAuthority = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
const companies = require("../lib/eosWorkforce/migration/tenantOperatingCompanies.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
// DERIVED FROM THE CANONICAL MODULE, NEVER RETYPED. The retired ids are read from the map that records
// WHY each was withdrawn and what replaced it; retiring another position closes this test over it with
// no edit here, and a test that hardcoded `owner` would go on passing after a rename.
const { SUPERSEDED_JOB_ROLE_IDS, CANONICAL_JOB_ROLE_BY_ID } = require("../lib/eosWorkforce/jobRoleVocabulary.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const REASON = "lane BT reprise: the Employee's business position, per the Owner-ruled catalog";

test("governed Job Role assignment through the operator wrapper", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_jobrole_op_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const deps = { pool };
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const roleIds = {};
  for (const tenantId of ["t1", "t2"]) {
    for (const key of ["admin", "generalManager"]) {
      roleIds[`${tenantId}:${key}`] = (await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
    }
    await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId, apply: true, actor: "employee-capability-grants:test" });
    await companies.reconcileTenantOperatingCompanies(pool, { tenantId, companyIds: ["taylor"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
    // The CANONICAL catalog, created by the EXISTING governed seed. This suite mints no Job Role of its own.
    await jobRoleSeed.seedJobRoleCatalog(pool, { tenantId, actor: "job-role-catalog-seed:test", apply: true });
  }

  const makePrincipal = async (tenantId, subject, roleKey) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await repo.transact(fixture(tenantId), async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
    });
    return { principalId, subject };
  };
  const admin = await makePrincipal("t1", "uid-admin", "admin");
  const gm = await makePrincipal("t1", "uid-gm", "generalManager");
  const profileOnly = await makePrincipal("t1", "uid-profile-only", "generalManager");
  const t2Admin = await makePrincipal("t2", "uid-t2-admin", "admin");

  // A DIRECT grant of admin.employeeProfile.write and NOTHING ELSE. This Principal may create and edit
  // Employees through this very wrapper -- and still may not assign a position. That is what makes
  // "the Job Role capability is its own" a measurement rather than a claim.
  await q(
    `INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
     SELECT 'pc-profile-only', 't1', $1, c.id, 'fixture', now(), 'fixture', now(), 'fixture', now()
       FROM eos_policy.capabilities c WHERE c.key = 'admin.employeeProfile.write'`, [profileOnly.principalId]);

  const resolveActor = async (principal) => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: principal.subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };
  };
  const adminActor = await resolveActor(admin);
  const t2AdminActor = await resolveActor(t2Admin);

  // The Employees, created through the GOVERNED creation command. None of them is given a Job Role here.
  for (const [tenantId, actor, ids] of [["t1", adminActor, ["emp-jane", "emp-bob", "emp-idem", "emp-swap", "emp-audit", "emp-retired", "emp-snapshot"]], ["t2", t2AdminActor, ["emp-t2"]]]) {
    for (const employeeId of ids) {
      await creation.createEmployee(deps, actor, { employeeId, employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: `fixture Employee for the Job Role operator suite (${tenantId})` });
    }
  }

  /**
   * REAL ROWS IN THE TWO SIBLING AUTHORITIES, SO THE SNAPSHOT HAS SOMETHING TO PRESERVE.
   *
   * Work Eligibility and Operational Scope start EMPTY by ruling, and "empty before, empty after" proves
   * nothing at all. These are written through their OWN governed commands, under their OWN capabilities
   * (admin.employeeWorkEligibility.write, admin.employeeOperationalScope.write) -- never by this suite's
   * SQL -- and they are put on emp-snapshot itself, the very Employee whose Job Role is then assigned.
   * That is the strong form: the assignment must not add, end, or edit a qualification or a scope ON ITS
   * OWN TARGET, which is where a careless "keep the Employee's authority in step" would land.
   */
  const eligibilityCmd = require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js");
  const scopeCmd = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
  await q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ('wh-main', 't1', 'taylor', 'WH Main', 'Phoenix, AZ', 'ACTIVE', 'NATIVE', 'fixture', 'fixture')`);
  await eligibilityCmd.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "emp-snapshot", qualificationCode: "SERVICE_TECHNICIAN", reason: "passed certification, before any position was assigned" });
  await eligibilityCmd.assignEmployeeWorkEligibility(deps, adminActor, { employeeId: "emp-jane", qualificationCode: "WAREHOUSE_OPERATIONS", reason: "a qualification on a DIFFERENT Employee, which must also not move" });
  await scopeCmd.assignEmployeeOperationalScope(deps, adminActor, { employeeId: "emp-snapshot", scopeType: "WAREHOUSE", scopeId: "wh-main", reason: "covers the main warehouse, before any position was assigned" });

  // ════════════════════ the wrapper, wired EXACTLY as scripts/administerEmployeeCli.js main() wires it ════════════════════

  const jobRoleReads = require("../lib/eosWorkforce/reads/jobRoleReads.js");
  const cliDeps = {
    resolveEmployeeAdministrationActor: actorAuthority.resolveEmployeeAdministrationActor,
    reads: jobRoleReads,
    commands: {
      createEmployee: creation.createEmployee,
      updateEmployeeProfile: profileCmd.updateEmployeeProfile,
      linkEmployeePrincipal: linkCmd.linkEmployeePrincipal,
      unlinkEmployeePrincipal: linkCmd.unlinkEmployeePrincipal,
      relinkEmployeePrincipal: linkCmd.relinkEmployeePrincipal,
      assignEmployeeJobRole: jobRoleCmd.assignEmployeeJobRole,
    },
  };
  /** One operator invocation. `input` is built by the FENCE, so the suite never hand-shapes one. */
  const runCli = (patch = {}) => {
    const { tenantKey = "t1", adminPrincipalId = admin.principalId, apply = true, employeeId, jobRoleId, reason = REASON } = patch;
    const options = cli.assertInvocation({
      environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey, performedBy: "lane-bt-operator",
      adminPrincipalId, command: "assignEmployeeJobRole", employeeId, jobRoleId, reason,
      ...(apply ? { apply: "true" } : {}),
    }, { DB: "postgres://unused-the-pool-is-injected", EOS_ENVIRONMENT: "nonprod" });
    return cli.administerEmployeeRun(pool, { ...options, tenantKey }, cliDeps);
  };

  const currentRole = async (employeeId) => (await q(
    `SELECT job_role_id FROM eos_workforce.employee_job_role_assignments
      WHERE employee_id = $1 AND effective_to IS NULL`, [employeeId])).rows.map((r) => r.job_role_id);
  const assignmentRows = async (employeeId) => (await q(
    `SELECT id, tenant_id, job_role_id, assigned_by, reason, effective_to IS NULL AS current, ended_by
       FROM eos_workforce.employee_job_role_assignments WHERE employee_id = $1 ORDER BY effective_from, id`, [employeeId])).rows;
  const jobRoleAudits = async (employeeId) => (await q(
    `SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events
      WHERE target_id = $1 AND action = $2 ORDER BY occurred_at, id`, [employeeId, jobRoleCmd.JOB_ROLE_ASSIGN_ACTION])).rows;

  /**
   * EVERY AUTHORITY DIMENSION A JOB ROLE ASSIGNMENT MUST LEAVE ALONE -- as ROWS, not as counts.
   *
   * A targeted assertion ("the Employee gained no Security Role") passes while a side effect lands on
   * some OTHER Principal, some other Employee or some other tenant. This snapshots the whole relation
   * and compares it whole, which is the form that catches the effect nobody predicted. It deliberately
   * includes the two sibling Workforce authorities the Owner decomposed operationalRoles into -- Work
   * Eligibility and Operational Scope -- because "a position implies a qualification" is exactly the
   * inference this system exists to refuse.
   */
  const authoritySnapshot = async () => ({
    // SECURITY ROLE (8)
    roleAssignments: (await q(`SELECT principal_id, role_id, status::text, scope_type, scope_value FROM eos_policy.user_role_assignments ORDER BY 1, 2, 4`)).rows,
    roles: (await q(`SELECT id, key, origin::text FROM eos_policy.roles ORDER BY id`)).rows,
    roleCapabilities: (await q(`SELECT role_id, capability_id FROM eos_policy.role_capabilities ORDER BY 1, 2`)).rows,
    principalCapabilities: (await q(`SELECT principal_id, capability_id FROM eos_policy.principal_capabilities ORDER BY 1, 2`)).rows,
    capabilities: (await q(`SELECT id, key FROM eos_policy.capabilities ORDER BY id`)).rows,
    principals: (await q(`SELECT id, status::text, identity_provider, external_subject FROM eos_policy.principals ORDER BY id`)).rows,
    memberships: (await q(`SELECT principal_id, tenant_id, status::text FROM eos_policy.tenant_memberships ORDER BY 1, 2`)).rows,
    principalLinks: (await q(`SELECT employee_id, principal_id, status::text FROM eos_policy.employee_principal_links ORDER BY 1, 2`)).rows,
    // WORK ELIGIBILITY (9) -- effective-dated, so the CURRENT flag is part of the row: an assignment that
    // silently ENDED a qualification would otherwise compare equal on code alone.
    workEligibility: (await q(`SELECT tenant_id, employee_id, qualification_code, assigned_by, ended_by, effective_to IS NULL AS current FROM eos_workforce.employee_work_eligibility ORDER BY 1, 2, 3, 6`)).rows,
    // OPERATIONAL SCOPE (10)
    operationalScopes: (await q(`SELECT tenant_id, employee_id, scope_type, scope_id, assigned_by, ended_by, effective_to IS NULL AS current FROM eos_workforce.employee_operational_scopes ORDER BY 1, 2, 3, 4, 7`)).rows,
    // and the Employee record itself, plus the Job Role CATALOG, which an assignment never edits
    employees: (await q(`SELECT id, tenant_id, employment_status::text, operating_company_id, display_name, job_title FROM eos_workforce.employees ORDER BY tenant_id, id`)).rows,
    jobRoleCatalog: (await q(`SELECT tenant_id, id, display_name, status FROM eos_workforce.job_roles ORDER BY 1, 2`)).rows,
    reporting: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships`)).rows[0].n,
  });

  // ════════════════════ 1 ════════════════════

  await t.test("1 -- an AUTHORIZED Principal assigns a Job Role through the wrapper: one current row, the outcome the command returned, nothing invented", async () => {
    assert.deepEqual(await currentRole("emp-jane"), [], "the fixture Employee started with a Job Role");
    const planned = await runCli({ employeeId: "emp-jane", jobRoleId: "service-technician", apply: false });
    assert.deepEqual([planned.outcome, planned.result], ["PLANNED", null]);
    assert.deepEqual(await currentRole("emp-jane"), [], "a dry run wrote an assignment");

    const report = await runCli({ employeeId: "emp-jane", jobRoleId: "service-technician" });
    assert.deepEqual([report.outcome, report.command, report.tenantId, report.adminRoleKeys], ["ASSIGNED", "assignEmployeeJobRole", "t1", ["admin"]]);
    assert.deepEqual(report.input, { employeeId: "emp-jane", jobRoleId: "service-technician", reason: REASON });
    assert.deepEqual([report.result.employeeId, report.result.jobRoleId, report.result.endedAssignmentId], ["emp-jane", "service-technician", null]);

    const rows = await assignmentRows("emp-jane");
    assert.equal(rows.length, 1);
    // THE AUDIT IDENTITY IS THE RESOLVED PRINCIPAL, never the operator string on argv.
    assert.deepEqual([rows[0].tenant_id, rows[0].job_role_id, rows[0].current, rows[0].assigned_by, rows[0].reason, rows[0].ended_by],
      ["t1", "service-technician", true, admin.principalId, REASON, null]);
    assert.notEqual(rows[0].assigned_by, "lane-bt-operator");
    // The position exists in the canonical vocabulary; the wrapper did not mint it.
    assert.ok(CANONICAL_JOB_ROLE_BY_ID["service-technician"]);
  });

  // ════════════════════ 2 ════════════════════

  await t.test("2 -- an UNAUTHORIZED caller is REFUSED, and holding the PROFILE capability is not holding the JOB ROLE one", async () => {
    const attempt = (adminPrincipalId) => runCli({ adminPrincipalId, employeeId: "emp-bob", jobRoleId: "retail-sales" });
    // generalManager: no Job Role capability by Role and none directly.
    await assert.rejects(attempt(gm.principalId), (e) => e.code === "CAPABILITY_REQUIRED" && /admin\.employeeJobRole\.write/.test(e.message));
    // The DIRECTLY granted Principal holds admin.employeeProfile.write only -- and is refused all the same.
    await assert.rejects(attempt(profileOnly.principalId), (e) => e.code === "CAPABILITY_REQUIRED" && /admin\.employeeJobRole\.write/.test(e.message));
    assert.deepEqual(await currentRole("emp-bob"), [], "a refused caller assigned a Job Role");
    assert.equal((await jobRoleAudits("emp-bob")).length, 0, "a refused caller wrote an audit event");

    // NON-VACUOUS: the identical run, changing ONLY the Principal, succeeds. Nothing was granted to the
    // refused personas to get here -- the authorized persona was authorized before the suite started.
    const ok = await attempt(admin.principalId);
    assert.deepEqual([ok.outcome, await currentRole("emp-bob")], ["ASSIGNED", ["retail-sales"]]);
    // And the refused Principal still holds exactly what it held: no capability was added to make this pass.
    assert.deepEqual((await q(`SELECT c.key FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE pc.principal_id = $1`,
      [profileOnly.principalId])).rows.map((r) => r.key), ["admin.employeeProfile.write"]);
  });

  // ════════════════════ 3 and 4 ════════════════════

  await t.test("3 -- a NONEXISTENT Employee is refused, and 4 -- a NONEXISTENT Job Role is refused", async () => {
    const good = { employeeId: "emp-idem", jobRoleId: "parts-associate" };
    await assert.rejects(runCli({ ...good, employeeId: "emp-does-not-exist" }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    await assert.rejects(runCli({ ...good, jobRoleId: "not-a-position" }), (e) => e.code === "JOB_ROLE_NOT_FOUND");
    // Nothing was created to satisfy either name: an operator tool never invents its own target.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employees WHERE id = 'emp-does-not-exist'`)).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.job_roles WHERE id = 'not-a-position'`)).rows[0].n, 0);
    // NON-VACUOUS: with BOTH names real -- the only difference -- the same invocation succeeds.
    assert.equal((await runCli(good)).outcome, "ASSIGNED");
    assert.deepEqual(await currentRole("emp-idem"), ["parts-associate"]);
  });

  // ════════════════════ 5 ════════════════════

  await t.test("5 -- a RETIRED Job Role id is refused, and its canonical REPLACEMENT is not", async () => {
    const retired = Object.keys(SUPERSEDED_JOB_ROLE_IDS).sort();
    // READ FROM THE MAP, NOT RETYPED. The Owner named three (`owner`, `parts-warehouse`, `accounting`,
    // the withdrawn LAUNCH_JOB_ROLES entries); the map records SIX, because the sampleCompany.v2 catalog
    // contributed `administrator`, `dispatcher` and `finance-manager` as well. Deriving the set is what
    // makes the extra three covered for free -- and is why retiring a seventh position closes this test
    // over it with no edit here.
    for (const named of ["owner", "parts-warehouse", "accounting"]) assert.ok(retired.includes(named), named);
    assert.equal(retired.length, 6);
    for (const jobRoleId of retired) {
      // The retired id is WELL-SHAPED -- it is not refused for looking wrong. It is refused because the
      // canonical catalog, created by the governed seed, contains no such position: the ruling withdrew
      // it, createJobRole refuses to re-create it (JOB_ROLE_ID_SUPERSEDED), and so there is nothing to
      // assign. The operator cannot put a withdrawn position back on an Employee.
      assert.match(jobRoleId, /^[a-z][a-z0-9-]{1,62}$/);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.job_roles WHERE tenant_id = 't1' AND id = $1`, [jobRoleId])).rows[0].n, 0);
      await assert.rejects(runCli({ employeeId: "emp-retired", jobRoleId }), (e) => e.code === "JOB_ROLE_NOT_FOUND", jobRoleId);
      // And the governed CATALOG writer refuses to re-open the hole from the other side.
      await assert.rejects(jobRoleCmd.createJobRole(deps, adminActor, { jobRoleId, displayName: `Re-created ${jobRoleId}` }),
        (e) => e.code === "JOB_ROLE_ID_SUPERSEDED", jobRoleId);
    }
    assert.deepEqual(await currentRole("emp-retired"), [], "a retired position was assigned");

    // NON-VACUOUS, id by id: the position the ruling named as the REPLACEMENT assigns cleanly through the
    // same invocation. The refusal is about the retired VOCABULARY, not about this Employee or this run.
    // Each replacement gets its OWN Employee, because since the #1969 ruling a second, different
    // position through this wrapper is a JOB_ROLE_RECONCILIATION_CONFLICT rather than a CHANGED -- so
    // reusing one Employee would have measured the new refusal instead of the replacement.
    for (const [i, jobRoleId] of retired.entries()) {
      const replacement = SUPERSEDED_JOB_ROLE_IDS[jobRoleId].replacedBy[0];
      assert.ok(CANONICAL_JOB_ROLE_BY_ID[replacement], `${jobRoleId} -> ${replacement} is not canonical`);
      const employeeId = `emp-replaced-${i}`;
      await creation.createEmployee(deps, adminActor, { employeeId, employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: `fixture for the ${jobRoleId} replacement case` });
      assert.equal((await runCli({ employeeId, jobRoleId: replacement })).outcome, "ASSIGNED", replacement);
      assert.deepEqual(await currentRole(employeeId), [replacement]);
    }
  });

  // ════════════════════ 6, 11 and 12 ════════════════════

  await t.test("6 -- re-assigning the CURRENT position is IDEMPOTENT (NO_CHANGE), 11 -- a real mutation writes EXACTLY ONE audit event, 12 -- a no-change rerun writes NONE", async () => {
    // MEASURED, not assumed: the command's contract for a duplicate is NO_CHANGE, not a CONFLICT. It
    // returns the EXISTING assignment id, ends nothing and writes nothing -- so an operator may re-run a
    // half-finished apply without a refusal and without a second row.
    const before = await assignmentRows("emp-idem");
    assert.deepEqual([before.length, before[0].job_role_id], [1, "parts-associate"]);
    assert.equal((await jobRoleAudits("emp-idem")).length, 1, "the real mutation in test 3/4 did not write exactly one audit event");

    const rerun = await runCli({ employeeId: "emp-idem", jobRoleId: "parts-associate", reason: "a different reason on an identical re-run" });
    assert.equal(rerun.outcome, "NO_CHANGE");
    assert.deepEqual([rerun.result.assignmentId, rerun.result.endedAssignmentId], [before[0].id, null]);
    // No second row, no ended row, and the ORIGINAL reason is untouched -- a no-change does not rewrite history.
    assert.deepEqual(await assignmentRows("emp-idem"), before);
    // 12: NO DUPLICATE AUDIT. Still exactly the one event the real assignment wrote.
    assert.equal((await jobRoleAudits("emp-idem")).length, 1, "a no-change rerun wrote a second audit event");

    // 11, in full: the one event names the action, the resolved Principal, the before/after and the reason.
    const [event] = await jobRoleAudits("emp-idem");
    assert.deepEqual([event.action, event.actor_uid, event.before, event.reason],
      ["employee.jobRole.assign", admin.principalId, null, REASON]);
    assert.equal(event.after.jobRoleId, "parts-associate");
    // And a THIRD run, still identical, still adds nothing. Idempotence is not a one-shot property.
    assert.equal((await runCli({ employeeId: "emp-idem", jobRoleId: "parts-associate" })).outcome, "NO_CHANGE");
    assert.equal((await jobRoleAudits("emp-idem")).length, 1);
  });

  // ════════════════════ 7 ════════════════════

  await t.test("7 -- REPLACING a position: the GOVERNED RULE (CHANGED, prior row ended, history kept) is intact at the command, and the OPERATOR path refuses to reach it", async () => {
    // Through the wrapper, the first assignment converges normally...
    const first = await runCli({ employeeId: "emp-swap", jobRoleId: "retail-sales" });
    assert.equal(first.outcome, "ASSIGNED");
    // ...and a DIFFERENT position does NOT. See the dedicated reconciliation block below for the full
    // proof that the command is never called; here the point is only that the operator path stops.
    await assert.rejects(runCli({ employeeId: "emp-swap", jobRoleId: "national-accounts-sales", reason: "moved to national accounts, per the approved position change" }),
      (e) => e.code === "JOB_ROLE_RECONCILIATION_CONFLICT");
    assert.deepEqual(await currentRole("emp-swap"), ["retail-sales"], "the refused run moved the position anyway");

    // THE GOVERNED COMMAND'S OWN BEHAVIOUR IS UNCHANGED AND STILL CORRECT (EMP-RT-08). Called directly --
    // which is what the explicit business-role-change path does -- it ends the prior row and creates the
    // new current one, exactly as it always has. The ruling constrained the RECONCILIATION path, not the
    // command, and this asserts the command did not quietly lose the behaviour it is supposed to have.
    const second = await jobRoleCmd.assignEmployeeJobRole(deps, adminActor, { employeeId: "emp-swap", jobRoleId: "national-accounts-sales", reason: "moved to national accounts, per the approved position change" });
    assert.equal(second.outcome, "CHANGED");
    assert.equal(second.endedAssignmentId, first.result.assignmentId);

    const rows = await assignmentRows("emp-swap");
    assert.equal(rows.length, 2, "history was overwritten rather than kept");
    assert.deepEqual(rows.map((r) => [r.job_role_id, r.current]), [["retail-sales", false], ["national-accounts-sales", true]]);
    assert.equal(rows[0].ended_by, admin.principalId, "the ended row does not record who ended it");
    assert.deepEqual(await currentRole("emp-swap"), ["national-accounts-sales"]);
    // Retail Sales and National Accounts Sales are DISTINCT canonical positions; nothing collapsed them.
    assert.ok(CANONICAL_JOB_ROLE_BY_ID["retail-sales"] && CANONICAL_JOB_ROLE_BY_ID["national-accounts-sales"]);
    // Two real mutations, two audit events -- the replacement is one event, not an end plus an assign,
    // and the REFUSED attempt in between added none.
    assert.equal((await jobRoleAudits("emp-swap")).length, 2);
    const [, change] = await jobRoleAudits("emp-swap");
    assert.deepEqual([change.before.jobRoleId, change.after.jobRoleId], ["retail-sales", "national-accounts-sales"]);

    // EXPECTED-CURRENT PROTECTION DOES NOT APPLY HERE, AND IS NOT INVENTED. The link commands' revoke and
    // move take a MANDATORY --expectedCurrentPrincipalId because unlink/relink require one;
    // assignEmployeeJobRole accepts exactly three fields and no compare-and-swap, so the wrapper offers
    // none. Both halves are asserted, because "we chose not to add it" has to be checkable.
    const fence = (patch) => cli.assertInvocation({
      environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "t1", performedBy: "op",
      adminPrincipalId: admin.principalId, command: "assignEmployeeJobRole", employeeId: "emp-swap",
      jobRoleId: "retail-sales", reason: REASON, ...patch,
    }, { DB: "postgres://x", EOS_ENVIRONMENT: "nonprod" });
    assert.deepEqual(Object.keys(fence({}).input).sort(), ["employeeId", "jobRoleId", "reason"]);
    assert.throws(() => fence({ expectedCurrentPrincipalId: "p-x" }), (e) => e.code === "ARGUMENT_NOT_ACCEPTED");
    assert.throws(() => fence({ expectedCurrentJobRoleId: "retail-sales" }), (e) => e.code === "UNKNOWN_FLAG_REFUSED");
    // The command itself would refuse a fourth field, which is why the wrapper must not compose one.
    await assert.rejects(jobRoleCmd.assignEmployeeJobRole(deps, adminActor, { employeeId: "emp-swap", jobRoleId: "retail-sales", expectedCurrentJobRoleId: "national-accounts-sales", reason: REASON }),
      (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED");
    // The concurrency guarantee it DOES have: one current assignment per Employee, enforced by the database.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments WHERE employee_id = 'emp-swap' AND effective_to IS NULL`)).rows[0].n, 1);
  });

  // ════════════════════ 8, 9 and 10 ════════════════════

  await t.test("8/9/10 -- a real assignment changes NO Security Role, NO Work Eligibility and NO Operational Scope: the authority relations are identical before and after, row for row", async () => {
    const before = await authoritySnapshot();
    const report = await runCli({ employeeId: "emp-snapshot", jobRoleId: "warehouse-associate" });
    assert.equal(report.outcome, "ASSIGNED", "the snapshot bracketed a run that did not mutate");
    const after = await authoritySnapshot();

    // 8 -- Security Role, and everything the policy authority holds.
    assert.deepEqual(after.roleAssignments, before.roleAssignments, "a Job Role assignment moved a Security Role assignment");
    assert.deepEqual(after.roles, before.roles);
    assert.deepEqual(after.roleCapabilities, before.roleCapabilities, "a Job Role assignment changed role_capabilities");
    assert.deepEqual(after.principalCapabilities, before.principalCapabilities, "a Job Role assignment granted a capability directly");
    assert.deepEqual(after.capabilities, before.capabilities, "a Job Role assignment changed the capability catalog");
    assert.deepEqual(after.principals, before.principals);
    assert.deepEqual(after.memberships, before.memberships);
    assert.deepEqual(after.principalLinks, before.principalLinks, "a Job Role assignment linked a Principal");
    // 9 -- Work Eligibility. The position implies no qualification.
    assert.deepEqual(after.workEligibility, before.workEligibility, "a Job Role assignment wrote Work Eligibility");
    // 10 -- Operational Scope. The position implies no WHERE.
    assert.deepEqual(after.operationalScopes, before.operationalScopes, "a Job Role assignment wrote an Operational Scope");
    // and the Employee record, the catalog and the reporting graph are untouched too.
    assert.deepEqual(after.employees, before.employees, "a Job Role assignment edited the Employee record");
    assert.deepEqual(after.jobRoleCatalog, before.jobRoleCatalog, "a Job Role assignment edited the catalog");
    assert.deepEqual(after.reporting, before.reporting);

    // NON-VACUOUS, TWICE OVER. The snapshot is not comparing two empty pictures: it holds real rows in
    // every dimension it claims to guard...
    assert.ok(before.roleAssignments.length >= 4 && before.principalCapabilities.length >= 1 && before.roleCapabilities.length >= 1);
    assert.ok(before.capabilities.length >= 1 && before.jobRoleCatalog.length >= 16 && before.employees.length >= 8);
    // ...including in the two dimensions that start empty by ruling, and ON THE EMPLOYEE BEING MUTATED:
    assert.deepEqual(before.workEligibility.filter((r) => r.employee_id === "emp-snapshot").map((r) => [r.qualification_code, r.current]), [["SERVICE_TECHNICIAN", true]]);
    assert.deepEqual(before.operationalScopes.filter((r) => r.employee_id === "emp-snapshot").map((r) => [r.scope_type, r.scope_id, r.current]), [["WAREHOUSE", "wh-main", true]]);
    assert.equal(before.workEligibility.length, 2, "the Work Eligibility snapshot holds only the mutated Employee's row");
    // ...and the ONE thing that was supposed to move DID move, which is what proves the comparison could
    // have failed at all.
    assert.deepEqual(await currentRole("emp-snapshot"), ["warehouse-associate"]);
    assert.equal((await jobRoleAudits("emp-snapshot")).length, 1);
  });

  // ════════════════════ 13 ════════════════════

  await t.test("13 -- argv that FABRICATES authority is refused by name, before a database is opened", async () => {
    const argv = (patch) => cli.assertInvocation({
      environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "t1", performedBy: "op",
      adminPrincipalId: gm.principalId, command: "assignEmployeeJobRole", employeeId: "emp-audit",
      jobRoleId: "office-administration", reason: REASON, ...patch,
    }, { DB: "postgres://x", EOS_ENVIRONMENT: "nonprod" });
    // The refused persona of test 2, now TRYING TO ARGUE its way past the gate it was refused by.
    for (const flag of ["capabilities", "heldRoleKeys", "roles", "role", "grants", "permissions", "entitlements", "securityRole", "jobRole"]) {
      assert.throws(() => argv({ [flag]: "admin.employeeJobRole.write" }), (e) => e.code === "AUTHORITY_ARGUMENT_REFUSED", flag);
    }
    for (const flag of ["tenantId", "principalId", "uid", "externalSubject"]) {
      assert.throws(() => argv({ [flag]: "t1" }), (e) => e.code === "AUTHORITY_ARGUMENT_REFUSED", flag);
    }
    assert.throws(() => argv({ force: "true" }), (e) => e.code === "UNKNOWN_FLAG_REFUSED");
    assert.throws(() => argv({ password: "x" }), (e) => e.code === "CREDENTIAL_ARGUMENT_REFUSED");
    // NON-VACUOUS: argv identical but for the fabricated flag is ACCEPTED by the fence -- and then the
    // governed gate refuses THAT Principal on its own, reading the same PostgreSQL it always reads. The
    // fence refuses the ARGUMENT; the command refuses the CALLER; neither depends on the other.
    const accepted = argv({});
    assert.deepEqual(accepted.input, { employeeId: "emp-audit", jobRoleId: "office-administration", reason: REASON });
    await assert.rejects(cli.administerEmployeeRun(pool, { ...accepted, tenantKey: "t1", apply: true }, cliDeps), (e) => e.code === "CAPABILITY_REQUIRED");
    assert.deepEqual(await currentRole("emp-audit"), []);
    // And the report the wrapper builds READS the authority; it never echoes an asserted one.
    const authorized = await runCli({ employeeId: "emp-audit", jobRoleId: "office-administration" });
    assert.deepEqual([authorized.outcome, authorized.adminRoleKeys, authorized.adminDirectCapabilityKeys], ["ASSIGNED", ["admin"], []]);
  });

  // ════════════════════ 14 ════════════════════

  await t.test("14 -- a CROSS-TENANT assignment is refused: by the Employee's tenant, by the catalog's tenant, and by membership", async () => {
    // t2's administrator, administering in t2, cannot reach t1's Employee. It is not a permission error:
    // the Employee is simply not in the tenant the actor was resolved for.
    await assert.rejects(runCli({ tenantKey: "t2", adminPrincipalId: t2Admin.principalId, employeeId: "emp-jane", jobRoleId: "service-technician" }),
      (e) => e.code === "EMPLOYEE_NOT_FOUND");
    // t1's administrator cannot administer IN t2 either: the wrapper resolves the actor against the
    // named tenant and the resolver refuses a Principal that is not an ACTIVE member of it.
    await assert.rejects(runCli({ tenantKey: "t2", adminPrincipalId: admin.principalId, employeeId: "emp-t2", jobRoleId: "service-technician" }),
      (e) => e.code === "ADMINISTRATOR_NOT_ACTIVE_MEMBER");
    assert.deepEqual(await currentRole("emp-t2"), [], "a cross-tenant run assigned a Job Role");
    // t1's Employee kept the position test 1 gave it: nothing was reassigned or ended by a refused run.
    assert.deepEqual(await currentRole("emp-jane"), ["service-technician"]);

    // NON-VACUOUS: t2's administrator assigning t2's OWN Employee -- the same call, one tenant changed --
    // succeeds, and the row lands in t2.
    const ok = await runCli({ tenantKey: "t2", adminPrincipalId: t2Admin.principalId, employeeId: "emp-t2", jobRoleId: "service-technician" });
    assert.equal(ok.outcome, "ASSIGNED");
    const [row] = await assignmentRows("emp-t2");
    assert.deepEqual([row.tenant_id, row.job_role_id, row.assigned_by], ["t2", "service-technician", t2Admin.principalId]);
    // And t1's catalog and assignments were not touched by any of it.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments WHERE tenant_id = 't2'`)).rows[0].n, 1);
  });

  // ════════════════════ the RECONCILIATION precondition (Owner ruling on #1969) ════════════════════

  await t.test("R -- the reconciliation precondition: absent ASSIGNS, identical NO_CHANGES, DIFFERENT refuses JOB_ROLE_RECONCILIATION_CONFLICT and the governed command is NEVER CALLED", async () => {
    for (const id of ["emp-rec-a", "emp-rec-b"]) {
      await creation.createEmployee(deps, adminActor, { employeeId: id, employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "fixture Employee for the reconciliation precondition" });
    }

    /**
     * THE INJECTION. The commands map is the wrapper's ONLY way to reach a governed write, so a spy in
     * that slot answers the question directly: was the command entered at all? Row counts and audit
     * counts can only ever show that it did not *finish* -- this shows it was never *started*, which is
     * the property the ruling actually asks for. The spy still delegates, so the ASSIGN and NO_CHANGE
     * cases are real writes against the real command and not a mock's idea of one.
     */
    const calls = [];
    const spyDeps = {
      ...cliDeps,
      commands: {
        ...cliDeps.commands,
        assignEmployeeJobRole: (...args) => { calls.push(args[2]); return jobRoleCmd.assignEmployeeJobRole(...args); },
      },
    };
    const options = (employeeId, jobRoleId, apply) => ({
      ...cli.assertInvocation({
        environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "t1", performedBy: "lane-bt-operator",
        adminPrincipalId: admin.principalId, command: "assignEmployeeJobRole", employeeId, jobRoleId,
        reason: REASON, ...(apply ? { apply: "true" } : {}),
      }, { DB: "postgres://unused", EOS_ENVIRONMENT: "nonprod" }), tenantKey: "t1",
    });
    const runSpy = (employeeId, jobRoleId) => cli.administerEmployeeRun(pool, options(employeeId, jobRoleId, true), spyDeps);

    // R1 -- NO CURRENT ASSIGNMENT -> the command runs -> ASSIGNED.
    const assigned = await runSpy("emp-rec-a", "service-manager");
    assert.deepEqual([assigned.outcome, calls.length], ["ASSIGNED", 1]);
    assert.deepEqual(assigned.jobRolePrecondition, { employeeId: "emp-rec-a", currentJobRoleId: null, requestedJobRoleId: "service-manager", disposition: "ASSIGN" });
    assert.deepEqual(await currentRole("emp-rec-a"), ["service-manager"]);

    // R2 -- THE SAME ASSIGNMENT -> the command runs -> NO_CHANGE, no duplicate row, NO SECOND AUDIT EVENT.
    const beforeRows = await assignmentRows("emp-rec-a");
    const noChange = await runSpy("emp-rec-a", "service-manager");
    assert.deepEqual([noChange.outcome, calls.length], ["NO_CHANGE", 2], "an idempotent rerun did not reach the command");
    assert.equal(noChange.jobRolePrecondition.disposition, "NO_CHANGE");
    assert.deepEqual(await assignmentRows("emp-rec-a"), beforeRows, "an idempotent rerun wrote a row");
    assert.equal((await jobRoleAudits("emp-rec-a")).length, 1, "an idempotent rerun wrote a second audit event");

    // R3 -- A DIFFERENT ASSIGNMENT -> REFUSED, AND THE COMMAND IS NEVER ENTERED.
    const auditsBefore = await jobRoleAudits("emp-rec-a");
    const callsBefore = calls.length;
    await assert.rejects(runSpy("emp-rec-a", "service-technician"), (e) => {
      assert.equal(e.code, "JOB_ROLE_RECONCILIATION_CONFLICT");
      // The refusal carries the three NON-SECRET facts a person needs to decide, and nothing more.
      assert.deepEqual(e.details, { employeeId: "emp-rec-a", currentJobRoleId: "service-manager", requestedJobRoleId: "service-technician" });
      // and it leaks no authority: no Principal id, no capability, no connection string.
      const printed = `${e.message} ${JSON.stringify(e.details)}`;
      assert.doesNotMatch(printed, new RegExp(admin.principalId));
      assert.doesNotMatch(printed, /admin\.employee|postgres:|password/);
      return true;
    });
    // THE PROOF: the spy never fired. The command was not called -- not called and rolled back, NOT CALLED.
    assert.equal(calls.length, callsBefore, "the governed command was entered on a refused reconciliation");
    // and, independently of the spy, nothing moved: prior assignment unchanged, requested one never created.
    assert.deepEqual(await assignmentRows("emp-rec-a"), beforeRows, "the refused run mutated an assignment");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments WHERE employee_id = 'emp-rec-a' AND job_role_id = 'service-technician'`)).rows[0].n, 0);
    // NO AUDIT EVENT FOR THE REFUSAL -- the existing convention, which records applied mutations only.
    assert.deepEqual(await jobRoleAudits("emp-rec-a"), auditsBefore, "the refused reconciliation wrote an audit event");

    // NON-VACUOUS: the SAME call, against an Employee whose current position MATCHES, succeeds. The only
    // difference is the conflict itself -- not the position, not the actor, not the reason.
    // `service-technician` is a real, ACTIVE, canonical position and is assignable right now.
    assert.equal((await runSpy("emp-rec-b", "service-technician")).outcome, "ASSIGNED");
    assert.equal((await runSpy("emp-rec-b", "service-technician")).outcome, "NO_CHANGE");
    assert.deepEqual(await currentRole("emp-rec-b"), ["service-technician"]);

    // A DRY RUN REFUSES TOO. A plan that promised a convergence the apply would refuse is the worse of
    // the two failures, so the precondition runs before the dry-run return -- and still writes nothing.
    const planned = await cli.administerEmployeeRun(pool, options("emp-rec-b", "service-technician", false), spyDeps);
    assert.deepEqual([planned.outcome, planned.result, planned.jobRolePrecondition.disposition], ["PLANNED", null, "NO_CHANGE"]);
    await assert.rejects(cli.administerEmployeeRun(pool, options("emp-rec-b", "service-manager", false), spyDeps),
      (e) => e.code === "JOB_ROLE_RECONCILIATION_CONFLICT");
    assert.deepEqual(await currentRole("emp-rec-b"), ["service-technician"]);
  });

  await t.test("R4 -- A PARTIAL 2C RERUN IS SAFE over mixed state: the unassigned converge, the correct no-op, the conflicting one refuses, and nothing is left half-written", async () => {
    // The state a real re-run meets: some Employees were never assigned, some already hold exactly what
    // the manifest says, and one holds something else because a human changed it after the first pass.
    for (const id of ["emp-2c-new-1", "emp-2c-new-2", "emp-2c-same", "emp-2c-conflict"]) {
      await creation.createEmployee(deps, adminActor, { employeeId: id, employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: "fixture Employee for the partial 2C rerun" });
    }
    const manifest = [
      ["emp-2c-new-1", "parts-manager"],
      ["emp-2c-new-2", "warehouse-manager"],
      ["emp-2c-same", "office-manager"],
      ["emp-2c-conflict", "reporting-analyst"],
    ];
    // The first pass got one of the four done before it stopped...
    await runCli({ employeeId: "emp-2c-same", jobRoleId: "office-manager" });
    // ...and somebody then deliberately moved the fourth person, through the explicit change path.
    await jobRoleCmd.assignEmployeeJobRole(deps, adminActor, { employeeId: "emp-2c-conflict", jobRoleId: "general-manager", reason: "a deliberate business position change after the first pass" });

    const auditCount = async () => (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = $1`, [jobRoleCmd.JOB_ROLE_ASSIGN_ACTION])).rows[0].n;
    const auditsBefore = await auditCount();
    const rerun = async () => {
      const outcomes = [];
      for (const [employeeId, jobRoleId] of manifest) {
        try {
          outcomes.push([employeeId, (await runCli({ employeeId, jobRoleId })).outcome]);
        } catch (err) {
          outcomes.push([employeeId, err.code]);
          // The refusal names the person and both positions, so the rerun's report is actionable.
          assert.deepEqual(err.details, { employeeId, currentJobRoleId: "general-manager", requestedJobRoleId: "reporting-analyst" });
        }
      }
      return outcomes;
    };
    assert.deepEqual(await rerun(), [
      ["emp-2c-new-1", "ASSIGNED"],
      ["emp-2c-new-2", "ASSIGNED"],
      ["emp-2c-same", "NO_CHANGE"],
      ["emp-2c-conflict", "JOB_ROLE_RECONCILIATION_CONFLICT"],
    ]);
    // THE RERUN DID NOT STOP AT THE CONFLICT and did not skip past it either: the two missing positions
    // converged, the correct one was left alone, and the disputed person was NOT moved.
    assert.deepEqual(await currentRole("emp-2c-new-1"), ["parts-manager"]);
    assert.deepEqual(await currentRole("emp-2c-new-2"), ["warehouse-manager"]);
    assert.deepEqual(await currentRole("emp-2c-same"), ["office-manager"]);
    assert.deepEqual(await currentRole("emp-2c-conflict"), ["general-manager"], "a rerun changed a person's position to match a manifest");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments WHERE employee_id = 'emp-2c-conflict'`)).rows[0].n, 1, "the refused Employee was left with half a history");
    // NOTHING HALF-WRITTEN: exactly two new audit events for the two real convergences, none for the
    // no-op and none for the refusal, and no Employee anywhere has two current positions.
    assert.equal(await auditCount(), auditsBefore + 2);
    assert.deepEqual((await q(
      `SELECT employee_id FROM eos_workforce.employee_job_role_assignments WHERE effective_to IS NULL
        GROUP BY employee_id HAVING count(*) > 1`)).rows, [], "an Employee ended up with two current positions");
    // AND THE RERUN IS ITSELF RE-RUNNABLE: a third pass converges nothing new and refuses the same one.
    assert.deepEqual((await rerun()).map(([, o]) => o), ["NO_CHANGE", "NO_CHANGE", "NO_CHANGE", "JOB_ROLE_RECONCILIATION_CONFLICT"]);
    assert.equal(await auditCount(), auditsBefore + 2);
  });

  await t.test("R5 -- the precondition is FAIL-CLOSED: a Principal that may WRITE the Job Role but may not READ the Employee is refused, not waved through", async () => {
    // A Principal with NO Role at all and ONE direct grant: admin.employeeJobRole.write. It can satisfy
    // the command's gate and cannot satisfy the precondition's, which is the only combination where
    // "what do we do when the check cannot be evaluated" has a wrong answer available.
    const writeOnly = await repo.transact(fixture("t1"), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: "uid-write-only", identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await q(
      `INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
       SELECT 'pc-write-only', 't1', $1, c.id, 'fixture', now(), 'fixture', now(), 'fixture', now()
         FROM eos_policy.capabilities c WHERE c.key = 'admin.employeeJobRole.write'`, [writeOnly]);
    const resolved = await actorAuthority.resolveEmployeeAdministrationActor(pool, { tenantId: "t1", principalId: writeOnly });
    assert.deepEqual([[...resolved.heldRoleKeys], [...resolved.directCapabilityKeys]], [[], ["admin.employeeJobRole.write"]]);
    assert.ok(resolved.capabilities.has("admin.employeeJobRole.write") && !resolved.capabilities.has("employee.record.read"));

    // IT IS REFUSED, AND BY THE READ -- the precondition stops the run rather than being skipped because
    // it could not be evaluated. A check that silently turns itself off under a narrower caller is worse
    // than no check, because the report still says the run was governed.
    await assert.rejects(runCli({ adminPrincipalId: writeOnly, employeeId: "emp-rec-a", jobRoleId: "service-manager" }),
      (e) => e.code === "CAPABILITY_REQUIRED" && /employee\.record\.read/.test(e.message));
    assert.deepEqual(await currentRole("emp-rec-a"), ["service-manager"], "the fail-closed refusal still wrote");

    // AND THIS IS A NARROWING, NOT A WIDENING: every governed Role that holds the WRITE also holds the
    // READ, so no Role that could run this operation before the precondition existed lost it. Measured
    // against the tenant's own reconciled grants, not asserted from the catalog source.
    const holders = async (key) => (await q(
      `SELECT DISTINCT r.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.roles r ON r.id = rc.role_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE r.tenant_id = 't1' AND c.key = $1 ORDER BY r.key`, [key])).rows.map((x) => x.key);
    const writers = await holders("admin.employeeJobRole.write");
    const readers = await holders("employee.record.read");
    assert.ok(writers.length > 0, "no Role holds the Job Role write capability, so the comparison proves nothing");
    assert.deepEqual(writers.filter((k) => !readers.includes(k)), [], "a Role holds the Job Role write but not employee.record.read");
  });

  // ════════════════════ the standing invariants ════════════════════

  await t.test("the wrapper added NO capability and NO grant: the policy catalog is exactly what the existing reconciliation produced", async () => {
    // admin.employeeJobRole.write EXISTED before this lane and is unchanged. This asserts the shape of
    // the fact (the capability is present, registered once, and is NOT the profile capability), not a
    // live nonprod count -- this database is a disposable migration of the same source.
    const rows = (await q(`SELECT key, count(*)::int n FROM eos_policy.capabilities WHERE key LIKE 'admin.employee%' GROUP BY key ORDER BY key`)).rows;
    assert.ok(rows.some((r) => r.key === "admin.employeeJobRole.write" && r.n === 1));
    assert.equal(jobRoleCmd.EMPLOYEE_JOB_ROLE_WRITE, "admin.employeeJobRole.write");
    // The wrapper names ONE capability nowhere: it names none at all, and gates on none of its own.
    assert.deepEqual([...cli.COMMANDS].filter((c) => c.toLowerCase().includes("jobrole")), ["assignEmployeeJobRole"]);
  });
});

// EMP-RT-08: the governed PostgreSQL JOB ROLE authority (tenant catalog, one current Job Role + history) against a real postgres:16.
//
// The suite migrates its OWN disposable database. Roles, grants, Principals and Employees exist ONLY there; grants are
// delivered through the EXISTING Role-catalog reconciliation and actors are resolved through the EXISTING operational
// context resolver -- never hand-built capability sets.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const jobRoles = require("../lib/eosWorkforce/commands/employeeJobRoleCommands.js");
const jobRoleReads = require("../lib/eosWorkforce/reads/jobRoleReads.js");
const seed = require("../lib/eosWorkforce/migration/jobRoleCatalogSeed.js");
const { CANONICAL_JOB_ROLE_IDS, SUPERSEDED_JOB_ROLE_IDS, CANONICAL_PERSONA_JOB_ROLES }
  = require("../lib/eosWorkforce/jobRoleVocabulary.js");
const seedCli = require("../scripts/jobRoleCatalogSeedCli.js");
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

const PROFILE_SELECT = `SELECT employee_number, display_name, first_name, job_title, work_email, address_city, address_postal_code,
  to_char(hire_date, 'YYYY-MM-DD') AS hire_date, updated_at FROM eos_workforce.employees WHERE id = $1`;

test("Job Role catalog, assignment and reads over the real Workforce and policy authorities", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_job_role_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    for (const key of ["admin", "generalManager"]) {
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
      return tx.createAssignment({ principalId, roleId: roleIds[`${tenantId}:${roleKey}`], scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
    });
    return { principalId, subject };
  };
  const resolveActor = async (principal) => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: principal.subject, requestedTenantId: null });
    return { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };
  };
  const employee = (id, tenant = "t1", extra = {}) => {
    const cols = Object.keys(extra);
    return q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at${cols.map((c) => `, ${c}`).join("")})
              VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z'${cols.map((_, i) => `, $${i + 3}`).join("")})`, [id, tenant, ...Object.values(extra)]);
  };
  const profile = async (id) => (await q(PROFILE_SELECT, [id])).rows[0];
  const audits = async (id) => (await q(`SELECT action, actor_uid, before, after, reason FROM eos_policy.audit_events WHERE target_kind = 'employee' AND target_id = $1 ORDER BY occurred_at, id`, [id])).rows;

  const admin = await makePrincipal("t1", "firebase-uid-admin", "admin");
  const gm = await makePrincipal("t1", "firebase-uid-gm", "generalManager");
  const t2Admin = await makePrincipal("t2", "firebase-uid-t2-admin", "admin");
  await employee("e-edit", "t1", { display_name: "Robert Jones", first_name: "Robert", job_title: "Tech", employee_number: "TAZ-0001" });
  await employee("e-other", "t1", { employee_number: "TAZ-0002" });
  await employee("e-t2", "t2", { display_name: "Foreign", employee_number: "TAZ-0009" });
  // e-linked is linked to the admin Principal: the Principal id must never stand in for the Employee id.
  await employee("e-linked", "t1", { display_name: "Admin Person" });
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
           VALUES ('epl-admin', 't1', $1, 'e-linked', 'taylor', 'OPERATOR_ASSERTED', 'fixture-operator', 'test fixture')`, [admin.principalId]);

  const deps = { pool };
  const adminActor = await resolveActor(admin);
  const history = async (id) => (await q(`SELECT job_role_id, effective_to IS NULL AS current, assigned_by, ended_by FROM eos_workforce.employee_job_role_assignments WHERE employee_id = $1 ORDER BY effective_from, id`, [id])).rows;
  const roleAudits = async (id) => (await q(`SELECT action, actor_uid, before, after FROM eos_policy.audit_events WHERE target_id = $1 AND action = 'employee.jobRole.assign' ORDER BY occurred_at, id`, [id])).rows;
  // Everything a Job Role must NEVER touch, snapshotted: Security Role assignments and grants, Employee lifecycle and
  // profile facts, reporting relationships, and every ownership / accountability / assignment column that exists.
  const untouchable = async () => ({
    roleAssignments: (await q(`SELECT principal_id, role_id, status FROM eos_policy.user_role_assignments ORDER BY 1, 2`)).rows,
    roleCapabilities: (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n,
    employees: (await q(`SELECT id, employment_status::text, operating_company_id, job_title, updated_at FROM eos_workforce.employees ORDER BY id`)).rows,
    reporting: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships`)).rows[0].n,
    ownership: (await q(`SELECT count(*)::int n FROM eos_commercial.ownership_handoffs`)).rows[0].n,
    accounts: (await q(`SELECT count(*)::int n FROM eos_crm.accounts`)).rows[0].n,
  });

  // SIXTEEN, NOT TEN (Owner ruling 2026-09-25). This subtest used to name "the ten ruled roles" and pin the ten
  // display names of the 2026-09-16 launch catalog. That catalog is no longer an authority: LAUNCH_JOB_ROLES now
  // PROJECTS from src/eosWorkforce/jobRoleVocabulary.ts, the one canonical Job Role vocabulary.
  //
  // WHAT THIS SUBTEST IS FOR, and what it is deliberately NOT for. It proves the seed puts the WHOLE canonical
  // vocabulary into eos_workforce.job_roles, once, idempotently, assigning nothing. Whether the vocabulary is the
  // RIGHT sixteen is pinned offline, against a transcription of the ruling, by
  // test/canonicalJobRoleVocabulary.test.mjs -- restating the sixteen names here would duplicate that pin and put
  // two transcriptions of one ruling in the repository. So the expectation is read from the vocabulary, and what is
  // written out literally is the part a derived assertion could not catch: that the three ids this file used to
  // create are GONE from the seeded catalog, and that the positions replacing them are present.
  await t.test("launch catalog seed: dry run writes nothing; apply adds the whole canonical vocabulary; idempotent; never assigns; CLI fenced to taylor-nonprod", async () => {
    const dry = await seed.seedJobRoleCatalog(pool, { tenantId: "t1", actor: "job-role-catalog-seed:test" });
    assert.deepEqual([dry.additions.length, dry.applied, (await q(`SELECT count(*)::int n FROM eos_workforce.job_roles`)).rows[0].n],
      [CANONICAL_JOB_ROLE_IDS.length, false, 0]);
    assert.equal(CANONICAL_JOB_ROLE_IDS.length, 16, "the ruling names sixteen positions");
    const applied = await seed.seedJobRoleCatalog(pool, { tenantId: "t1", actor: "job-role-catalog-seed:test", apply: true });
    assert.equal(applied.applied, true);
    const listed = await jobRoleReads.listJobRoles(deps, adminActor, {});
    // Every canonical position reached the table, and nothing else did.
    assert.deepEqual(listed.items.map((r) => r.jobRoleId).sort(), [...CANONICAL_JOB_ROLE_IDS]);
    // The three ids the pre-ruling launch catalog created are retired and must not be seeded again. `owner` is the
    // sharpest of them: it is a live Security Role key, which is why the Owner's POSITION is `owner-executive`.
    const seeded = new Set(listed.items.map((r) => r.jobRoleId));
    for (const retired of ["owner", "parts-warehouse", "accounting"]) {
      assert.ok(SUPERSEDED_JOB_ROLE_IDS[retired], `${retired} must be recorded as superseded`);
      assert.ok(!seeded.has(retired), `the retired id ${retired} was seeded`);
    }
    // ... and the positions that replaced them are there, including the four `parts-warehouse` was fused from.
    for (const replacement of ["owner-executive", "parts-associate", "parts-manager", "warehouse-associate", "warehouse-manager", "finance-accounting"]) {
      assert.ok(seeded.has(replacement), `${replacement} is missing from the seeded catalog`);
    }
    assert.ok(!listed.items.some((r) => /^sales$/i.test(r.displayName)), "a generic Sales role exists");
    assert.equal(new Set(listed.items.map((r) => r.displayName)).size, listed.items.length, "two positions share a display name");
    const again = await seed.seedJobRoleCatalog(pool, { tenantId: "t1", actor: "job-role-catalog-seed:test", apply: true });
    assert.deepEqual([again.additions, again.applied, again.alreadyPresent.length], [[], false, CANONICAL_JOB_ROLE_IDS.length]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments`)).rows[0].n, 0, "the seed assigned a Job Role");
    await seed.seedJobRoleCatalog(pool, { tenantId: "t2", actor: "job-role-catalog-seed:test", apply: true }); // t2 gets its own catalog rows
    const base = { environment: "platform-sandbox", databaseUrlEnv: "DB", tenantKey: "taylor-nonprod", performedBy: "op" };
    const env = { DB: "postgres://x", EOS_ENVIRONMENT: "nonprod" };
    assert.equal(seedCli.assertSeedInvocation(base, env).apply, false);
    assert.throws(() => seedCli.assertSeedInvocation({ ...base, tenantKey: "sample-co" }, env), /taylor-nonprod/);
    for (const e of ["taylor-parts-production", "platform-certification", "platform-integration"]) assert.throws(() => seedCli.assertSeedInvocation({ ...base, environment: e }, env), e);
    assert.throws(() => seedCli.assertSeedInvocation(base, { ...env, EOS_ENVIRONMENT: "production" }));
  });

  await t.test("initial assignment, change (closes old + opens new atomically), same-role NO_CHANGE; audit + history; nothing else touched", async () => {
    const before = await untouchable();
    const first = await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-edit", jobRoleId: "retail-sales", reason: "hired into retail" });
    assert.deepEqual([first.outcome, first.endedAssignmentId], ["ASSIGNED", null]);
    const changed = await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-edit", jobRoleId: "national-accounts-sales" });
    assert.deepEqual([changed.outcome, changed.endedAssignmentId], ["CHANGED", first.assignmentId]);
    assert.deepEqual((await history("e-edit")).map((h) => [h.job_role_id, h.current, h.assigned_by, h.ended_by]),
      [["retail-sales", false, admin.principalId, admin.principalId], ["national-accounts-sales", true, admin.principalId, null]]);
    const same = await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-edit", jobRoleId: "national-accounts-sales" });
    assert.deepEqual([same.outcome, same.assignmentId, (await history("e-edit")).length], ["NO_CHANGE", changed.assignmentId, 2]);
    assert.deepEqual((await roleAudits("e-edit")).map((a) => [a.actor_uid, a.before?.jobRoleId ?? null, a.after.jobRoleId]),
      [[admin.principalId, null, "retail-sales"], [admin.principalId, "retail-sales", "national-accounts-sales"]]);
    assert.deepEqual(await untouchable(), before, "a Job Role changed Security Role, grants, lifecycle, operating company, reporting, ownership or accounts");
    const h = await jobRoleReads.listEmployeeJobRoleHistory(deps, adminActor, { employeeId: "e-edit" });
    assert.deepEqual([h.current.jobRoleId, h.current.displayName, h.items.length, h.items[1].current], ["national-accounts-sales", "National Accounts Sales", 2, false]);
    await assert.rejects(q(`DELETE FROM eos_workforce.employee_job_role_assignments WHERE employee_id = 'e-edit'`), /DELETE is refused/);
    // A LIVE position, deliberately: the refusal is about the COLUMN, not about the id being unknown. A correction
    // to a current assignment is made by assigning again through the governed writer, never by an UPDATE.
    await assert.rejects(q(`UPDATE eos_workforce.employee_job_role_assignments SET job_role_id = 'finance-accounting' WHERE employee_id = 'e-edit' AND effective_to IS NULL`), /only permitted change/);
  });

  // THE DEACTIVATED POSITION IS finance-accounting, not `accounting`. `accounting` was retired by the Owner ruling
  // of 2026-09-25 -- it named a department rather than a position -- so it is not in the seeded catalog and every
  // call here refused with JOB_ROLE_NOT_FOUND instead of proving anything about INACTIVE. SUPERSEDED_JOB_ROLE_IDS
  // records finance-accounting as its replacement, and the assertion below pins that so the substitution is not a
  // silent choice of a convenient id.
  await t.test("inactive, unknown and foreign-tenant Job Roles refused; inactive role stays readable in history", async () => {
    assert.deepEqual(SUPERSEDED_JOB_ROLE_IDS.accounting.replacedBy, ["finance-accounting"]);
    await jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-other", jobRoleId: "finance-accounting" });
    const off = await jobRoles.updateJobRole(deps, adminActor, { jobRoleId: "finance-accounting", status: "INACTIVE" });
    assert.equal(off.outcome, "UPDATED");
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-linked", jobRoleId: "finance-accounting" }), (e) => e.code === "JOB_ROLE_INACTIVE");
    // A RETIRED id is simply unknown to the catalog, which is the other half of the same point.
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-linked", jobRoleId: "accounting" }), (e) => e.code === "JOB_ROLE_NOT_FOUND");
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-linked", jobRoleId: "astronaut" }), (e) => e.code === "JOB_ROLE_NOT_FOUND");
    await q(`INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, updated_by) VALUES ('t2', 't2-only-role', 'T2 Only', 'ACTIVE', 'x', 'x')`);
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-linked", jobRoleId: "t2-only-role" }), (e) => e.code === "JOB_ROLE_NOT_FOUND");
    assert.equal((await history("e-linked")).length, 0);
    const hist = await jobRoleReads.listEmployeeJobRoleHistory(deps, adminActor, { employeeId: "e-other" });
    assert.deepEqual([hist.current.jobRoleId, hist.current.jobRoleStatus], ["finance-accounting", "INACTIVE"], "an inactive role must stay readable");
    assert.ok((await jobRoleReads.listJobRoles(deps, adminActor, {})).items.some((r) => r.jobRoleId === "finance-accounting" && r.status === "INACTIVE"));
    await jobRoles.updateJobRole(deps, adminActor, { jobRoleId: "finance-accounting", status: "ACTIVE" });
  });

  await t.test("foreign-tenant Employee, Principal id and provider subject refused; inactive/no membership refused", async () => {
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-t2", jobRoleId: "retail-sales" }), (e) => e.code === "EMPLOYEE_NOT_FOUND");
    for (const substitute of [admin.principalId, admin.subject]) {
      await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: substitute, jobRoleId: "retail-sales" }), (e) => e.code === "EMPLOYEE_NOT_FOUND", substitute);
    }
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, { ...adminActor, tenantId: "t2" }, { employeeId: "e-t2", jobRoleId: "retail-sales" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    const temp = await makePrincipal("t1", "firebase-uid-jr-temp", "admin");
    const tempActor = await resolveActor(temp);
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1`, [temp.principalId]);
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, tempActor, { employeeId: "e-linked", jobRoleId: "retail-sales" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    await q(`UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1`, [temp.principalId]);
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [temp.principalId]);
    await assert.rejects(jobRoles.createJobRole(deps, tempActor, { jobRoleId: "temp-role", displayName: "Temp" }), (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    assert.equal((await history("e-linked")).length, 0);
  });

  await t.test("missing admin.employeeJobRole.write refused; admin.employeeProfile.write ALONE is insufficient; caller authority fields refused", async () => {
    await assert.rejects(jobRoles.assignEmployeeJobRole(deps, await resolveActor(gm), { employeeId: "e-linked", jobRoleId: "retail-sales" }), (e) => e.code === "CAPABILITY_REQUIRED");
    // A Principal holding ONLY admin.employeeProfile.write (a custom Role granted exactly that capability).
    const role = await repo.transact(fixture("t1"), (tx) => tx.createRole({ key: "profile-only", name: "profile-only", description: null, origin: "CUSTOM", protected: false }));
    await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
             SELECT 'rc-profile-only', 't1', $1, id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities WHERE key = 'admin.employeeProfile.write'`, [role.id]);
    const profileOnlyId = await repo.transact(fixture("t1"), async (tx) => { const p = await tx.createPrincipal({ externalSubject: "firebase-uid-profile-only", identityProvider: "firebase" }); await tx.createTenantMembership(p.id); return p.id; });
    await repo.transact(fixture("t1"), async (tx) => { const v = await tx.bumpAccessVersion(profileOnlyId); return tx.createAssignment({ principalId: profileOnlyId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v }); });
    const profileOnly = await resolveActor({ principalId: profileOnlyId, subject: "firebase-uid-profile-only" });
    assert.ok(profileOnly.capabilities.has("admin.employeeProfile.write") && !profileOnly.capabilities.has("admin.employeeJobRole.write"));
    for (const call of [
      () => jobRoles.assignEmployeeJobRole(deps, profileOnly, { employeeId: "e-linked", jobRoleId: "retail-sales" }),
      () => jobRoles.createJobRole(deps, profileOnly, { jobRoleId: "sneaky", displayName: "Sneaky" }),
      () => jobRoles.updateJobRole(deps, profileOnly, { jobRoleId: "retail-sales", status: "INACTIVE" }),
    ]) await assert.rejects(call(), (e) => e.code === "CAPABILITY_REQUIRED");
    for (const extra of ["tenantId", "principalId", "capabilities", "securityRole", "ownerEmployeeId", "operatingCompanyId", "effectiveFrom"]) {
      await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-linked", jobRoleId: "retail-sales", [extra]: "x" }), (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", extra);
    }
    assert.equal((await history("e-linked")).length, 0);
  });

  await t.test("audit failure rolls back the assignment AND the ended prior row", async () => {
    const beforeHistory = await history("e-edit");
    await q(`CREATE FUNCTION test_refuse_job_role_audit() RETURNS trigger AS $$ BEGIN
               IF NEW.action = 'employee.jobRole.assign' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER test_refuse_job_role_audit BEFORE INSERT ON eos_policy.audit_events FOR EACH ROW EXECUTE FUNCTION test_refuse_job_role_audit()`);
    try {
      await assert.rejects(jobRoles.assignEmployeeJobRole(deps, adminActor, { employeeId: "e-edit", jobRoleId: "service-manager" }), (e) => e.code === "COMMAND_FAILED" && !/injected/.test(e.message));
    } finally {
      await q(`DROP TRIGGER test_refuse_job_role_audit ON eos_policy.audit_events`);
      await q(`DROP FUNCTION test_refuse_job_role_audit()`);
    }
    assert.deepEqual(await history("e-edit"), beforeHistory, "a failed assignment ended the prior role or left a new row");
  });

  await t.test("catalog: create, duplicate id/name refused, rename, no delete; remediation read counts Employees without a Job Role", async () => {
    assert.equal((await jobRoles.createJobRole(deps, adminActor, { jobRoleId: "field-trainer", displayName: "Field Trainer" })).outcome, "CREATED");
    await assert.rejects(jobRoles.createJobRole(deps, adminActor, { jobRoleId: "field-trainer", displayName: "Other" }), (e) => e.code === "JOB_ROLE_ALREADY_EXISTS");
    await assert.rejects(jobRoles.createJobRole(deps, adminActor, { jobRoleId: "field-trainer-2", displayName: "field trainer" }), (e) => e.code === "JOB_ROLE_DISPLAY_NAME_TAKEN");
    await assert.rejects(jobRoles.createJobRole(deps, adminActor, { jobRoleId: "Bad Id", displayName: "X" }), (e) => e.code === "JOB_ROLE_ID_INVALID");
    assert.equal((await jobRoles.updateJobRole(deps, adminActor, { jobRoleId: "field-trainer", displayName: "Field Trainer" })).outcome, "NO_CHANGE");
    assert.equal((await jobRoles.updateJobRole(deps, adminActor, { jobRoleId: "field-trainer", displayName: "Senior Field Trainer" })).outcome, "UPDATED");
    const catalogAudits = (await q(`SELECT action FROM eos_policy.audit_events WHERE target_kind = 'jobRole' AND target_id = 'field-trainer' ORDER BY occurred_at`)).rows.map((r) => r.action);
    assert.deepEqual(catalogAudits, ["jobRole.catalog.create", "jobRole.catalog.update"]);
    const all = (await q(`SELECT count(*)::int n FROM eos_workforce.employees WHERE tenant_id = 't1'`)).rows[0].n;
    const withRole = (await q(`SELECT count(DISTINCT employee_id)::int n FROM eos_workforce.employee_job_role_assignments WHERE tenant_id = 't1' AND effective_to IS NULL`)).rows[0].n;
    const remediation = await jobRoleReads.listEmployeesWithoutJobRole(deps, adminActor, { limit: 2 });
    assert.equal(remediation.count, all - withRole);
    assert.ok(!remediation.items.some((i) => i.employeeId === "e-edit"), "an Employee with a Job Role is in the remediation set");
    if (remediation.count > 2) assert.ok(remediation.nextCursor);
    await assert.rejects(jobRoleReads.listEmployeesWithoutJobRole(deps, await resolveActor(t2Admin), { cursor: "garbage" }), (e) => e.code === "CURSOR_INVALID");
  });

  // ════════════════════ THE TENANT CATALOG IS OPEN; THE RETIRED IDS ARE CLOSED ════════════════════
  //
  // Owner ruling: EOS supports governed TENANT-CREATED business positions, so `field-trainer` above is correct and
  // stays allowed -- the canonical sixteen govern the seed, the Taylor default catalog, the P01-P16 acceptance
  // mapping and reconciliation expectations, NOT the set a tenant may ever create. The one thing that is closed is
  // the narrow hole underneath: an id the ruling RETIRED must not be creatable again, or a caller could simply put
  // `owner` -- a live Security Role key -- back into the business-position vocabulary.
  await t.test("a retired Job Role id is REFUSED at creation, derived from the supersession map and not from a retyped list", async () => {
    // NON-VACUITY, PART 1: every retired id is a PERFECTLY VALID input by every other rule this command applies.
    // If any of these were malformed, duplicated or name-clashing, the refusal below could be the wrong refusal.
    const retired = Object.keys(SUPERSEDED_JOB_ROLE_IDS).sort();
    assert.deepEqual(retired, ["accounting", "administrator", "dispatcher", "finance-manager", "owner", "parts-warehouse"]);
    const seeded = new Set((await jobRoleReads.listJobRoles(deps, adminActor, {})).items.map((r) => r.jobRoleId));
    for (const id of retired) {
      assert.match(id, /^[a-z][a-z0-9-]{1,62}$/, `${id} must be well-shaped, or the refusal proves nothing`);
      assert.ok(!seeded.has(id), `${id} is in the catalog, so a create would refuse as a duplicate instead`);
      assert.ok(!CANONICAL_JOB_ROLE_IDS.includes(id), `${id} must not be canonical`);
    }

    // NON-VACUITY, PART 2: the SAME call shape, with a tenant id that is merely NEW rather than retired, SUCCEEDS.
    // So the only difference between acceptance and refusal is membership of the supersession map.
    const control = await jobRoles.createJobRole(deps, adminActor, { jobRoleId: "shop-foreman", displayName: "Shop Foreman" });
    assert.equal(control.outcome, "CREATED", "a tenant-created position must still be allowed");

    // Every key of the map is refused, with the named code, whatever display name is offered.
    for (const id of retired) {
      const entry = SUPERSEDED_JOB_ROLE_IDS[id];
      await assert.rejects(
        jobRoles.createJobRole(deps, adminActor, { jobRoleId: id, displayName: `Resurrected ${id}` }),
        (e) => e.code === "JOB_ROLE_ID_SUPERSEDED" && e.category === "INVALID_INPUT"
          // The message names the replacement, because that is what the caller needs in order to proceed.
          && entry.replacedBy.every((to) => e.message.includes(to)),
        id);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.job_roles WHERE id = $1`, [id])).rows[0].n, 0,
        `the refused id ${id} reached the catalog`);
    }
    // The three the pre-ruling launch catalog actually created, named explicitly -- `owner` above all, because it is
    // the one that is also a live Security Role key.
    for (const id of ["owner", "parts-warehouse", "accounting"]) assert.ok(retired.includes(id), id);

    // A RETIRED ID IS REFUSED FOR EVERY TENANT, not only the one whose catalog the ruling seeded.
    await assert.rejects(jobRoles.createJobRole(deps, await resolveActor(t2Admin), { jobRoleId: "owner", displayName: "Owner" }),
      (e) => e.code === "JOB_ROLE_ID_SUPERSEDED");

    // AND IT IS A REFUSAL AT CREATION ONLY. The seed is add-only and never removes an entry, which is the whole
    // reason the supersession map exists: a row a pre-ruling revision already created must stay renameable,
    // deactivatable and readable, or nobody could tidy it up. Proved by inserting one the way that revision would
    // have and then driving the governed writers over it.
    await q(`INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, updated_by)
             VALUES ('t1', 'accounting', 'Accounting', 'ACTIVE', 'pre-ruling-seed', 'pre-ruling-seed')`);
    try {
      assert.equal((await jobRoles.updateJobRole(deps, adminActor, { jobRoleId: "accounting", status: "INACTIVE" })).outcome, "UPDATED",
        "a pre-ruling row must stay deactivatable");
      assert.equal((await jobRoles.updateJobRole(deps, adminActor, { jobRoleId: "accounting", displayName: "Accounting (retired)" })).outcome, "UPDATED",
        "a pre-ruling row must stay renameable");
      // Creation is still refused even though the row now exists -- the refusal is about the id, not the collision.
      await assert.rejects(jobRoles.createJobRole(deps, adminActor, { jobRoleId: "accounting", displayName: "Accounting Again" }),
        (e) => e.code === "JOB_ROLE_ID_SUPERSEDED", "an existing retired row must not turn the refusal into a duplicate error");
    } finally {
      await q(`DELETE FROM eos_workforce.job_roles WHERE tenant_id = 't1' AND id = 'accounting'`);
    }
  });

  await t.test("creating a tenant Job Role grants ZERO business authority and assigns it to no Employee", async () => {
    // Invariants 3 and 5 together, as a BEFORE/AFTER snapshot of every authority relation that exists. A Job Role is
    // a vocabulary row. It is not a Security Role, it grants no capability, it is not Work Eligibility, it is not an
    // Operational Scope, it binds no workflow, and it does not put itself on anybody.
    const authorityWorld = async () => ({
      roles: (await q(`SELECT tenant_id, id, key FROM eos_policy.roles ORDER BY 1, 2`)).rows,
      roleAssignments: (await q(`SELECT principal_id, role_id, status FROM eos_policy.user_role_assignments ORDER BY 1, 2`)).rows,
      roleCapabilities: (await q(`SELECT tenant_id, role_id, capability_id FROM eos_policy.role_capabilities ORDER BY 1, 2, 3`)).rows,
      capabilities: (await q(`SELECT key FROM eos_policy.capabilities ORDER BY 1`)).rows,
      principalCapabilities: (await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities`)).rows[0].n,
      grantConditions: (await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`)).rows[0].n,
      roleObjectPermissions: (await q(`SELECT count(*)::int n FROM eos_policy.role_object_permissions`)).rows[0].n,
      workflowRoleBindings: (await q(`SELECT count(*)::int n FROM eos_policy.workflow_role_bindings`)).rows[0].n,
      workflowActions: (await q(`SELECT count(*)::int n FROM eos_policy.workflow_actions`)).rows[0].n,
      workEligibility: (await q(`SELECT employee_id, qualification_code, effective_to FROM eos_workforce.employee_work_eligibility ORDER BY 1, 2`)).rows,
      operationalScopes: (await q(`SELECT employee_id, scope_type, scope_id, effective_to FROM eos_workforce.employee_operational_scopes ORDER BY 1, 2, 3`)).rows,
      jobRoleAssignments: (await q(`SELECT employee_id, job_role_id, effective_to FROM eos_workforce.employee_job_role_assignments ORDER BY 1, 2`)).rows,
      employees: (await q(`SELECT id, employment_status::text, operating_company_id, job_title, updated_at FROM eos_workforce.employees ORDER BY 1`)).rows,
      reporting: (await q(`SELECT count(*)::int n FROM eos_workforce.employee_reporting_relationships`)).rows[0].n,
      links: (await q(`SELECT count(*)::int n FROM eos_policy.employee_principal_links`)).rows[0].n,
    });

    // NON-VACUITY: the snapshot must actually be watching something, or "nothing changed" is trivially true.
    const before = await authorityWorld();
    assert.ok(before.roles.length > 0 && before.roleCapabilities.length > 0 && before.capabilities.length > 0);
    assert.ok(before.jobRoleAssignments.length > 0, "the snapshot must contain assignments, or it cannot show none were added");

    const created = await jobRoles.createJobRole(deps, adminActor, { jobRoleId: "field-trainer-2", displayName: "Field Trainer II" });
    assert.deepEqual([created.outcome, created.jobRole.status], ["CREATED", "ACTIVE"]);

    const after = await authorityWorld();
    assert.deepEqual(after, before,
      "creating a Job Role changed a Security Role, a grant, a capability, a workflow binding, Work Eligibility, an Operational Scope, a Job Role assignment, an Employee or a Principal link");

    // The ONLY effects: one catalog row, and one catalog audit event naming the Job Role -- never an Employee.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.job_roles WHERE tenant_id = 't1' AND id = 'field-trainer-2'`)).rows[0].n, 1);
    const createAudits = (await q(`SELECT action, target_kind, target_id FROM eos_policy.audit_events WHERE target_id = 'field-trainer-2'`)).rows;
    assert.deepEqual(createAudits, [{ action: "jobRole.catalog.create", target_kind: "jobRole", target_id: "field-trainer-2" }]);

    // `field-trainer`, the position subtest 7 created, carries the same nothing -- named because the ruling names it.
    for (const tenantPosition of ["field-trainer", "field-trainer-2", "shop-foreman"]) {
      assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_job_role_assignments WHERE job_role_id = $1`, [tenantPosition])).rows[0].n, 0,
        `${tenantPosition} was assigned to an Employee by its own creation`);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.roles WHERE key = $1`, [tenantPosition])).rows[0].n, 0,
        `${tenantPosition} became a Security Role`);
      assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key LIKE '%' || $1 || '%'`, [tenantPosition])).rows[0].n, 0,
        `${tenantPosition} became a capability`);
      // Invariant 8: a tenant position is not a canonical position and can never be a P01-P16 acceptance mapping.
      assert.ok(!CANONICAL_JOB_ROLE_IDS.includes(tenantPosition));
      assert.ok(!Object.values(CANONICAL_PERSONA_JOB_ROLES).includes(tenantPosition),
        `${tenantPosition} appears in the P01-P16 mapping, which admits only the canonical sixteen`);
    }
  });

  await t.test("createJobRole is confined to the actor's tenant: no caller-supplied tenant, no cross-tenant reach, no unauthorized creation", async () => {
    // Test 8 (cross-tenant) and test 7 (unauthorized) for the CATALOG writer specifically. The capability is never
    // granted to make anything pass here -- the denial is the assertion.
    const t2Actor = await resolveActor(t2Admin);
    // A caller may not name the tenant. The tenant is the ACTOR's, resolved, never input.
    for (const extra of ["tenantId", "principalId", "capabilities", "status", "createdBy"]) {
      await assert.rejects(jobRoles.createJobRole(deps, adminActor, { jobRoleId: "smuggled", displayName: "Smuggled", [extra]: "t2" }),
        (e) => e.code === "INPUT_FIELD_NOT_ACCEPTED", extra);
    }
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.job_roles WHERE id = 'smuggled'`)).rows[0].n, 0);
    // The same id may exist in two tenants and they are separate rows; neither tenant sees the other's.
    assert.equal((await jobRoles.createJobRole(deps, t2Actor, { jobRoleId: "shop-foreman", displayName: "Shop Foreman" })).outcome, "CREATED");
    assert.deepEqual((await q(`SELECT tenant_id FROM eos_workforce.job_roles WHERE id = 'shop-foreman' ORDER BY 1`)).rows.map((r) => r.tenant_id), ["t1", "t2"]);
    assert.ok(!(await jobRoleReads.listJobRoles(deps, t2Actor, {})).items.some((r) => r.jobRoleId === "field-trainer"),
      "t2 can see a Job Role only t1 created");
    // An actor claiming a tenant it is not a member of is refused, and creates nothing.
    await assert.rejects(jobRoles.createJobRole(deps, { ...adminActor, tenantId: "t2" }, { jobRoleId: "foreign-position", displayName: "Foreign Position" }),
      (e) => e.code === "ACTOR_NOT_TENANT_MEMBER");
    // Without admin.employeeJobRole.write there is no creation at all. `gm` holds generalManager and nothing here.
    const gmActor = await resolveActor(gm);
    assert.ok(!gmActor.capabilities.has(jobRoles.EMPLOYEE_JOB_ROLE_WRITE), "the fixture must not already grant the capability");
    await assert.rejects(jobRoles.createJobRole(deps, gmActor, { jobRoleId: "unauthorized-position", displayName: "Unauthorized Position" }),
      (e) => e.code === "CAPABILITY_REQUIRED");
    for (const id of ["foreign-position", "unauthorized-position"]) {
      assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.job_roles WHERE id = $1`, [id])).rows[0].n, 0, id);
    }
  });

  await t.test("transport: Job Role reads and commands served; no Firebase module loads", async () => {
    const world = { reader: repo, pool, allowedOrigins: [], verifyToken: async () => ({ externalSubject: admin.subject, identityProvider: "firebase" }) };
    const call = async (operation, input) => {
      const res = await http.handleWorkforceRequest(world, { method: "POST", url: "/workforce/employees", headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation, input }) });
      return { status: res.status, body: JSON.parse(res.body) };
    };
    const assigned = await call("assignEmployeeJobRole", { employeeId: "e-linked", jobRoleId: "office-administration" });
    assert.deepEqual([assigned.status, assigned.body.result.outcome], [200, "ASSIGNED"]);
    assert.equal((await call("listEmployeeJobRoleHistory", { employeeId: "e-linked" })).body.result.current.displayName, "Office / Administration");
    assert.equal((await call("assignEmployeeJobRole", { employeeId: "e-linked", jobRoleId: "retail-sales", jobRole: "RETAIL" })).body.code, "AUTHORITY_FIELD_NOT_ACCEPTED");
    const probe = spawnSync(process.execPath, ["-e", `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.exit(97)}return l.call(this,r,...a)};require("./lib/eosWorkforce/commands/employeeJobRoleCommands.js");require("./lib/eosWorkforce/reads/jobRoleReads.js");require("./lib/eosWorkforce/workforceHttp.js")`], { cwd: FUNCTIONS_DIR });
    assert.equal(probe.status, 0, "a Firebase module loaded with the Job Role authority");
  });
});

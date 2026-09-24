// Steps D/E: the legacy evidence census against a real postgres:16.
//
// The offline suite proves the CLASSIFICATION. This one proves the two things only a real database can:
//
//   the resolution view is TRUE      Employees, warehouses, current qualifications and current scopes are read from
//                                    the governed tables, so a finding is judged against what PostgreSQL really holds
//   the lane MUTATES NOTHING         a full census over evidence of every kind leaves every table byte-identical,
//                                    and the read transaction is READ ONLY, so a write would be refused by PostgreSQL
//
// It also closes the loop with step C: the planned commands, when a person issues them, are ACCEPTED and turn the same
// findings into ALREADY_GOVERNED on a second census. A plan that could not be executed would be evidence of nothing.
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
const report = require("../lib/eosWorkforce/migration/legacyWorkforceEvidenceReport.js");
const { parseEmployeeProfileSnapshot } = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const eligibility = require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js");
const scopes = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
const grants = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

test("the legacy evidence census over the real governed authorities: true resolution, zero mutation, an executable plan", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `legacy_evidence_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const adminRole = await repo.transact(fixture("t1"), (tx) => tx.createRole({ key: "admin", name: "admin", description: null, origin: "CUSTOM", protected: false }));
  await grants.reconcileEmployeeCapabilityGrants(pool, { tenantId: "t1", apply: true, actor: "employee-capability-grants:test" });
  const principalId = await repo.transact(fixture("t1"), async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: "firebase-uid-admin", identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  await repo.transact(fixture("t1"), async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({
      principalId, roleId: adminRole.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });
  const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: "firebase-uid-admin", requestedTenantId: null });
  const adminActor = { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, entitlements: ctx.entitlements };

  const employee = (id, tenant = "t1") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant]);
  const warehouse = (id, tenant = "t1", status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, 'taylor', $1, 'Somewhere, AZ', $3, 'NATIVE', 'fixture', 'fixture')`, [id, tenant, status]);
  await employee("e-tech");
  await employee("e-wh");
  await employee("e-held");
  await employee("e-t2", "t2");
  await warehouse("wh-main");
  await warehouse("wh-north");
  await warehouse("wh-retired", "t1", "INACTIVE");
  await warehouse("wh-t2", "t2");

  // e-held already holds the qualification its legacy value maps to, and already covers wh-main.
  await eligibility.assignEmployeeWorkEligibility({ pool }, adminActor, { employeeId: "e-held", qualificationCode: "SERVICE_TECHNICIAN" });
  await scopes.assignEmployeeOperationalScope({ pool }, adminActor, { employeeId: "e-held", scopeType: "WAREHOUSE", scopeId: "wh-main" });

  const snapshot = parseEmployeeProfileSnapshot({
    format: "EOS_EMPLOYEE_PROFILE_SNAPSHOT", version: 1,
    source: { firebaseProjectId: "taylor-nonprod", exportedAt: "2026-09-19T00:00:00.000Z" },
    employees: [
      { id: "e-tech", data: { operationalRoles: ["TECHNICIAN", "SERVICE_MANAGER"], assignedWarehouseIds: ["wh-north"] } },
      { id: "e-wh", data: { operationalRoles: ["WAREHOUSE_ASSOCIATE"], assignedWarehouseIds: ["wh-main", "wh-retired", "wh-t2", "wh-nope"] } },
      { id: "e-held", data: { operationalRoles: ["TECHNICIAN"], assignedWarehouseIds: ["wh-main"] } },
      // In the export but not a governed Employee of this tenant -- t2's Employee, and one that no longer exists.
      { id: "e-t2", data: { operationalRoles: ["TECHNICIAN"], assignedWarehouseIds: ["wh-t2"] } },
      { id: "e-deleted", data: { assignedWarehouseIds: ["wh-main"] } },
    ],
  });

  // Every governed table, so "mutates nothing" is a claim about the database and not about four tables.
  const everything = async () => ({
    employees: (await q(`SELECT * FROM eos_workforce.employees ORDER BY id`)).rows,
    qualifications: (await q(`SELECT * FROM eos_workforce.employee_work_eligibility ORDER BY id`)).rows,
    scopes: (await q(`SELECT * FROM eos_workforce.employee_operational_scopes ORDER BY id`)).rows,
    jobRoleAssignments: (await q(`SELECT * FROM eos_workforce.employee_job_role_assignments ORDER BY id`)).rows,
    warehouses: (await q(`SELECT * FROM eos_ops.warehouses ORDER BY tenant_id, id`)).rows,
    roleAssignments: (await q(`SELECT * FROM eos_policy.user_role_assignments ORDER BY id`)).rows,
    roleCapabilities: (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities`)).rows[0].n,
    audits: (await q(`SELECT * FROM eos_policy.audit_events ORDER BY id`)).rows,
  });

  let census;
  await t.test("the resolution view is read from the governed tables, and the dispositions follow it exactly", async () => {
    census = await report.reportLegacyWorkforceEvidence(pool, { tenantId: "t1", snapshot });
    const at = (id, value) => [...census.qualificationFindings, ...census.scopeFindings]
      .filter((f) => f.employeeId === id && f.legacyValue === value).map((f) => f.disposition);

    assert.deepEqual(at("e-tech", "TECHNICIAN"), ["DETERMINISTIC_CANDIDATE"]);
    assert.deepEqual(at("e-tech", "SERVICE_MANAGER"), ["AMBIGUOUS_REMEDIATION"]);
    assert.deepEqual(at("e-tech", "wh-north"), ["DETERMINISTIC_CANDIDATE"]);
    assert.deepEqual(at("e-wh", "WAREHOUSE_ASSOCIATE"), ["DETERMINISTIC_CANDIDATE"]);
    assert.deepEqual(at("e-wh", "wh-retired"), ["INACTIVE_WAREHOUSE"], "the INACTIVE status came from the real warehouse row");
    assert.deepEqual(at("e-wh", "wh-t2"), ["CROSS_TENANT"], "another tenant's real warehouse must not read as unknown");
    assert.deepEqual(at("e-wh", "wh-nope"), ["UNKNOWN_WAREHOUSE"]);
    // Already governed, read from the rows step C actually wrote above.
    assert.deepEqual(at("e-held", "TECHNICIAN"), ["ALREADY_GOVERNED"]);
    assert.deepEqual(at("e-held", "wh-main"), ["ALREADY_GOVERNED"]);
    // An Employee of another tenant is not this tenant's Employee, however real they are elsewhere.
    assert.deepEqual(at("e-t2", "TECHNICIAN"), ["AMBIGUOUS_REMEDIATION"]);
    assert.deepEqual(at("e-t2", "wh-t2"), ["UNKNOWN_EMPLOYEE"]);
    assert.deepEqual(at("e-deleted", "wh-main"), ["UNKNOWN_EMPLOYEE"]);

    assert.equal(census.applied, false);
    assert.deepEqual(census.plan.qualifications.map((p) => [p.input.employeeId, p.input.qualificationCode]),
      [["e-tech", "SERVICE_TECHNICIAN"], ["e-wh", "WAREHOUSE_OPERATIONS"]]);
    // e-wh's wh-main IS a candidate: an exact, same-tenant, ACTIVE warehouse it does not yet cover. Only e-held's
    // wh-main is excluded, and only because a governed scope already exists for it.
    assert.deepEqual(census.plan.scopes.map((p) => [p.input.employeeId, p.input.scopeId]),
      [["e-tech", "wh-north"], ["e-wh", "wh-main"]]);
  });

  await t.test("ZERO MUTATION: the census changes nothing, writes no audit event, and cannot write if it tried", async () => {
    const before = await everything();
    await report.reportLegacyWorkforceEvidence(pool, { tenantId: "t1", snapshot });
    await report.buildWorkforceResolutionView(pool, "t1");
    assert.deepEqual(await everything(), before, "the census changed the database");

    // The view's transaction is READ ONLY, so PostgreSQL itself refuses a write -- not merely this code's restraint.
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await assert.rejects(
        client.query(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
                      VALUES ('x', 't1', 'e-tech', 'SERVICE_TECHNICIAN', now(), 'x')`),
        (e) => e.code === "25006");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    assert.deepEqual(await everything(), before);
  });

  await t.test("a missing tenant refuses, and the census never creates one", async () => {
    await assert.rejects(report.buildWorkforceResolutionView(pool, "t-nope"), /the tenant does not exist/);
    assert.deepEqual((await q(`SELECT id FROM eos_policy.tenants ORDER BY id`)).rows.map((r) => r.id), ["t1", "t2"]);
  });

  await t.test("the plan is EXECUTABLE: issuing it through the step C commands is accepted and settles the findings", async () => {
    for (const planned of census.plan.qualifications) {
      assert.equal((await eligibility.assignEmployeeWorkEligibility({ pool }, adminActor, planned.input)).outcome, "ASSIGNED");
    }
    for (const planned of census.plan.scopes) {
      assert.equal((await scopes.assignEmployeeOperationalScope({ pool }, adminActor, planned.input)).outcome, "ASSIGNED");
    }
    // A second census over the SAME snapshot now proposes nothing: every candidate is governed, and the remediation
    // set is untouched -- executing a plan must never silently resolve a finding that needs a person.
    const after = await report.reportLegacyWorkforceEvidence(pool, { tenantId: "t1", snapshot });
    assert.deepEqual(after.plan, { qualifications: [], scopes: [] });
    assert.equal(after.qualificationCounts.DETERMINISTIC_CANDIDATE, 0);
    assert.equal(after.scopeCounts.DETERMINISTIC_CANDIDATE, 0);
    assert.deepEqual(after.remediation.map((f) => [f.employeeId, f.legacyValue, f.disposition]),
      census.remediation.map((f) => [f.employeeId, f.legacyValue, f.disposition]));
  });
});

// THE PERSONA PROVISIONING WRITE BOUNDARY, PROVED END TO END AGAINST A REAL postgres:16.
//
// ============================ THE RULE UNDER TEST ============================
//
// Owner ruling, docs/DECISIONS.md #180. Six `eos_policy.role_capabilities` rows were accepted as GOVERNED CATALOG
// RECONCILIATION because they exactly match the compiled Role catalog -- and with them: "Future persona tooling must
// not broadly reconcile missing Role grants unless explicitly operating in a governed catalog-reconciliation mode."
//
// So the property is not "the persona seed refuses when a capability is missing". It is stronger, and it is about a
// whole process's effect on the canonical policy database:
//
//   NORMAL PERSONA PROVISIONING, against a policy database whose catalog lacks the capability, reports
//   POLICY_RECONCILIATION_REQUIRED, adds ZERO role_capabilities rows, writes ZERO Work Eligibility and ZERO
//   Operational Scope rows, and exits 3 -- neither 0 nor the ordinary blocked-step 1.
//
// That is asserted here by RUNNING THE REAL CLI as a child process against a database this suite migrates itself, and
// then COUNTING what is in the database afterwards. A refusal that a unit test observes as a thrown error proves
// nothing about whether some other line of the same run granted the capability anyway; a row count does.
//
// NO FIREBASE, NO EMULATOR, NO NETWORK. PostgreSQL only, on a disposable database dropped at the end.
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
const SAMPLE_COMPANY = require("../scripts/fixtures/sampleCompany.v2.json");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const PERSONA_CLI = "scripts/seedPersonaAuthorityDimensionsCli.js";
const TENANT_KEY = "taylor-nonprod";
const WORK_ELIGIBILITY_CAPABILITY = "admin.employeeWorkEligibility.write";
const OPERATIONAL_SCOPE_CAPABILITY = "admin.employeeOperationalScope.write";

/** The two Sample Company Employees this suite seeds -- deliberately a SUBSET, so most steps stay blocked. */
const employeeId = (key) => SAMPLE_COMPANY.employees.find((e) => e.key === key).id;

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

test("persona provisioning may never move the Render runtime's authority, and says so unmistakably", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `persona_boundary_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (text, values = []) => pool.query(text, values);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1', $1, 'Nonprod fixture')`, [TENANT_KEY]);
  const repo = new PostgresPolicyRepository(pool);
  const fixture = { tenantId: "t1", uid: "uid-fixture-admin" };
  const roleIds = {};
  // Both Roles the COMPILED catalog derives for these two capabilities. Neither is invented here: the reconciliation
  // reads the catalog, and a Role it names that does not exist in the tenant is reported UNRESOLVED, never created.
  for (const key of ["admin", "owner"]) {
    roleIds[key] = (await repo.transact(fixture, (tx) => tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
  }
  const adminPrincipalId = await repo.transact(fixture, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: "firebase-uid-persona-admin", identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  await repo.transact(fixture, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(adminPrincipalId);
    return tx.createAssignment({
      principalId: adminPrincipalId, roleId: roleIds.admin, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });

  // A DELIBERATE SUBSET of the persona world: one Employee for a Work Eligibility step, one for an Operational Scope
  // step, one warehouse. Everything else in the 13-step plan stays blocked for reasons that are not about capability,
  // which is what makes "fail closed on this step, continue with the rest" visible rather than asserted.
  for (const key of ["service-technician-a", "warehouse-associate"]) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
             VALUES ($1, 't1', 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [employeeId(key)]);
  }
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('SC-WH-MAIN', 't1', 'taylor', 'SYNTHETIC Main', 'Sampleton Main', 'ACTIVE', 'NATIVE', 'fixture', 'fixture')`);

  const ENV = {
    ...process.env,
    EOS_ENVIRONMENT: "nonprod",
    PERSONA_BOUNDARY_DB: dbUrlFor(name),
  };
  const BASE_ARGS = [
    "--environment", "platform-sandbox", "--databaseUrlEnv", "PERSONA_BOUNDARY_DB",
    "--tenantKey", TENANT_KEY, "--performedBy", "lane-x-operator", "--adminPrincipalId", adminPrincipalId,
  ];
  const runCli = (extra) => {
    const res = spawnSync(process.execPath, [PERSONA_CLI, ...BASE_ARGS, ...extra], { cwd: FUNCTIONS_DIR, env: ENV, encoding: "utf8" });
    const report = res.stdout.trim() ? JSON.parse(res.stdout) : null;
    return { status: res.status, report, stderr: res.stderr };
  };

  const countRoleCapabilities = async () => Number((await q(`SELECT count(*)::int AS n FROM eos_policy.role_capabilities WHERE tenant_id = 't1'`)).rows[0].n);
  const catalogHolders = async (capabilityKey) => (await q(
    `SELECT r.key FROM eos_policy.role_capabilities rc
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
       JOIN eos_policy.roles r ON r.id = rc.role_id
      WHERE rc.tenant_id = 't1' AND c.key = $1 ORDER BY r.key`, [capabilityKey])).rows.map((r) => r.key);
  const countEligibility = async () => Number((await q(`SELECT count(*)::int AS n FROM eos_workforce.employee_work_eligibility WHERE tenant_id = 't1'`)).rows[0].n);
  const countScopes = async () => Number((await q(`SELECT count(*)::int AS n FROM eos_workforce.employee_operational_scopes WHERE tenant_id = 't1'`)).rows[0].n);

  await t.test("the fixture starts with an UNRECONCILED catalog -- which is the situation being tested", async () => {
    assert.deepEqual(await catalogHolders(WORK_ELIGIBILITY_CAPABILITY), []);
    assert.deepEqual(await catalogHolders(OPERATIONAL_SCOPE_CAPABILITY), []);
    assert.equal(await countRoleCapabilities(), 0);
  });

  await t.test("X3 -- normal persona provisioning reports POLICY_RECONCILIATION_REQUIRED, writes nothing, and exits 3", async () => {
    const before = await countRoleCapabilities();
    const { status, report } = runCli(["--apply"]);

    assert.equal(report.mode, "PERSONA_PROVISIONING", "the default mode is the fail-closed one, named in the output");
    assert.equal(report.outcome, "POLICY_RECONCILIATION_REQUIRED");
    assert.deepEqual(report.policyReconciliationRequired, [OPERATIONAL_SCOPE_CAPABILITY, WORK_ELIGIBILITY_CAPABILITY].sort(),
      "the exact capability keys the canonical policy database lacks are named");
    assert.equal(report.catalogReconciliationPerformed, false);
    assert.equal(report.counts.planned, 13);
    assert.equal(report.counts.applicable, 0);
    assert.equal(report.counts.blocked, 13);
    assert.deepEqual([...new Set(report.blocked.map((b) => b.code))], ["POLICY_RECONCILIATION_REQUIRED"]);
    assert.deepEqual(report.outcomes, [], "not one governed command was called");

    // EXIT IN A WAY AN OPERATOR CANNOT MISTAKE FOR SUCCESS -- and cannot mistake for a routine partial run either.
    assert.equal(status, 3);
    assert.notEqual(status, 0);

    // AND, ABOVE ALL, THE DATABASE IS UNTOUCHED. This is the assertion the Owner's ruling is actually about.
    assert.equal(await countRoleCapabilities(), before, "persona provisioning granted nothing");
    assert.equal(await countRoleCapabilities(), 0);
    assert.equal(await countEligibility(), 0);
    assert.equal(await countScopes(), 0);
  });

  await t.test("a dry run of the same situation is identically fail-closed", async () => {
    const { status, report } = runCli([]);
    assert.equal(report.outcome, "POLICY_RECONCILIATION_REQUIRED");
    assert.equal(status, 3, "the outcome is a fact about the catalog, not about --apply");
    assert.equal(await countRoleCapabilities(), 0);
  });

  await t.test("X2 -- the catalog moves only through the explicitly named governed catalog-reconciliation mode", async () => {
    // The mode flag ALONE is not the mode. (The subprocess fence suite proves this refusal happens before `pg` loads;
    // here it is proved to leave the catalog untouched as well.)
    const halfNamed = runCli(["--governedCatalogReconciliation", "--apply"]);
    assert.notEqual(halfNamed.status, 0);
    assert.match(halfNamed.stderr, /--ownerDecision 180/);
    assert.equal(await countRoleCapabilities(), 0, "a half-named mode changed nothing");

    const dry = runCli(["--governedCatalogReconciliation", "--ownerDecision", "180"]);
    assert.equal(dry.status, 0);
    assert.equal(dry.report.mode, "GOVERNED_CATALOG_RECONCILIATION");
    assert.equal(dry.report.outcome, "PLANNED");
    assert.equal(dry.report.personaStepsAttempted, 0, "a reconciliation run provisions no persona at all");
    assert.equal(dry.report.report.proposedAdditions, 4, "admin and owner, for each of the two capabilities");
    assert.equal(await countRoleCapabilities(), 0, "and a dry run is still a dry run");

    const applied = runCli(["--governedCatalogReconciliation", "--ownerDecision", "180", "--apply"]);
    assert.equal(applied.status, 0);
    assert.equal(applied.report.outcome, "RECONCILED");
    assert.equal(applied.report.ownerDecision, "180");
    assert.equal(applied.report.report.appliedAdditions, 4);
    assert.deepEqual(applied.report.report.unresolved, []);
    assert.equal(applied.report.personaStepsAttempted, 0);

    // WHAT IT WROTE IS EXACTLY WHAT THE COMPILED CATALOG DECLARES -- admin and owner, and no other Role.
    assert.deepEqual(await catalogHolders(WORK_ELIGIBILITY_CAPABILITY), ["admin", "owner"]);
    assert.deepEqual(await catalogHolders(OPERATIONAL_SCOPE_CAPABILITY), ["admin", "owner"]);
    assert.equal(await countRoleCapabilities(), 4);
    assert.equal(await countEligibility(), 0, "and it provisioned nothing: that is the other half of the boundary");
    assert.equal(await countScopes(), 0);
  });

  await t.test("with the catalog reconciled, persona provisioning proceeds -- and still fails closed per step", async () => {
    const { status, report } = runCli(["--apply"]);
    assert.equal(report.mode, "PERSONA_PROVISIONING");
    assert.equal(report.outcome, "BLOCKED", "no capability is missing from the catalog any more, so this is the ordinary partial run");
    assert.deepEqual(report.policyReconciliationRequired, []);
    assert.equal(status, 1, "the ordinary blocked-step exit code, distinct from the unreconciled-catalog 3");
    assert.equal(report.counts.applicable, 3);
    assert.equal(report.counts.blocked, 10);
    assert.deepEqual([...new Set(report.blocked.map((b) => b.code))].sort(), ["EMPLOYEE_NOT_IN_TENANT"],
      "the remaining blocks are about the fixture subset, never about authority");
    assert.deepEqual(report.outcomes.map((o) => o.outcome), ["ASSIGNED", "ASSIGNED", "ASSIGNED"]);
    assert.equal(await countEligibility(), 2);
    assert.equal(await countScopes(), 1);
    assert.equal(await countRoleCapabilities(), 4, "provisioning added no grant of its own");
  });

  await t.test("X4 -- a re-run returns NO_CHANGE for every already-provisioned eligibility and scope fixture", async () => {
    const { status, report } = runCli(["--apply"]);
    assert.deepEqual(report.outcomes.map((o) => o.outcome), ["NO_CHANGE", "NO_CHANGE", "NO_CHANGE"],
      "idempotence is preserved: a second apply assigns nothing again");
    assert.equal(report.counts.applicable, 3);
    assert.equal(status, 1, "unchanged by this lane: the same ten blocked fixture steps");
    assert.equal(await countEligibility(), 2, "and no second CURRENT row was created");
    assert.equal(await countScopes(), 1);
    assert.equal(await countRoleCapabilities(), 4);
  });
});

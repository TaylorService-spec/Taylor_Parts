// ROLE-KEY COMPLETENESS -- the PostgreSQL proofs. Set POLICY_TEST_DATABASE_URL to run; without it the suite SKIPS.
//
// A tenant is seeded with the real seed, then three catalog Roles are removed from it (their Object CRED and
// workflow bindings with them) to model a tenant seeded before those keys existed. The reconcile must restore
// exactly those keys with exactly the Object CRED the seed had written, leave every existing Role row byte-identical,
// create no role_capabilities / user_role_assignments / workflow bindings, add zero on rerun, and do the same through
// the operator CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { ROLE_CATALOG_RECONCILE_ACTION, reconcileTenantRoleCatalog } from "../lib/adminPolicy/seed/roleCatalogReconcile.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-role-reconcile";
const KEY = "role-reconcile";
const SEEDER = "uid-seed";
const TRIMMED = Object.freeze(["emailIntakeAdministrator", "salesManager", "serviceInboundWorkReviewer"]);

async function resetDatabase() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe",
  });
}

/** Seed the tenant fully, then remove the TRIMMED Roles. Returns what the seed had written for them. */
async function seededThenTrimmed(pool) {
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [TENANT, KEY]);
  await seedTenantPolicy(new PostgresPolicyRepository(pool), TENANT, SEEDER);
  const seededCred = await credByRoleKey(pool, TRIMMED);
  const ids = (await pool.query("SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = ANY($2)", [TENANT, TRIMMED])).rows.map((r) => r.id);
  assert.equal(ids.length, TRIMMED.length);
  await pool.query("DELETE FROM eos_policy.workflow_role_bindings WHERE role_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM eos_policy.role_object_permissions WHERE role_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM eos_policy.roles WHERE id = ANY($1)", [ids]);
  return seededCred;
}

async function credByRoleKey(pool, keys) {
  const { rows } = await pool.query(
    `SELECT r.key AS role_key, o.key AS object_key, p.can_create, p.can_read, p.can_edit, p.can_delete
       FROM eos_policy.role_object_permissions p
       JOIN eos_policy.roles r ON r.id = p.role_id
       JOIN eos_policy.objects o ON o.id = p.object_id
      WHERE p.tenant_id = $1 AND r.key = ANY($2)
      ORDER BY r.key, o.key`,
    [TENANT, keys],
  );
  return rows;
}

const count = async (pool, table) => (await pool.query(`SELECT count(*)::int AS n FROM eos_policy.${table} WHERE tenant_id = $1`, [TENANT])).rows[0].n;
const roleRows = async (pool) => (await pool.query("SELECT * FROM eos_policy.roles WHERE tenant_id = $1 ORDER BY id", [TENANT])).rows;

test("an existing tenant gains exactly the missing catalog keys with the seed's own Object CRED; rerun adds zero", { skip: SKIP }, async () => {
  await resetDatabase();
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 2 }));
  try {
    const seededCred = await seededThenTrimmed(pool);
    const repo = new PostgresPolicyRepository(pool);
    const rolesBefore = await roleRows(pool);
    const tables = ["role_capabilities", "user_role_assignments", "workflow_role_bindings", "role_field_permission_overrides", "objects", "object_fields", "tenant_memberships"];
    const countsBefore = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(pool, t)])));
    const auditBefore = await count(pool, "audit_events");

    // DRY RUN: plans the three, writes nothing.
    const dry = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: "role-catalog-reconcile:test" });
    assert.equal(dry.outcome, "DRY_RUN");
    assert.deepEqual(dry.missingRoleKeys, [...TRIMMED]);
    assert.deepEqual(await roleRows(pool), rolesBefore);
    assert.ok(dry.workflowRoleBindingsNotCreated.some((b) => b.roleKey === "salesManager"), "salesManager's seed workflow bindings are reported, not created");

    // APPLY.
    const applied = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: "role-catalog-reconcile:test", apply: true });
    assert.equal(applied.outcome, "APPLIED");
    assert.equal(applied.created.roles, 3);
    const rolesAfter = await roleRows(pool);
    assert.deepEqual(rolesAfter.filter((r) => rolesBefore.some((b) => b.id === r.id)), rolesBefore, "existing Role rows are byte-identical");
    assert.deepEqual(rolesAfter.filter((r) => !rolesBefore.some((b) => b.id === r.id)).map((r) => r.key).sort(), [...TRIMMED]);
    assert.deepEqual(await credByRoleKey(pool, TRIMMED), seededCred, "the reconciled Object CRED is exactly what the seed wrote");
    for (const t of tables) assert.equal(await count(pool, t), countsBefore[t], `${t} is untouched`);
    const events = (await pool.query("SELECT action, actor_uid FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = $2", [TENANT, ROLE_CATALOG_RECONCILE_ACTION])).rows;
    assert.deepEqual(events, [{ action: ROLE_CATALOG_RECONCILE_ACTION, actor_uid: "role-catalog-reconcile:test" }]);
    assert.equal(await count(pool, "audit_events"), auditBefore + 1);

    // RERUN: zero, and no second audit event.
    const snapshot = await roleRows(pool);
    const again = await reconcileTenantRoleCatalog(repo, KEY, { actorUid: "role-catalog-reconcile:test", apply: true });
    assert.equal(again.outcome, "NOTHING_TO_RECONCILE");
    assert.deepEqual(await roleRows(pool), snapshot);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action = $1", [ROLE_CATALOG_RECONCILE_ACTION])).rows[0].n, 1);
  } finally {
    await pool.end();
  }
});

test("the operator CLI dry-runs, applies and reruns against a local database", { skip: SKIP }, async () => {
  await resetDatabase();
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 2 }));
  try {
    await seededThenTrimmed(pool);
    const rolesBefore = await roleRows(pool);
    const run = (...extra) => spawnSync(process.execPath, [
      "scripts/policyRoleCatalogReconcileCli.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "ROLE_RECONCILE_TEST_DB",
      "--tenantKey", KEY, "--performedBy", "cli-test", ...extra,
    ], { encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", ROLE_RECONCILE_TEST_DB: URL } });

    const dry = run();
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).report.outcome, "DRY_RUN");
    assert.deepEqual(await roleRows(pool), rolesBefore, "the CLI's default is a dry run");
    assert.doesNotMatch(dry.stdout + dry.stderr, /postgres:\/\//, "no connection string is printed");

    const applied = run("--apply");
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(JSON.parse(applied.stdout).report.missingRoleKeys, [...TRIMMED]);
    assert.equal((await roleRows(pool)).length, rolesBefore.length + TRIMMED.length);
    const actor = (await pool.query("SELECT DISTINCT created_by FROM eos_policy.roles WHERE tenant_id = $1 AND key = ANY($2)", [TENANT, TRIMMED])).rows;
    assert.deepEqual(actor, [{ created_by: "role-catalog-reconcile:cli-test" }]);

    const rerun = run("--apply");
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(JSON.parse(rerun.stdout).report.outcome, "NOTHING_TO_RECONCILE");
  } finally {
    await pool.end();
  }
});

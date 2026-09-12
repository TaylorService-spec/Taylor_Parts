// P1A-3 -- the capability GRANT migration tool, proved against REAL PostgreSQL (postgres:16 CI
// lane). Not an emulator, not an in-memory double: uniqueness, foreign keys and idempotent
// re-insertion are properties of PostgreSQL itself.
//
// Set POLICY_TEST_DATABASE_URL to run. Without it the suite SKIPS rather than fails.
import test from "node:test";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import {
  deriveLegacyRoleGrants,
  reconcileInventoryCapabilityGrants,
} from "../lib/eosOps/migration/inventoryCapabilityGrantMigration.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const ACTOR = "uid-migration-operator";

let pool = null;

function migrateFromClean() {
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS eos_policy CASCADE");
  await client.query("DROP SCHEMA IF EXISTS eos_ops CASCADE");
  // EVERY schema the migrations create, not only the two that existed when this reset was written.
  // A surviving schema plus a dropped `pgmigrations` makes the next `up` re-run a migration against
  // tables that are still there, and it fails. Two lanes hit this independently (eos_crm from the
  // CRM migration, eos_commercial from the commercial one) and each added only its own; the union is
  // what is correct, and `declaredSchemas()` keeps it correct for the next one without another edit.
  for (const schema of declaredSchemas()) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrateFromClean();
  await seedTenants();
}

async function seedTenants() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const id of [TENANT_A, TENANT_B]) {
    await client.query(
      "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [id, id, id],
    );
  }
  await client.end();
}

function repo() {
  pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 4 }));
  return new PostgresPolicyRepository(pool);
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

/** A real Role row in one tenant, matching a legacy Role key so a grant can resolve against it. */
async function makeRole(tenantId, key) {
  const r = repo();
  return r.transact({ tenantId, uid: ACTOR }, (tx) =>
    tx.createRole({ key, name: key, description: null, origin: "SYSTEM", protected: false }));
}

test.after(async () => {
  if (pool) await pool.end();
});

test("deriveLegacyRoleGrants: inventoryReceivingClerk holds exactly inventory.stock.receive among the new keys", () => {
  const grants = deriveLegacyRoleGrants();
  const receiveGrants = grants.filter((g) => g.roleKey === "inventoryReceivingClerk");
  assert.deepEqual(receiveGrants.map((g) => g.capabilityKey), ["inventory.stock.receive"]);
});

test("unknown tenant refuses outright", { skip: SKIP }, async () => {
  await reset();
  repo(); // ensures `pool` is initialized
  await assert.rejects(
    () => reconcileInventoryCapabilityGrants(pool, { tenantId: "no-such-tenant", actor: ACTOR }),
    /unknown tenant/,
  );
});

test("dry run (default) proposes additions and writes nothing", { skip: SKIP }, async () => {
  await reset();
  await makeRole(TENANT_A, "inventoryReceivingClerk");

  const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_A, actor: ACTOR });
  assert.equal(report.apply, false);
  assert.equal(report.appliedAdditions, 0);
  assert.ok(report.proposedAdditions >= 1);
  const proposed = report.rows.find((r) => r.roleKey === "inventoryReceivingClerk" && r.capabilityKey === "inventory.stock.receive");
  assert.equal(proposed.status, "PROPOSED");

  const rows = await query("SELECT * FROM eos_policy.role_capabilities WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(rows.rowCount, 0, "dry run must write zero rows");
});

test("apply writes exactly the proposed additions, and a second apply is a zero-change no-op", { skip: SKIP }, async () => {
  await reset();
  await makeRole(TENANT_A, "inventoryReceivingClerk");

  const first = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_A, apply: true, actor: ACTOR });
  assert.equal(first.apply, true);
  assert.ok(first.appliedAdditions >= 1);
  assert.equal(first.afterCount, first.beforeCount + first.appliedAdditions);

  const granted = await query(
    `SELECT c.key FROM eos_policy.role_capabilities rc
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
       JOIN eos_policy.roles r ON r.id = rc.role_id
      WHERE rc.tenant_id = $1 AND r.key = 'inventoryReceivingClerk'`,
    [TENANT_A],
  );
  assert.deepEqual(granted.rows.map((r) => r.key), ["inventory.stock.receive"]);

  const second = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_A, apply: true, actor: ACTOR });
  assert.equal(second.appliedAdditions, 0, "second apply must make zero additional changes");
  assert.equal(second.proposedAdditions, 0);
  assert.equal(second.afterCount, first.afterCount);
  assert.ok(second.rows.every((r) => r.status !== "PROPOSED" || r.roleKey !== "inventoryReceivingClerk"));
});

test("unresolved role (no matching eos_policy Role row) is reported, never silently skipped or fabricated", { skip: SKIP }, async () => {
  await reset();
  // No role created for TENANT_A at all -- every legacy grant is UNRESOLVED_ROLE.
  const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_A, actor: ACTOR });
  assert.ok(report.unresolved.length > 0);
  assert.ok(report.unresolved.every((r) => r.status === "UNRESOLVED_ROLE"));
  assert.equal(report.appliedAdditions, 0);
});

test("unknown capability (catalog row missing) is reported, never fabricated or silently dropped", { skip: SKIP }, async () => {
  await reset();
  await makeRole(TENANT_A, "inventoryReceivingClerk");
  await query("DELETE FROM eos_policy.capabilities WHERE key = 'inventory.stock.receive'");

  const report = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_A, actor: ACTOR });
  const row = report.rows.find((r) => r.roleKey === "inventoryReceivingClerk" && r.capabilityKey === "inventory.stock.receive");
  assert.equal(row.status, "UNKNOWN_CAPABILITY");
  assert.ok(report.unresolved.includes(row));
});

test("cross-tenant isolation: applying for tenant A never grants tenant B's identically-keyed Role", { skip: SKIP }, async () => {
  await reset();
  await makeRole(TENANT_A, "inventoryReceivingClerk");
  await makeRole(TENANT_B, "inventoryReceivingClerk");

  await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_A, apply: true, actor: ACTOR });

  const tenantBGrants = await query("SELECT * FROM eos_policy.role_capabilities WHERE tenant_id = $1", [TENANT_B]);
  assert.equal(tenantBGrants.rowCount, 0, "tenant B must hold no grant from tenant A's apply run");

  const reportB = await reconcileInventoryCapabilityGrants(pool, { tenantId: TENANT_B, actor: ACTOR });
  const stillProposedForB = reportB.rows.find((r) => r.roleKey === "inventoryReceivingClerk" && r.capabilityKey === "inventory.stock.receive");
  assert.equal(stillProposedForB.status, "PROPOSED", "tenant B's own Role must still show as ungranted");
});

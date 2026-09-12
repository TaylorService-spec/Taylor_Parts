// EOS Operational Data Plane (eos_ops) — the POSTGRESQL proofs.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE, LIKE adminPolicyPostgres.test.mjs ════════════════════
//
// Set POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails. This file resets
// BOTH `eos_policy` and `eos_ops` from clean, so it is registered in the SAME serialized
// `test:adminPolicyPostgres` command as the other two resetters -- three files sharing one schema
// must never run concurrently, and `every suite that resets the schema is covered by that one
// command` (adminPolicyPostgres.test.mjs) mechanically enforces that this file stays registered.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { declaredTablesIn } from "./support/migrationSchema.mjs";
import pg from "pg";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { resolveOperationalContext, capabilitiesForRoleKeys } from "../lib/eosOps/capabilityAuthority.js";
import { PrincipalContextError } from "../lib/adminPolicy/principalContext.js";
import * as cc from "../lib/eosOps/cycleCountRepository.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
// An OPAQUE governed key, exactly as migration 007 stores it. Deliberately not a real company name:
// nothing in this schema or these tests may depend on which companies a deployment happens to have.
const COMPANY_A = "oc-alpha";
const TENANT_B = "tenant-b";
const ACTOR = { uid: "uid-admin" };
const actorFor = (tenantId) => ({ tenantId, uid: ACTOR.uid });

let pool = null;
function repoPool() {
  pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 4 }));
  return pool;
}
function repo() {
  return new PostgresPolicyRepository(repoPool());
}

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
  // Migration 008 created a THIRD schema. A reset that re-migrates from clean has to drop every
  // schema the migrations create, not only the two that existed when it was written: a surviving
  // eos_crm plus a dropped `pgmigrations` makes the next `up` re-run 008 against tables that are
  // still there.
  await client.query("DROP SCHEMA IF EXISTS eos_crm CASCADE");
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

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

/** Make a member principal, a Role holding one capability, and an active assignment. Returns the principal id. */
async function makeCapableActor(tenantId, subject, capabilityKeys) {
  const r = repo();
  const principalId = await r.transact(actorFor(tenantId), async (tx) => {
    const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(principal.id);
    return principal.id;
  });
  const role = await r.transact(actorFor(tenantId), (tx) =>
    tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
  for (const key of capabilityKeys) {
    await query(
      `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT $1, $2, $3, c.id, $4, $4, $4 FROM eos_policy.capabilities c WHERE c.key = $5`,
      [`rc_${role.id}_${key}`, tenantId, role.id, ACTOR.uid, key],
    );
  }
  await r.transact(actorFor(tenantId), async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({
      principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: ACTOR.uid, grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });
  return { principalId, roleId: role.id };
}

// ============================ schema ============================

test("clean database -> migrate -> eos_ops exists beside eos_policy, named exactly", { skip: SKIP }, async () => {
  await reset();
  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops' ORDER BY 1",
  );
  // ════════════ THE RULE, NOT A LIST ════════════
  //
  // This was a closed, hand-written list of eos_ops tables. Every additive migration rewrote it, and
  // at the W1 integration ELEVEN of them landed at once -- eleven lanes had each edited this one
  // literal to describe a world containing only their own migration, so every version of it was
  // wrong. The list is therefore replaced by the rule it always stood in for: the live eos_ops
  // schema contains EXACTLY the tables the migration files declare -- no fewer (every declared table
  // applied) and no more (nothing crept in that no migration creates) -- and, still closed and still
  // literal below, nothing balance-shaped. See test/support/migrationSchema.mjs.
  const declared = declaredTablesIn("eos_ops");
  assert.ok(declared.length >= 4, "the migration files declare eos_ops tables at all");
  assert.deepEqual(tables.rows.map((r) => r.table_name), declared,
    "the live eos_ops schema is exactly what the migration files declare -- nothing missing, nothing extra");

  // ONE-QUANTITY-AUTHORITY, STRUCTURALLY: no second balance-shaped table exists to disagree with the
  // ledger. Naming what must NOT exist, not just what does.
  //
  // Migration 008 added `warehouses`, `bins` and `bin_code_claims`. They are LOCATION REFERENCE
  // DATA -- they say where a place is, never how much is in it -- so the rule below is unchanged
  // and still binding: `stock_locations`, the legacy per-(warehouse, part, bin) row that carried
  // both `quantity` and `quantityOnHand`, is exactly what it forbids. 008's own suite
  // (eosOpsWarehouseBinPostgres.test.mjs) additionally proves no balance-shaped COLUMN exists on
  // any of the three new tables.
  const forbidden = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops'
       AND table_name IN ('inventory_balances', 'stock_locations', 'bin_balances', 'warehouse_balances')`,
  );
  assert.deepEqual(forbidden.rows, [], "no stored balance table was created");
});

test("eos_ops tables are FK-scoped to eos_policy.tenants -- an orphan tenant_id is refused", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.inventory_movements
         (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
          movement_type, quantity_delta, source_kind, source_id, created_by)
       VALUES ('m1', 'no-such-tenant', 'oc-alpha', 'p1', 'NONE', 'WAREHOUSE', 'wh1', 'RECEIVED', 5, 'TEST', 's1', 'u')`,
    ),
    /violates foreign key constraint/,
  );
});

test("a zero-quantity movement is refused BY THE DATABASE", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.inventory_movements
         (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
          movement_type, quantity_delta, source_kind, source_id, created_by)
       VALUES ('m1', $1, 'oc-alpha', 'p1', 'NONE', 'WAREHOUSE', 'wh1', 'RECEIVED', 0, 'TEST', 's1', 'u')`,
      [TENANT_A],
    ),
    /movement_quantity_nonzero/,
  );
});

test("a SERIAL movement without a serial number is refused BY THE DATABASE", { skip: SKIP }, async () => {
  await reset();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.inventory_movements
         (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
          movement_type, quantity_delta, source_kind, source_id, created_by)
       VALUES ('m1', $1, 'oc-alpha', 'p1', 'SERIAL', 'WAREHOUSE', 'wh1', 'RECEIVED', 1, 'TEST', 's1', 'u')`,
      [TENANT_A],
    ),
    /movement_serial_matches_tracking/,
  );
});

test("serialized custody is unique per (tenant, part, serial) -- a duplicate is refused", { skip: SKIP }, async () => {
  await reset();
  await query(
    `INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
     VALUES ('sc1', $1, 'oc-alpha', 'p1', 'SN-001', 'AVAILABLE', 'WAREHOUSE', 'wh1', 'u')`,
    [TENANT_A],
  );
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
       VALUES ('sc2', $1, 'oc-alpha', 'p1', 'SN-001', 'AVAILABLE', 'WAREHOUSE', 'wh1', 'u')`,
      [TENANT_A],
    ),
    /serialized_custody_unique/,
  );
});

test("the WAREHOUSE aggregate is direct + child BIN balances, derived by SUM (ADR-014 / Decision #160)", { skip: SKIP }, async () => {
  await reset();
  const insert = (id, locType, locId, qty) => query(
    `INSERT INTO eos_ops.inventory_movements
       (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
        movement_type, quantity_delta, source_kind, source_id, created_by)
     VALUES ($1, $2, $3, 'p1', 'NONE', $4, $5, 'RECEIVED', $6, 'TEST', 's1', 'u')`,
    [id, TENANT_A, COMPANY_A, locType, locId, qty],
  );
  await insert("m1", "WAREHOUSE", "wh1", 10); // direct/unbinned
  await insert("m2", "BIN", "bin-a01", 4);
  await insert("m3", "BIN", "bin-a02", 6);

  const aggregate = await query(
    `SELECT COALESCE(SUM(quantity_delta), 0)::int AS total FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = 'p1'
        AND (location_type = 'WAREHOUSE' AND location_id = 'wh1' OR location_type = 'BIN' AND location_id IN ('bin-a01', 'bin-a02'))`,
    [TENANT_A],
  );
  assert.equal(aggregate.rows[0].total, 20, "aggregate = direct(10) + bin-a01(4) + bin-a02(6)");

  // A same-warehouse relocation WAREHOUSE-direct -> BIN nets to ZERO change in the aggregate: two
  // rows whose signed deltas cancel, exactly ADR-014's invariant.
  await insert("m4", "WAREHOUSE", "wh1", -3);
  await insert("m5", "BIN", "bin-a01", 3);
  const afterRelocation = await query(
    `SELECT COALESCE(SUM(quantity_delta), 0)::int AS total FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = 'p1'
        AND (location_type = 'WAREHOUSE' AND location_id = 'wh1' OR location_type = 'BIN' AND location_id IN ('bin-a01', 'bin-a02'))`,
    [TENANT_A],
  );
  assert.equal(afterRelocation.rows[0].total, 20, "the internal relocation left the warehouse aggregate unchanged");
});

test("the ledger is append-only at the application layer -- the repository offers no update or delete", { skip: SKIP }, async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/eosOps/cycleCountRepository.ts", "utf8");
  assert.doesNotMatch(source, /UPDATE\s+\$\{SCHEMA\}\.inventory_movements/i, "no UPDATE targets the ledger");
  assert.doesNotMatch(source, /DELETE\s+FROM\s+\$\{SCHEMA\}\.inventory_movements/i, "no DELETE targets the ledger");
  assert.match(source, /INSERT INTO \$\{SCHEMA\}\.inventory_movements/, "the only verb against it is INSERT");
});

// ============================ capability authority ============================

test("a principal with an assigned Role and a granted capability resolves it", { skip: SKIP }, async () => {
  await reset();
  await makeCapableActor(TENANT_A, "sub-counter", ["inventory.cycleCount.submit"]);
  const ctx = await resolveOperationalContext(repo(), repoPool(), { externalSubject: "sub-counter" });
  assert.equal(ctx.principalContext.tenantId, TENANT_A);
  assert.deepEqual([...ctx.capabilities], ["inventory.cycleCount.submit"]);
});

test("a Role with NO capability grant resolves an EMPTY capability set, not a throw", { skip: SKIP }, async () => {
  await reset();
  await makeCapableActor(TENANT_A, "sub-nothing", []);
  const ctx = await resolveOperationalContext(repo(), repoPool(), { externalSubject: "sub-nothing" });
  assert.deepEqual([...ctx.capabilities], []);
});

test("a disabled principal is refused, not resolved to zero capabilities silently", { skip: SKIP }, async () => {
  await reset();
  const { principalId } = await makeCapableActor(TENANT_A, "sub-disabled", ["inventory.cycleCount.submit"]);
  await query("UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1", [principalId]);
  await assert.rejects(
    () => resolveOperationalContext(repo(), repoPool(), { externalSubject: "sub-disabled" }),
    PrincipalContextError,
  );
});

test("a disabled Role assignment no longer grants its capability", { skip: SKIP }, async () => {
  await reset();
  await makeCapableActor(TENANT_A, "sub-revoked", ["inventory.cycleCount.submit"]);
  await query(
    "UPDATE eos_policy.user_role_assignments SET status = 'disabled' WHERE tenant_id = $1", [TENANT_A],
  );
  const ctx = await resolveOperationalContext(repo(), repoPool(), { externalSubject: "sub-revoked" });
  assert.deepEqual([...ctx.capabilities], [], "a disabled assignment confers nothing");
});

test("a capability granted in tenant A does not leak to tenant B for the same Role key", { skip: SKIP }, async () => {
  await reset();
  await makeCapableActor(TENANT_A, "sub-cross", ["inventory.cycleCount.reconcile"]);
  // Same subject, membership only in A -- capabilitiesForRoleKeys must not answer for B.
  const leaked = await capabilitiesForRoleKeys(repoPool(), TENANT_B, ["role-sub-cross"]);
  assert.deepEqual([...leaked], [], "tenant B sees no grant made in tenant A");
});

test("a request-supplied tenantId cannot override server-resolved tenant membership", { skip: SKIP }, async () => {
  await reset();
  await makeCapableActor(TENANT_A, "sub-spoof", ["inventory.cycleCount.create"]);
  await assert.rejects(
    () => resolveOperationalContext(repo(), repoPool(), { externalSubject: "sub-spoof", requestedTenantId: TENANT_B }),
    PrincipalContextError,
    "stating a tenant the principal does not belong to is refused, never narrowed to their real one",
  );
});

test("job title, Firebase claims and Firestore document access grant nothing -- there is no code path to read them", { skip: SKIP }, async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/eosOps/capabilityAuthority.ts", "utf8");
  assert.doesNotMatch(source, /customClaims|jobTitle|firestore/i, "no such input exists to be read as authority");
});

// ============================ Cycle Count repository contract ============================

test("blind contract: a line read before submission never carries the expected snapshot", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  assert.equal(line.expectedQuantity, undefined, "the blind view type carries no expected field at all");

  const blindRead = await cc.readLineForCounter(pool, TENANT_A, line.id);
  assert.equal(blindRead.expectedQuantity, undefined, "readLineForCounter cannot reveal it -- the column is not selected");
  assert.equal(Object.prototype.hasOwnProperty.call(blindRead, "expectedQuantity"), false);

  // The review path DOES see it -- it is a different function, not a filtered version of the same one.
  const reviewRead = await cc.readLineForReview(pool, TENANT_A, line.id);
  assert.equal(reviewRead.expectedQuantity, 42);
});

test("submit reveals the expected snapshot for the FIRST time, in the same call's own response", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  const submitted = await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  assert.equal(submitted.status, "COUNTED");
  assert.equal(submitted.expectedQuantity, 42);
  assert.equal(submitted.variance, -2);
  assert.equal(submitted.submittedBy, "counter-1");
});

test("reconcile APPROVE with non-zero variance stages ONE ledger row atomically with the line update", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  const reconciled = await cc.reconcileLine(pool, TENANT_A, "manager-1", line.id, "APPROVE", "shrinkage");
  assert.equal(reconciled.status, "RECONCILED");
  assert.ok(reconciled.ledgerMovementId, "a ledger movement id is recorded on the line");

  const movement = await query(
    "SELECT movement_type, quantity_delta, part_id FROM eos_ops.inventory_movements WHERE id = $1",
    [reconciled.ledgerMovementId],
  );
  assert.equal(movement.rows.length, 1, "exactly one ledger row was staged");
  assert.equal(movement.rows[0].movement_type, "ADJUSTED");
  assert.equal(movement.rows[0].quantity_delta, -2, "the ledger row carries the SIGNED variance");
});

test("reconcile REJECT stages NO ledger evidence -- expected-quantity authority is left untouched", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  const rejected = await cc.reconcileLine(pool, TENANT_A, "manager-1", line.id, "REJECT", null);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.ledgerMovementId, null);
  const movements = await query("SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(movements.rows[0].n, 0, "no adjustment was staged");
});

test("separation of duties: the submitter cannot reconcile their own non-zero variance", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(pool, TENANT_A, "same-person", line.id, 40, []);
  await assert.rejects(
    () => cc.reconcileLine(pool, TENANT_A, "same-person", line.id, "APPROVE", "self review"),
    cc.CycleCountSelfApprovalError,
  );
  const movements = await query("SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(movements.rows[0].n, 0, "the refused self-approval staged nothing");
});

test("one line per Part per sheet -- a duplicate is refused BY THE DATABASE", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await assert.rejects(
    () => cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 10, []),
    /cycle_count_lines_one_per_part/,
  );
});

test.after(async () => {
  if (pool) await pool.end();
});

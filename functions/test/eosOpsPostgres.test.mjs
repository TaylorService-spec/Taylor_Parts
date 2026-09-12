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
import { declaredSchemas } from "./support/migrationSchema.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { declaredTablesIn, declaredViewsIn } from "./support/migrationSchema.mjs";
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
  // EVERY schema the migrations create, read from functions/migrations rather than listed here.
  //
  // Each of these resetters carried its own hand-written list, and at the W1 integration no two of
  // them agreed: some dropped eos_crm, some eos_commercial, most neither. A schema left standing
  // while `pgmigrations` is dropped makes the next `up` re-run its migration against objects that
  // still exist -- the failure is `type "commercial_handoff_source" already exists`, 48 tests deep in
  // a suite that has nothing to do with the commercial schema. Derived, the list cannot drift again.
  for (const schema of declaredSchemas()) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  // Migration 008 created a THIRD schema. A reset that re-migrates from clean has to drop every
  // schema the migrations create, not only the two that existed when it was written: a surviving
  // eos_crm plus a dropped `pgmigrations` makes the next `up` re-run 008 against tables that are
  // still there.
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
  // BASE TABLE only. `information_schema.tables` lists views alongside tables, and the invoice and
  // cash-application migrations deliberately ship balances as VIEWS over facts; lumping the two
  // together would let a stored balance COLUMN hide behind a name that looks like a projection.
  const tables = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  const views = await query(
    `SELECT table_name FROM information_schema.views WHERE table_schema = 'eos_ops' ORDER BY 1`,
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
  assert.deepEqual(views.rows.map((r) => r.table_name), declaredViewsIn("eos_ops"),
    "and the views are exactly the declared ones -- a balance that became a stored table would " +
    "leave the view list, which is the whole point of separating the two");

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
       AND table_name IN ('inventory_balances', 'stock_locations', 'bin_balances', 'warehouse_balances',
                          'locations', 'accounts')`,
  );
  assert.deepEqual(forbidden.rows, [], "no stored balance table, and no copy of an authority this schema does not own");
});

// ============================ the financial boundary ============================

test("financial authority lives in eos_finance, and does not leak into eos_ops", { skip: SKIP }, async () => {
  // ════════════════════ WHAT THIS REPLACES, AND WHY IT IS STRONGER ════════════════════
  //
  // The eos_ops census above used to carry `'invoices'` in its forbidden list. That was the Payment
  // lane asserting "the Invoice authority is not here", written while the Invoice lane was in
  // parallel creating `eos_ops.invoices` -- a direct contradiction the W1 integration rehearsal
  // correctly left failing rather than resolving by deleting one side.
  //
  // THE OWNER RULED: Invoice and Payment are ONE financial bounded context and NEITHER belongs in
  // eos_ops. So the guard is not removed and not weakened -- it is replaced by the stronger, and
  // now decidable, two-sided claim:
  //
  //     1. every financial object EXISTS, in eos_finance;
  //     2. NO financial object exists in eos_ops.
  //
  // The old form could only ever prove half of (2) and nothing of (1): a guard saying "invoices are
  // not here" passes identically whether the authority lives in the right schema or nowhere at all.
  await reset();

  const FINANCIAL_TABLES = ["invoice_lines", "invoices", "payment_applications", "payments"];
  const FINANCIAL_VIEWS = ["invoice_application_totals", "invoice_totals", "payment_balances"];

  // (1) The schema exists and holds EXACTLY the seven objects the ruling names -- derived from the
  // migration files, in the same directory-derived way the eos_ops census above is derived, so a
  // later financial migration is simply a later financial migration.
  assert.ok(declaredSchemas().includes("eos_finance"), "the migrations declare eos_finance");
  assert.deepEqual(declaredTablesIn("eos_finance"), FINANCIAL_TABLES);
  assert.deepEqual(declaredViewsIn("eos_finance"), FINANCIAL_VIEWS);

  const liveTables = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eos_finance' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  assert.deepEqual(liveTables.rows.map((r) => r.table_name), declaredTablesIn("eos_finance"),
    "the live eos_finance schema is exactly what the migration files declare");
  const liveViews = await query(
    `SELECT table_name FROM information_schema.views WHERE table_schema = 'eos_finance' ORDER BY 1`,
  );
  assert.deepEqual(liveViews.rows.map((r) => r.table_name), declaredViewsIn("eos_finance"),
    "the balances are VIEWS -- one that became a stored table would leave this list");

  // (2) NOT ONE of them appears in eos_ops, as a table OR as a view. Named individually rather than
  // as "whatever eos_finance happens to hold", so that moving a financial table back into the
  // operational plane fails here even if it were ALSO removed from eos_finance.
  const leaked = await query(
    `SELECT table_name, table_type FROM information_schema.tables
      WHERE table_schema = 'eos_ops' AND table_name = ANY($1) ORDER BY 1`,
    [[...FINANCIAL_TABLES, ...FINANCIAL_VIEWS]],
  );
  assert.deepEqual(leaked.rows, [],
    "a financial record in the operational data plane makes 'which authority owns this row' a " +
    "question answered by reading the table name rather than by the schema");

  // And no AR-AUTHORITY column crept into eos_ops under another name, which is how a bounded
  // context actually leaks in practice -- not as a table helpfully called `invoices`.
  //
  // ════════════ WHY THIS IS NOT "NO MONEY IN eos_ops" ════════════
  //
  // `eos_ops.purchase_orders` legitimately carries `unit_price_minor` and `currency`: what a
  // supplier charges for a part is procurement reference data on an operational document, it
  // predates this ruling, and the Owner ruled about Invoice and Payment -- the AR context -- not
  // about every column denominated in money. A guard that forbade all of it would be this
  // integration inventing a boundary nobody drew, and would fail on a correct pre-existing design.
  //
  // So the list is the columns that are DISTINCTIVE to the invoice/payment authority: each one
  // states a billed obligation or a cash application, and any of them appearing in the operational
  // plane means the financial authority has been copied there whatever the table is called.
  const leakedColumns = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops'
        AND column_name IN ('invoice_id', 'invoice_number', 'payment_id',
                            'applied_minor', 'applied_amount_minor', 'unapplied_minor',
                            'outstanding_minor', 'line_total_minor', 'taxable_base_minor')
      ORDER BY 1, 2`,
  );
  assert.deepEqual(leakedColumns.rows, [],
    "eos_ops holds quantities and what they cost to procure; eos_finance holds what is owed and what was paid");

  // The operating-company authority survived the move: it is still NOT NULL with no default on
  // both financial fact tables. A bounded context that loses its company scope on the way across
  // is a bounded context that fails open.
  // BASE TABLEs only: `invoice_totals` and `payment_balances` also expose the column, because they
  // PROJECT it from the facts. A view has no nullability or default of its own to assert, and
  // including one here would be checking the projection instead of the authority.
  const company = await query(
    `SELECT c.table_name, c.is_nullable, c.column_default
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'eos_finance' AND c.column_name = 'operating_company_key'
        AND t.table_type = 'BASE TABLE'
      ORDER BY 1`,
  );
  assert.deepEqual(company.rows.map((r) => r.table_name), ["invoices", "payments"]);
  for (const row of company.rows) {
    assert.equal(row.is_nullable, "NO", `${row.table_name}.operating_company_key must be NOT NULL`);
    assert.equal(row.column_default, null, `${row.table_name}.operating_company_key must have no default`);
  }
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

// ============================ a count happens ONCE ============================
//
// `submitCount` had no status guard at all. A RECONCILED line could be re-counted -- back to COUNTED
// with a fresh variance -- and a second `reconcileLine` would post a SECOND ADJUSTED row for the same
// shelf, leaving the first as a phantom in an append-only ledger that nothing points at any more.
// This is the only module that writes eos_ops.inventory_movements, so these are the proofs that the
// bridge cannot double-post.

test("a COUNTED line cannot be re-counted with a DIFFERENT result -- that is a conflict, not an amendment", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  await assert.rejects(
    () => cc.submitCount(pool, TENANT_A, "counter-2", line.id, 37, []),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "COUNT_ALREADY_SUBMITTED",
  );
  const after = await cc.readLineForReview(pool, TENANT_A, line.id);
  assert.equal(after.countedQuantity, 40, "the first observation stands");
  assert.equal(after.variance, -2);
  assert.equal(after.submittedBy, "counter-1", "the refused re-count did not restamp who counted");
});

test("an IDENTICAL re-submit replays without restamping the submitter separation of duties is decided on", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  const before = await query("SELECT submitted_at FROM eos_ops.cycle_count_lines WHERE id = $1", [line.id]);
  const replayed = await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  assert.equal(replayed.variance, -2);
  const after = await query("SELECT submitted_at, submitted_by FROM eos_ops.cycle_count_lines WHERE id = $1", [line.id]);
  assert.deepEqual(after.rows[0].submitted_at, before.rows[0].submitted_at, "a retry is not a second count");
  assert.equal(after.rows[0].submitted_by, "counter-1");
});

test("a RECONCILED line cannot be re-counted -- the adjustment cannot be posted a second time", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []);
  await cc.reconcileLine(pool, TENANT_A, "manager-1", line.id, "APPROVE", "shrinkage");

  await assert.rejects(
    () => cc.submitCount(pool, TENANT_A, "counter-1", line.id, 35, []),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "STATUS_INVALID",
  );
  // And the decided line stays decided, so a second reconcile has nothing to post either.
  await assert.rejects(
    () => cc.reconcileLine(pool, TENANT_A, "manager-2", line.id, "APPROVE", "again"),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "STATUS_INVALID",
  );
  const movements = await query(
    "SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND source_id = $2",
    [TENANT_A, line.id],
  );
  assert.equal(movements.rows[0].n, 1, "exactly one adjustment exists for this line, ever");
});

test("an OVERAGE posts a POSITIVE quantity_delta -- the signed variance is never re-signed", { skip: SKIP }, async () => {
  // The double-negation this contract exists to prevent: ADJUSTED is SIGNED, so applying a sign to an
  // already-signed variance would turn a found overage into a second shortage.
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  const submitted = await cc.submitCount(pool, TENANT_A, "counter-1", line.id, 45, []);
  assert.equal(submitted.variance, 3);
  const reconciled = await cc.reconcileLine(pool, TENANT_A, "manager-1", line.id, "APPROVE", "found stock");
  const movement = await query("SELECT quantity_delta FROM eos_ops.inventory_movements WHERE id = $1", [reconciled.ledgerMovementId]);
  assert.equal(movement.rows[0].quantity_delta, 3, "the overage is an increase, exactly as counted");
});

test("the repository derives quantity_delta from the ONE sign authority and computes no sign of its own", async () => {
  // Not skipped: this needs no database, and the rule it pins is the reason this module exists.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/eosOps/cycleCountRepository.ts", "utf8");
  assert.match(source, /from "\.\.\/inventoryLedger\/locationOnHand\.js"/, "the sign authority is imported");
  assert.match(source, /signedQuantity\(\{ type: "ADJUSTED", quantity: line\.variance as number \}\)/);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /-\s*line\.variance/, "no hand-written negation of the variance");
  assert.doesNotMatch(code, /Math\.abs\s*\(/, "a magnitude would discard the direction the variance carries");
});

// ============================ serial variance is refused, not guessed ============================

test("APPROVE of a SERIAL line with a serial discrepancy is REFUSED, not recorded as reconciled with no evidence", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "SERIAL", null, ["sn-1", "sn-2"]);
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, null, ["sn-1"]);
  await assert.rejects(
    () => cc.reconcileLine(pool, TENANT_A, "manager-1", line.id, "APPROVE", "one unit missing"),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "SERIAL_VARIANCE_NOT_RECONCILABLE",
  );
  const after = await cc.readLineForReview(pool, TENANT_A, line.id);
  assert.equal(after.status, "COUNTED", "the discrepancy stays visible instead of being silently disposed of");
  assert.equal(after.ledgerMovementId, null);
  const movements = await query("SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(movements.rows[0].n, 0, "nothing was inferred into the ledger");
});

test("a SERIAL line counted EXACTLY as expected reconciles, staging no ledger row", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "SERIAL", null, ["sn-1", "sn-2"]);
  // Order is not a difference: the same two units, seen in the other order.
  await cc.submitCount(pool, TENANT_A, "counter-1", line.id, null, ["sn-2", "sn-1"]);
  const reconciled = await cc.reconcileLine(pool, TENANT_A, "manager-1", line.id, "APPROVE", null);
  assert.equal(reconciled.status, "RECONCILED");
  assert.equal(reconciled.ledgerMovementId, null, "a count that found what it expected moves nothing");
});

// ============================ the sheet is the governed parent ============================

test("a sheet that is no longer OPEN admits no new line and no new count", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  const sheet = await cc.createSheet(pool, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(pool, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await query(
    "UPDATE eos_ops.cycle_count_sheets SET status = 'CLOSED', closed_by = 'u1', closed_at = now() WHERE id = $1",
    [sheet.id],
  );
  await assert.rejects(
    () => cc.openLine(pool, TENANT_A, "u1", sheet.id, "p2", "NONE", 5, []),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "SHEET_STATUS_INVALID",
  );
  await assert.rejects(
    () => cc.submitCount(pool, TENANT_A, "counter-1", line.id, 40, []),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "SHEET_STATUS_INVALID",
  );
});

test("a line cannot be opened against a sheet that does not exist -- the reason, not a constraint name", { skip: SKIP }, async () => {
  await reset();
  const pool = repoPool();
  await assert.rejects(
    () => cc.openLine(pool, TENANT_A, "u1", "ccs_does-not-exist", "p1", "NONE", 1, []),
    (err) => err instanceof cc.CycleCountRepositoryError && err.code === "SHEET_NOT_FOUND",
  );
});

test.after(async () => {
  if (pool) await pool.end();
});

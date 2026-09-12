// Migration 008's STRUCTURAL proofs, against a real PostgreSQL — the warehouse/bin location
// authority, its tenant-safe hierarchy, and the permanent code reservation.
//
// ════════════════════ WHY THIS SUITE DOES NOT RESET THE SCHEMA ════════════════════
//
// eosOpsPostgres.test.mjs, adminPolicyPostgres.test.mjs and the other resetters drop and rebuild
// `eos_policy` + `eos_ops` from clean, which is why they must all run inside ONE serialized npm
// command (adminPolicyPostgres.test.mjs proves that mechanically by looking for the reset itself).
//
// This suite migrates UP -- which is a no-op on an already-current database -- and then clears only
// the three tables migration 008 owns. So it neither races the resetters nor needs to be serialized
// with them, and it can be run on its own against any database that has the migrations applied.
//
// Same skip contract as the others: without POLICY_TEST_DATABASE_URL there is no database to prove
// anything against, so it SKIPS rather than fails.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import {
  LocationAuthorityError,
  createBin,
  createWarehouse,
  listBinsForWarehouse,
  readBin,
  renameBin,
  resolveBinCode,
  resolveOpsLocation,
  setBinStatus,
  setWarehouseStatus,
} from "../lib/eosOps/warehouseBinRepository.js";
import { OperatingCompanyAuthorityError } from "../lib/eosOps/operatingCompanyCustody.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
// OPAQUE, and deliberately not a real company name. Nothing in this schema may depend on which
// operating companies a deployment happens to have.
const COMPANY_A = "oc-alpha";
const COMPANY_B = "oc-beta";
const ACTOR = "u-1";

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

/** Migrate up (idempotent), seed the tenants, and clear only migration 008's own tables. */
async function fresh() {
  migrate(["up"]);
  for (const tenant of [TENANT_A, TENANT_B]) {
    await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [tenant]);
  }
  // Children before parents: the foreign keys are real.
  await query("DELETE FROM eos_ops.bin_code_claims");
  await query("DELETE FROM eos_ops.bins");
  await query("DELETE FROM eos_ops.warehouses");
}

const warehouse = (id, tenant = TENANT_A, company = COMPANY_A) => createWarehouse(repoPool(), tenant, ACTOR, {
  warehouseId: id, operatingCompanyKey: company, name: `Warehouse ${id}`,
  siteLabel: "Phoenix, AZ", status: "ACTIVE", provenance: "NATIVE",
});

const bin = (warehouseId, over = {}, tenant = TENANT_A) => createBin(repoPool(), tenant, ACTOR, {
  warehouseId, area: "MAIN", aisle: "A", bay: 1, position: 3, idempotencyKey: `nonce-${warehouseId}-1`, ...over,
});

test.after(async () => {
  if (pool) await pool.end();
});

// ============================ the schema ============================

/**
 * Reverse every migration that sorts STRICTLY NEWER than this lane's own, so that a single
 * `node-pg-migrate down` once again reverses THIS migration.
 *
 * A lane suite proving "my down refuses while my tables still hold data" runs one `down` step. That
 * reverses whichever migration is newest -- this lane's own only while this lane's own is last. It
 * was last on the branch and is not last on main: eleven migrations landed together at the W1
 * integration, and this test was reversing a stranger's migration and reporting
 * "Missing expected exception" while the refusal it checks worked perfectly.
 *
 * Driven by what is APPLIED (pgmigrations) rather than by a file count, so calling it twice in one
 * test is a no-op the second time instead of digging past the migration under test.
 */
async function peelMigrationsNewerThan(prefix) {
  for (;;) {
    const applied = await query("SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1");
    const newest = applied.rows[0]?.name;
    if (!newest || newest.startsWith(prefix) || newest < prefix) return;
    migrate(["down"]);
  }
}

test("migration 008 lands warehouses, bins and bin_code_claims beside the foundation tables", { skip: SKIP }, async () => {
  await fresh();
  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops' ORDER BY 1",
  );
  const names = tables.rows.map((r) => r.table_name);
  for (const expected of ["warehouses", "bins", "bin_code_claims"]) {
    assert.ok(names.includes(expected), `${expected} exists`);
  }
});

test("the operating company lives on the WAREHOUSE, mandatory and undefaulted -- and NOT on the bin", { skip: SKIP }, async () => {
  await fresh();
  const col = await query(
    `SELECT is_nullable, column_default, data_type FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'warehouses' AND column_name = 'operating_company_key'`,
  );
  assert.equal(col.rows.length, 1);
  assert.equal(col.rows[0].is_nullable, "NO", "a warehouse states its company or the INSERT fails");
  assert.equal(col.rows[0].column_default, null, "no default -- the column records a DECISION, not an absence");
  assert.equal(col.rows[0].data_type, "text", "opaque governed key, not an enum of this deployment's companies");

  // A bin's company is its warehouse's. A second copy is the only way the two could disagree.
  const onBin = await query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'bins' AND column_name = 'operating_company_key'`,
  );
  assert.deepEqual(onBin.rows, [], "a bin never carries a second copy of its warehouse's company");
});

test("NO location table stores a quantity -- balance stays a derived read over the ledger", { skip: SKIP }, async () => {
  await fresh();
  const balanceShaped = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops'
        AND table_name IN ('warehouses', 'bins', 'bin_code_claims')
        AND column_name IN ('quantity', 'quantity_on_hand', 'on_hand', 'available', 'reserved', 'balance')`,
  );
  assert.deepEqual(balanceShaped.rows, [], "migration 005's one-quantity-authority rule survives 008");
});

test("a warehouse INSERT with no operating company is refused BY THE DATABASE", { skip: SKIP }, async () => {
  await fresh();
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.warehouses (id, tenant_id, name, site_label, status, provenance, created_by, updated_by)
       VALUES ('wh-nc', $1, 'No Company', 'Phoenix, AZ', 'ACTIVE', 'NATIVE', 'u', 'u')`,
      [TENANT_A],
    ),
    /null value in column "operating_company_key"/,
  );
});

test("the repository refuses a missing company before the column ever sees it", { skip: SKIP }, async () => {
  await fresh();
  await assert.rejects(
    () => createWarehouse(repoPool(), TENANT_A, ACTOR, {
      warehouseId: "wh-x", operatingCompanyKey: "  ", name: "X", siteLabel: "Y", status: "ACTIVE", provenance: "NATIVE",
    }),
    OperatingCompanyAuthorityError,
  );
});

// ============================ the warehouse -> bin hierarchy ============================

test("a bin cannot hang off a warehouse that does not exist", { skip: SKIP }, async () => {
  await fresh();
  await assert.rejects(() => bin("wh-missing"), (e) => e instanceof LocationAuthorityError && e.code === "WAREHOUSE_UNKNOWN");
});

test("a bin cannot hang off ANOTHER TENANT's warehouse -- the parent key is composite", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main", TENANT_A, COMPANY_A);
  // Tenant B has no warehouse of this id, so the composite (tenant_id, warehouse_id) reference
  // cannot resolve. A single-column reference would happily have let this through and then reported
  // tenant B's stock under tenant A's operating company.
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.bins
         (id, tenant_id, warehouse_id, area, aisle, bay, "position", code, status, idempotency_key, created_by, updated_by)
       VALUES ($1, $2, 'wh-main', 'MAIN', 'A', 1, 3, 'A01-003', 'ACTIVE', 'k', 'u', 'u')`,
      [`bin_${"c".repeat(40)}`, TENANT_B],
    ),
    /violates foreign key constraint/,
  );
});

test("a bin id must be OPAQUE -- a code-shaped legacy id is refused by the database", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.bins
         (id, tenant_id, warehouse_id, area, aisle, bay, "position", code, status, idempotency_key, created_by, updated_by)
       VALUES ('bin_wh-main__A01-003', $1, 'wh-main', 'MAIN', 'A', 1, 3, 'A01-003', 'ACTIVE', 'k', 'u', 'u')`,
      [TENANT_A],
    ),
    /bins_id_is_opaque/,
  );
});

test("two bins cannot occupy the same rack position in the same warehouse", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await bin("wh-main");
  await assert.rejects(
    () => bin("wh-main", { idempotencyKey: "nonce-other" }),
    /bins_one_per_rack_position/,
  );
});

test("the same nonce cannot produce a second bin -- create replay is safe structurally", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const first = await bin("wh-main");
  // Same key, DIFFERENT position, so the rack-position uniqueness is not what catches this.
  //
  // What catches it is the identity itself: `deriveBinId` is a function of the nonce, so a replay
  // computes the SAME primary key rather than a second row that a uniqueness check then has to
  // notice. That is the stronger of the two guarantees and the reason the id is derived rather than
  // random. `bins_idempotency` remains as the tenant-scoped statement of the same fact -- it is
  // what a future caller-supplied id, if one were ever allowed, would run into.
  await assert.rejects(() => bin("wh-main", { position: 9 }), /bins_pkey|bins_idempotency/);
  const stored = await query("SELECT count(*)::int AS n FROM eos_ops.bins WHERE tenant_id = $1", [TENANT_A]);
  assert.equal(stored.rows[0].n, 1, "a replay never produces a second place");
});

test("the hierarchy is read through the foreign key, never by parsing a code", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await warehouse("wh-north");
  const a = await bin("wh-main");
  await bin("wh-north", { idempotencyKey: "nonce-north" });
  const children = await listBinsForWarehouse(repoPool(), TENANT_A, "wh-main");
  assert.deepEqual(children.map((b) => b.id), [a.id], "only wh-main's own bins; the north bin's identical code changes nothing");
});

// ============================ the code claim ============================

test("creating a bin reserves its code in the SAME transaction", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const created = await bin("wh-main");
  assert.match(created.id, /^bin_[0-9a-f]{40}$/);
  assert.equal(created.code, "A01-003", "the code is DERIVED from the racking attributes, not supplied");
  const claims = await query(
    "SELECT code, bin_id, claim_state FROM eos_ops.bin_code_claims WHERE tenant_id = $1", [TENANT_A],
  );
  assert.deepEqual(claims.rows, [{ code: "A01-003", bin_id: created.id, claim_state: "HELD" }]);
});

test("a second claim on the same code in the same warehouse has nowhere to go", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const created = await bin("wh-main");
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.bin_code_claims (tenant_id, warehouse_id, code, bin_id, claim_state, claimed_by)
       VALUES ($1, 'wh-main', 'A01-003', $2, 'HELD', 'u')`,
      [TENANT_A, created.id],
    ),
    /bin_code_claims_pkey/,
  );
});

test("the SAME code in a DIFFERENT warehouse is fine -- reservations are warehouse-scoped (O-7)", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await warehouse("wh-north");
  const a = await bin("wh-main");
  const b = await bin("wh-north", { idempotencyKey: "nonce-north" });
  assert.equal(a.code, b.code, "Seattle and Phoenix may both have an A01-003");
  assert.notEqual(a.id, b.id);
  const seenFromMain = await resolveBinCode(repoPool(), TENANT_A, "wh-main", "a01-003");
  assert.deepEqual(seenFromMain, { result: "FOUND", binId: a.id, code: "A01-003" });
});

test("a rename keeps the BIN ID and leaves the old code reserved to the same bin, forever", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const created = await bin("wh-main");

  const renamed = await renameBin(repoPool(), TENANT_A, ACTOR, created.id, { area: "MAIN", aisle: "A", bay: 1, position: 4 });
  assert.equal(renamed.id, created.id, "ruling O-3: correcting a mislabelled rack is not a new bin");
  assert.equal(renamed.code, "A01-004");

  // The OLD code still resolves -- to the SAME bin -- and reports the bin's CURRENT code, so an
  // operator can be told the label is out of date rather than that the shelf does not exist.
  const stale = await resolveBinCode(repoPool(), TENANT_A, "wh-main", "A01-003");
  assert.deepEqual(stale, { result: "FOUND_SUPERSEDED_CODE", binId: created.id, code: "A01-004", supersededCode: "A01-003" });

  const claims = await query(
    "SELECT code, claim_state FROM eos_ops.bin_code_claims WHERE tenant_id = $1 ORDER BY code", [TENANT_A],
  );
  assert.deepEqual(claims.rows, [
    { code: "A01-003", claim_state: "SUPERSEDED" },
    { code: "A01-004", claim_state: "HELD" },
  ], "nothing is released; a superseded claim is retained, still pointed at the same bin");
});

test("a bin holds exactly ONE current code", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const created = await bin("wh-main");
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.bin_code_claims (tenant_id, warehouse_id, code, bin_id, claim_state, claimed_by)
       VALUES ($1, 'wh-main', 'A01-009', $2, 'HELD', 'u')`,
      [TENANT_A, created.id],
    ),
    /bin_code_claims_one_held_per_bin/,
  );
});

test("a rename never moves a bin between warehouses", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await warehouse("wh-north");
  const created = await bin("wh-main");
  await assert.rejects(
    () => renameBin(repoPool(), TENANT_A, ACTOR, created.id, { area: "MAIN", aisle: "A", bay: 1, position: 4, warehouseId: "wh-north" }),
    (e) => e instanceof LocationAuthorityError && e.code === "WAREHOUSE_NOT_MOVABLE",
  );
  const after = await readBin(repoPool(), TENANT_A, created.id);
  assert.equal(after.warehouseId, "wh-main");
});

// ============================ R3: the typed pair ============================

test("a WAREHOUSE pair resolves to itself and carries the company it was stated with", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main", TENANT_A, COMPANY_A);
  const resolved = await resolveOpsLocation(repoPool(), TENANT_A, { type: "WAREHOUSE", locationId: "wh-main" });
  assert.deepEqual(resolved, {
    type: "WAREHOUSE", locationId: "wh-main", warehouseId: "wh-main",
    operatingCompanyKey: COMPANY_A, status: "ACTIVE",
  });
});

test("a BIN pair resolves to its parent warehouse, and to THAT warehouse's company", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main", TENANT_A, COMPANY_B);
  const created = await bin("wh-main");
  const resolved = await resolveOpsLocation(repoPool(), TENANT_A, { type: "BIN", locationId: created.id });
  assert.equal(resolved.warehouseId, "wh-main", "ADR-014 Model A: a bin rolls up to its warehouse");
  assert.equal(resolved.operatingCompanyKey, COMPANY_B, "read from the parent, never inferred and never stored twice");
});

test("the TYPE decides which namespace is consulted -- a bin id presented as a WAREHOUSE is not found", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const created = await bin("wh-main");
  await assert.rejects(
    () => resolveOpsLocation(repoPool(), TENANT_A, { type: "WAREHOUSE", locationId: created.id }),
    (e) => e instanceof LocationAuthorityError && e.code === "LOCATION_NOT_FOUND",
  );
  await assert.rejects(
    () => resolveOpsLocation(repoPool(), TENANT_A, { type: "BIN", locationId: "wh-main" }),
    (e) => e instanceof LocationAuthorityError && e.code === "LOCATION_NOT_FOUND",
  );
});

test("MOBILE is refused as NOT THIS LAYER'S AUTHORITY, not as 'no such place'", { skip: SKIP }, async () => {
  await fresh();
  await assert.rejects(
    () => resolveOpsLocation(repoPool(), TENANT_A, { type: "MOBILE", locationId: "truck-1" }),
    (e) => e instanceof LocationAuthorityError && e.code === "LOCATION_TYPE_NOT_IN_POSTGRES",
  );
});

test("a bare location id never resolves", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await assert.rejects(
    () => resolveOpsLocation(repoPool(), TENANT_A, { locationId: "wh-main" }),
    (e) => e instanceof LocationAuthorityError && e.code === "LOCATION_TYPE_INVALID",
  );
});

test("a tenant cannot resolve another tenant's location", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main", TENANT_A, COMPANY_A);
  await assert.rejects(
    () => resolveOpsLocation(repoPool(), TENANT_B, { type: "WAREHOUSE", locationId: "wh-main" }),
    (e) => e instanceof LocationAuthorityError && e.code === "LOCATION_NOT_FOUND",
  );
});

// ============================ retirement, not deletion ============================

test("retiring a warehouse or a bin keeps it resolvable -- history stays readable", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  const created = await bin("wh-main");
  await setBinStatus(repoPool(), TENANT_A, ACTOR, created.id, "INACTIVE");
  await setWarehouseStatus(repoPool(), TENANT_A, ACTOR, "wh-main", "INACTIVE");

  // Stock sitting in a retired bin is still physically in that warehouse. The resolver reports the
  // status and lets the caller's own eligibility rule decide; it never makes the place vanish.
  const resolved = await resolveOpsLocation(repoPool(), TENANT_A, { type: "BIN", locationId: created.id });
  assert.equal(resolved.status, "INACTIVE");
  assert.equal(resolved.warehouseId, "wh-main");
});

test("migration 008 REFUSES to reverse while it still holds location reference data", { skip: SKIP }, async () => {
  await fresh();
  await warehouse("wh-main");
  await peelMigrationsNewerThan("1758240000000_");
  assert.throws(() => migrate(["down"]), /still hold location reference data that has no other authority/);
  // The refusal is transactional: the tables are untouched.
  const rows = await query("SELECT count(*)::int AS n FROM eos_ops.warehouses");
  assert.equal(rows.rows[0].n, 1);
});

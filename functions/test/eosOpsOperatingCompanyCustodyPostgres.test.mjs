// EOS Operational Data Plane — migration 007's STRUCTURAL proofs: the operating-company inventory
// authority, and serialized custody of installed units.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Same contract as eosOpsPostgres.test.mjs and adminPolicyPostgres.test.mjs: set
// POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails. This file resets BOTH
// `eos_policy` and `eos_ops` from clean, so it is registered in the SAME serialized
// `test:adminPolicyPostgres` command as the other resetters -- adminPolicyPostgres.test.mjs's "every
// suite that resets the schema is covered by that one command" mechanically enforces that.
//
// The claims proved here are STRUCTURAL on purpose. "The writers will remember to pass an operating
// company" is not a property; "the database refuses a row without one" is.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tablesWithColumn } from "./support/migrationSchema.mjs";
import { join } from "node:path";
import pg from "pg";
import * as cc from "../lib/eosOps/cycleCountRepository.js";
import { OperatingCompanyAuthorityError } from "../lib/eosOps/operatingCompanyCustody.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT_A = "tenant-a";
// OPAQUE, and deliberately not a real company name. Nothing in this schema or these proofs may
// depend on which operating companies a deployment happens to have.
const COMPANY_A = "oc-alpha";

const MIGRATION_FILE = "1757980800000_operating-company-and-serialized-custody.sql";
// Every eos_ops table that must state WHOSE inventory authority its rows belong to. Migration 007
// created the first three (a location or a custody); migration 008 added `inventory_commitments` on
// the same terms -- a commitment is netted directly against `inventory_movements`, so a claim
// without a company could only be subtracted from every company's stock at once.
// EVERY table that carries `operating_company_key` -- DERIVED from the migration files, not listed.
//
// This was a literal naming migration 007's three tables. Seven later lanes added carriers
// (`mobile_locations`, `warehouses`, `suppliers`, `equipment`, the purchasing objects, ...) and none
// updated the literal, because these suites SKIP without a database and no lane ran them. At
// integration the sweep below would have failed on every one of those correct additions.
//
// Reading the set from `functions/migrations` states the rule the literal stood in for: whatever the
// migrations say carries this column is what the live database must show carrying it, and every one
// of those must carry it TEXT NOT NULL with no default. A new carrier is then included by existing;
// a carrier declared NULLABLE still fails, which is the check that mattered.
const COMPANY_TABLES = tablesWithColumn("eos_ops", "operating_company_key");

// Unwind far enough that MIGRATION_FILE (007) is the next one to re-apply, whatever later migrations
// exist. Counting the files instead of hard-coding "1" is what stops a later additive migration from
// silently turning these two proofs into proofs about a different migration.
const downThrough007 = () => migrate([
  "down",
  String(readdirSync("migrations").filter((f) => f.endsWith(".sql") && f >= MIGRATION_FILE).length),
]);

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

/**
 * The migration set, COUNTED rather than remembered -- see adminPolicyPostgres.test.mjs for why.
 * These proofs are about MIGRATION 007; anything layered on top of it must come off first, and
 * naming 007 keeps that true as later migrations are added.
 */
const MIGRATION_FILES = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
const STEPS_BACK_TO_007 =
  MIGRATION_FILES.length - MIGRATION_FILES.findIndex((f) => f === MIGRATION_FILE);

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

/**
 * Reverse every migration from the newest down to and including 007, so the next `up` is 007's own.
 * The step count is COUNTED rather than written as `["down", "1"]`: "the newest migration" is
 * whichever one was added last, and these two tests are about 007 specifically.
 */
function downToBefore007() {
  const total = readdirSync("migrations").filter((f) => f.endsWith(".sql")).length;
  migrate(["down", String(total - 6)]);
}

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS eos_policy CASCADE");
  await client.query("DROP SCHEMA IF EXISTS eos_ops CASCADE");
  await client.query("DROP SCHEMA IF EXISTS eos_commercial CASCADE");
  await client.query("DROP SCHEMA IF EXISTS eos_ops_conversion_probe CASCADE");
  // Migration 008 created a THIRD schema. A reset that re-migrates from clean has to drop every
  // schema the migrations create, not only the two that existed when it was written: a surviving
  // eos_crm plus a dropped `pgmigrations` makes the next `up` re-run 008 against tables that are
  // still there.
  await client.query("DROP SCHEMA IF EXISTS eos_crm CASCADE");
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  migrate(["up"]);
  const seed = new pg.Client({ connectionString: URL });
  await seed.connect();
  await seed.query(
    "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING",
    [TENANT_A],
  );
  await seed.end();
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

const insertCustody = (id, status, locationType, locationId, company = COMPANY_A) => query(
  `INSERT INTO eos_ops.serialized_custody
     (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
   VALUES ($1, $2, $3, 'p1', $1, $4, $5, $6, 'u')`,
  [id, TENANT_A, company, status, locationType, locationId],
);

// Migration 008 gave the EQUIPMENT custody label a referent: `serialized_custody.equipment_id` is
// generated from `location_id` and carries a tenant-scoped foreign key into `eos_ops.equipment`. A
// proof about the INSTALLED biconditional therefore has to install into an Equipment record that
// EXISTS -- which is the point of that key, not an obstacle to it.
const insertEquipment = (id) => query(
  `INSERT INTO eos_ops.equipment
     (id, tenant_id, operating_company_key, account_id, customer_location_id, name, status,
      created_by, updated_by)
   VALUES ($1, $2, $3, 'acct-1', 'cust-loc-1', 'Unit', 'ACTIVE', 'u', 'u')`,
  [id, TENANT_A, COMPANY_A],
);

const enumLabels = (typeName) => query(
  `SELECT e.enumlabel FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'eos_ops' AND t.typname = $1
    ORDER BY e.enumsortorder`,
  [typeName],
);

test.after(async () => {
  if (pool) await pool.end();
});

// ============================ the operating company column ============================

test("operating_company_key is NOT NULL on all three authority-bearing tables", { skip: SKIP }, async () => {
  await reset();
  // Scoped to MIGRATION 007's three tables. Later migrations add their own tables carrying the same
  // column, and an unscoped query would turn this claim about 007 into a running inventory of every
  // table that ever adopts the convention.
  const columns = await query(
    `SELECT table_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND column_name = 'operating_company_key'
        AND table_name = ANY($1)
      ORDER BY table_name`,
    [COMPANY_TABLES],
  );
  // EVERY declared carrier is actually present in the live schema -- a migration that says a table
  // carries the company key but whose SQL does not is caught here rather than at the first write.
  // `warehouses` is one of them and is a good illustration of why this is not just 007's three: the
  // company is a PRIMARY fact there (the Warehouse IS the company boundary root,
  // ownership/ownershipMatrix.ts), not a carried one, but the property pinned is identical.
  // The loop underneath is the check that matters: TEXT, NOT NULL, no default, on every carrier.
  assert.deepEqual(columns.rows.map((r) => r.table_name), [...COMPANY_TABLES].sort());
  for (const row of columns.rows) {
    assert.equal(row.data_type, "text", `${row.table_name}.operating_company_key is TEXT, not an enum`);
    assert.equal(row.is_nullable, "NO", `${row.table_name}.operating_company_key is mandatory`);
  }
  assert.equal(carrying.includes("cycle_count_lines"), false, "a line inherits its sheet's authority");
});

test("there is NO SQL DEFAULT for the operating company -- a writer must decide", { skip: SKIP }, async () => {
  // The point of the column is that it records a DECISION. A default would let a writer that never
  // made one still emit a row claiming an inventory authority, indistinguishable afterwards from a
  // deliberate assignment.
  await reset();
  const defaults = await query(
    `SELECT table_name, column_default FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND column_name = 'operating_company_key' AND column_default IS NOT NULL`,
  );
  assert.deepEqual(defaults.rows, [], "no table defaults the operating company");

  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.serialized_custody
         (id, tenant_id, part_id, serial_number, status, location_type, location_id, updated_by)
       VALUES ('sc-nocompany', $1, 'p1', 'SN-1', 'AVAILABLE', 'WAREHOUSE', 'wh1', 'u')`,
      [TENANT_A],
    ),
    /operating_company_key/,
    "omitting the company is a NOT NULL violation, not a silently defaulted row",
  );
});

test("cycle_count_lines does NOT carry the company -- the SHEET is the governed parent", { skip: SKIP }, async () => {
  // Structural evidence for the decision, asserted rather than asserted-in-prose: the line has a
  // mandatory FK to the sheet and no location of its own, so the sheet answers both "where" and
  // "whose inventory" for every line under it. A second copy on the line could only ever disagree.
  await reset();
  const onLine = await query(
    `SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'cycle_count_lines'
        AND column_name IN ('operating_company_key', 'location_type', 'location_id')`,
  );
  assert.equal(onLine.rows[0].n, 0, "a line states neither a location nor a company of its own");

  const sheetFk = await query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'cycle_count_lines' AND column_name = 'sheet_id'`,
  );
  assert.equal(sheetFk.rows[0].is_nullable, "NO", "every line has a sheet");
});

test("a reconciled line inherits its ledger row's company from the sheet, not from anywhere else", { skip: SKIP }, async () => {
  await reset();
  const p = repoPool();
  const sheet = await cc.createSheet(p, TENANT_A, "u1", COMPANY_A, { type: "WAREHOUSE", id: "wh1" });
  const line = await cc.openLine(p, TENANT_A, "u1", sheet.id, "p1", "NONE", 42, []);
  await cc.submitCount(p, TENANT_A, "counter-1", line.id, 40, []);
  const reconciled = await cc.reconcileLine(p, TENANT_A, "manager-1", line.id, "APPROVE", "shrinkage");

  const movement = await query(
    "SELECT operating_company_key FROM eos_ops.inventory_movements WHERE id = $1",
    [reconciled.ledgerMovementId],
  );
  assert.equal(movement.rows[0].operating_company_key, COMPANY_A);
  assert.equal(sheet.operatingCompanyKey, COMPANY_A, "the sheet record itself carries it");
});

test("the repository refuses a missing company key before it ever reaches SQL", { skip: SKIP }, async () => {
  await reset();
  const p = repoPool();
  for (const bad of [undefined, null, "", "   "]) {
    await assert.rejects(
      () => cc.createSheet(p, TENANT_A, "u1", bad, { type: "WAREHOUSE", id: "wh1" }),
      OperatingCompanyAuthorityError,
      `createSheet refuses ${JSON.stringify(bad)} rather than substituting a company`,
    );
  }
  const sheets = await query("SELECT count(*)::int n FROM eos_ops.cycle_count_sheets");
  assert.equal(sheets.rows[0].n, 0, "the refused calls wrote nothing");
});

// ============================ the migration refuses, never manufactures ============================

test("migration 007 ABORTS on a pre-existing row rather than inventing its operating company", { skip: SKIP }, async () => {
  await reset();
  // Reverse 007 so the tables are back to their migration-005 shape, then occupy one of them the way
  // an unexpected pre-cutover writer would have.
  downThrough007();
  await query(
    `INSERT INTO eos_ops.serialized_custody
       (id, tenant_id, part_id, serial_number, status, location_type, location_id, updated_by)
     VALUES ('sc-pre', $1, 'p1', 'SN-PRE', 'AVAILABLE', 'WAREHOUSE', 'wh1', 'u')`,
    [TENANT_A],
  );

  let failure = null;
  try { migrate(["up"]); } catch (err) { failure = err; }
  assert.ok(failure, "the migration did not silently succeed over occupied tables");
  const text = `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  assert.match(text, /refuses to add operating_company_key/, "it says why, naming the column");
  assert.match(text, /serialized_custody \(1 rows\)/, "and names the occupied table and its row count");

  // AND IT CHANGED NOTHING. A half-applied migration that left the column behind would be worse than
  // a clean refusal.
  // Scoped to 007's own three tables: later migrations create their own tables carrying the same
  // column, and counting every one of them would make this a claim about the repository's growth
  // rather than about what the aborted run did.
  const columnAdded = await query(
    `SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND column_name = 'operating_company_key'
        AND table_name = ANY($1)`,
    [[...COMPANY_TABLES]],
  );
  assert.equal(columnAdded.rows[0].n, 0, "no column was added by the aborted run");
  const recorded = await query("SELECT count(*)::int n FROM pgmigrations WHERE name = $1", [MIGRATION_FILE.replace(/\.sql$/, "")]);
  assert.equal(recorded.rows[0].n, 0, "and the migration was not recorded as applied");

  const survivor = await query("SELECT location_type FROM eos_ops.serialized_custody WHERE id = 'sc-pre'");
  assert.equal(survivor.rows[0].location_type, "WAREHOUSE", "the pre-existing row is untouched, not rewritten");

  // Clearing the unknown-authority rows is what unblocks it -- not a backfill.
  await query("DELETE FROM eos_ops.serialized_custody");
  migrate(["up"]);
  // Scoped to 007's OWN three tables. Later migrations carry the same mandatory authority onto
  // their own records (008's `equipment` does), and a bare count would turn this claim about 007
  // into a claim about how many tables in eos_ops happen to record an operating company.
  const nowThere = await query(
    `SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND column_name = 'operating_company_key'
        AND table_name = ANY($1)`,
    [COMPANY_TABLES],
  );
  // Every company-bearing table, counted from the list rather than from a literal, so a later
  // additive migration that adds one (008 added `inventory_commitments`) is included rather than
  // silently turning this into a proof about a stale number.
  assert.equal(nowThere.rows[0].n, COMPANY_TABLES.length, "and then it applies to every company-bearing table");
});

test("every one of the three tables is checked, not just the first", { skip: SKIP }, async () => {
  await reset();
  downThrough007();
  await query(
    `INSERT INTO eos_ops.cycle_count_sheets
       (id, tenant_id, location_type, location_id, status, created_by, updated_by)
     VALUES ('ccs-pre', $1, 'WAREHOUSE', 'wh1', 'OPEN', 'u', 'u')`,
    [TENANT_A],
  );
  let failure = null;
  try { migrate(["up"]); } catch (err) { failure = err; }
  assert.ok(failure);
  assert.match(`${failure.stdout ?? ""}${failure.stderr ?? ""}`, /cycle_count_sheets \(1 rows\)/);

  await query("DELETE FROM eos_ops.cycle_count_sheets");
  migrate(["up"]);
});

// ============================ the two location vocabularies ============================

test("ops_location_type does NOT contain EQUIPMENT -- physical movement is not customer custody", { skip: SKIP }, async () => {
  await reset();
  const labels = (await enumLabels("ops_location_type")).rows.map((r) => r.enumlabel);
  assert.deepEqual(labels, ["WAREHOUSE", "BIN", "MOBILE"], "the physical vocabulary is unchanged by 007");
  assert.equal(labels.includes("EQUIPMENT"), false);

  // And the ledger still uses it -- a movement cannot name an Equipment as a location at all.
  const movementType = await query(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'inventory_movements' AND column_name = 'location_type'`,
  );
  assert.equal(movementType.rows[0].udt_name, "ops_location_type");
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.inventory_movements
         (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
          movement_type, quantity_delta, source_kind, source_id, created_by)
       VALUES ('m-eq', $1, $2, 'p1', 'NONE', 'EQUIPMENT', 'eq1', 'RECEIVED', 1, 'TEST', 's1', 'u')`,
      [TENANT_A, COMPANY_A],
    ),
    /invalid input value for enum (?:eos_ops\.)?ops_location_type/,
  );
});

test("ops_custody_location_type DOES contain EQUIPMENT, and serialized custody uses it", { skip: SKIP }, async () => {
  await reset();
  const labels = (await enumLabels("ops_custody_location_type")).rows.map((r) => r.enumlabel);
  assert.deepEqual(labels, ["WAREHOUSE", "BIN", "MOBILE", "EQUIPMENT"]);

  const custodyType = await query(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'serialized_custody' AND column_name = 'location_type'`,
  );
  assert.equal(custodyType.rows[0].udt_name, "ops_custody_location_type");

  // CUSTOMER was not invented as a fourth place. The custody row names the Equipment record, which
  // already carries the account.
  assert.equal(labels.includes("CUSTOMER"), false);
});

test("WAREHOUSE / BIN / MOBILE convert deterministically, with no data loss", { skip: SKIP }, async () => {
  await reset();
  // TWO independent halves of the same claim.
  //
  // 1. TOTALITY. Every label of the physical enum is a label of the custody enum, which is what makes
  //    the migration's `::text::` cast total -- there is no physical value with nowhere to land.
  const physical = (await enumLabels("ops_location_type")).rows.map((r) => r.enumlabel);
  const custody = new Set((await enumLabels("ops_custody_location_type")).rows.map((r) => r.enumlabel));
  for (const label of physical) assert.ok(custody.has(label), `${label} survives the conversion by name`);

  // 2. THE ACTUAL CAST, re-executed verbatim. The migration's own USING expression is read out of the
  //    migration file (so it cannot drift from this proof) and applied to a probe table built on the
  //    pre-007 column type. The real table cannot be used for this: it is empty by the migration's
  //    own pre-flight rule, so there is nothing in it to convert.
  const sql = readFileSync(join("migrations", MIGRATION_FILE), "utf8");
  const using = /ALTER COLUMN location_type TYPE ops_custody_location_type\s*\n\s*(USING [^;]+);/.exec(sql);
  assert.ok(using, "the migration converts by an explicit USING expression");

  await query("CREATE SCHEMA eos_ops_conversion_probe");
  await query(
    "CREATE TABLE eos_ops_conversion_probe.probe (id TEXT PRIMARY KEY, location_type eos_ops.ops_location_type NOT NULL)",
  );
  for (const label of physical) {
    await query("INSERT INTO eos_ops_conversion_probe.probe VALUES ($1, $2)", [label, label]);
  }
  await query(
    `SET search_path = eos_ops, public;
     ALTER TABLE eos_ops_conversion_probe.probe
       ALTER COLUMN location_type TYPE ops_custody_location_type
       ${using[1]};`,
  );

  const after = await query("SELECT id, location_type::text AS lt FROM eos_ops_conversion_probe.probe ORDER BY id");
  assert.deepEqual(
    after.rows.map((r) => [r.id, r.lt]),
    [...physical].sort().map((l) => [l, l]),
    "every row kept its own label -- no remap, no collapse, no null",
  );
  const probeType = await query(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops_conversion_probe' AND table_name = 'probe' AND column_name = 'location_type'`,
  );
  assert.equal(probeType.rows[0].udt_name, "ops_custody_location_type");
  await query("DROP SCHEMA eos_ops_conversion_probe CASCADE");
});

test("the three physical custody values still round-trip on the real table", { skip: SKIP }, async () => {
  await reset();
  await insertCustody("sc-wh", "AVAILABLE", "WAREHOUSE", "wh1");
  await insertCustody("sc-bin", "RESERVED", "BIN", "bin-a01");
  await insertCustody("sc-mob", "AVAILABLE", "MOBILE", "truck-7");
  const rows = await query("SELECT id, location_type::text AS lt FROM eos_ops.serialized_custody ORDER BY id");
  assert.deepEqual(rows.rows.map((r) => [r.id, r.lt]), [
    ["sc-bin", "BIN"], ["sc-mob", "MOBILE"], ["sc-wh", "WAREHOUSE"],
  ]);
});

// ============================ the INSTALLED rule ============================

test("INSTALLED custody at an EQUIPMENT id is accepted, and location_id IS the Equipment id", { skip: SKIP }, async () => {
  await reset();
  await insertEquipment("eq_abc123");
  await insertCustody("sc-installed", "INSTALLED", "EQUIPMENT", "eq_abc123");
  const row = await query(
    "SELECT status::text AS s, location_type::text AS lt, location_id FROM eos_ops.serialized_custody WHERE id = 'sc-installed'",
  );
  assert.deepEqual(row.rows[0], { s: "INSTALLED", lt: "EQUIPMENT", location_id: "eq_abc123" });
});

test("INSTALLED in WAREHOUSE / BIN / MOBILE custody is REFUSED BY THE DATABASE", { skip: SKIP }, async () => {
  // An installed unit has left company inventory. Representing it as still sitting on a shelf, in a
  // bin, or on a truck is the exact double-custody this constraint exists to make unrepresentable.
  await reset();
  for (const locationType of ["WAREHOUSE", "BIN", "MOBILE"]) {
    await assert.rejects(
      () => insertCustody(`sc-bad-${locationType}`, "INSTALLED", locationType, "loc-1"),
      /serialized_custody_installed_is_equipment/,
      `INSTALLED + ${locationType} is refused`,
    );
  }
});

test("EQUIPMENT custody on a NON-INSTALLED status is REFUSED too -- the rule is a biconditional", { skip: SKIP }, async () => {
  // BOTH DIRECTIONS, and the evidence is the product's own existing contract rather than a guess:
  // functions/src/serializedAsset/types.ts's validateSerializedAssetValue rejects
  // `installed_requires_link` AND `link_requires_installed`, so a unit linked to an Equipment record
  // is INSTALLED by definition. A custody row claiming a unit is AVAILABLE or RESERVED *at customer
  // Equipment* would be offering company stock that is already somebody's machine.
  await reset();
  for (const status of ["AVAILABLE", "RESERVED", "CONSUMED", "SCRAPPED"]) {
    await assert.rejects(
      () => insertCustody(`sc-bad-${status}`, status, "EQUIPMENT", "eq_abc123"),
      /serialized_custody_installed_is_equipment/,
      `${status} + EQUIPMENT is refused`,
    );
  }
});

test("an INSTALLED unit cannot be UPDATED back into physical custody without also leaving INSTALLED", { skip: SKIP }, async () => {
  // The constraint is a table CHECK, so it holds on every write, not only on insert.
  await reset();
  await insertEquipment("eq_abc123");
  await insertCustody("sc-u", "INSTALLED", "EQUIPMENT", "eq_abc123");
  await assert.rejects(
    () => query("UPDATE eos_ops.serialized_custody SET location_type = 'WAREHOUSE' WHERE id = 'sc-u'"),
    /serialized_custody_installed_is_equipment/,
  );
  await assert.rejects(
    () => query("UPDATE eos_ops.serialized_custody SET status = 'SCRAPPED' WHERE id = 'sc-u'"),
    /serialized_custody_installed_is_equipment/,
  );
});

// ============================ no company-specific vocabulary, anywhere ============================

test("NO migration creates a company-specific SQL enum or a second company master table", { skip: SKIP }, async () => {
  await reset();
  // Read from the live database, not from the source text: this is what actually got created.
  const enums = await query(
    `SELECT n.nspname, t.typname, e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('eos_ops', 'eos_policy')`,
  );
  const offenders = enums.rows.filter((r) => /taylor|ventana/i.test(`${r.typname} ${r.enumlabel}`));
  assert.deepEqual(offenders, [], "no enum type or label names a specific operating company");

  const companyTables = await query(
    `SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema IN ('eos_ops', 'eos_policy')
        AND table_name IN ('operating_companies', 'companies', 'company', 'operating_company')`,
  );
  assert.deepEqual(companyTables.rows, [], "the governed key is opaque -- no second company master table");
});

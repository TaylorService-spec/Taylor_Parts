// REORDER OBJECT SCHEMA PARITY, against a real postgres:16.
//
// The parity matrix says where every legacy field's meaning goes. This suite proves the database
// actually provides those places -- so the matrix cannot claim a home that does not exist, and a
// column cannot quietly disappear from under a disposition.
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
const matrix = require("../lib/eosOps/migration/reorderFieldParityMatrix.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

/** The column each matrix entry names, extracted from its target authority rather than restated. */
const reorderColumn = (entry) => {
  const m = /eos_ops\.reorder_requests\.([a-z_]+)/.exec(entry.targetAuthority);
  return m ? m[1] : null;
};

test("the Reorder object schema provides every place the parity matrix sends a fact", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `rr_parity_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });

  await withClient(dbUrlFor(name), async (c) => {
    const { rows } = await c.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='eos_ops' AND table_name='reorder_requests'`);
    const columns = new Map(rows.map((r) => [r.column_name, r]));

    await t.test("every copied field has a column, and it is the one the matrix names", () => {
      for (const entry of matrix.REORDER_FIELD_PARITY_MATRIX.filter((e) => e.copied)) {
        const column = reorderColumn(entry);
        assert.ok(column, `${entry.legacyField} is copied but its target authority names no reorder_requests column`);
        assert.ok(columns.has(column),
          `${entry.legacyField} is copied into eos_ops.reorder_requests.${column}, which does not exist`);
      }
    });

    await t.test("every schema parity correction the matrix declares was actually made", () => {
      const corrections = matrix.schemaParityCorrections();
      assert.ok(corrections.length > 0);
      for (const field of corrections) {
        const entry = matrix.REORDER_FIELD_PARITY_MATRIX.find((e) => e.legacyField === field);
        assert.ok(columns.has(reorderColumn(entry)),
          `${field} was declared a schema parity correction but no column was added for it`);
      }
    });

    await t.test("nothing not copied got a Reorder column anyway", () => {
      // A relocated fact must not ALSO sit on the Reorder row: two homes for one fact is how they
      // start disagreeing. The assignment triple is the case that matters most.
      for (const field of ["assigned_employee_id", "assigned_to_user_id", "assigned_by", "assigned_at",
        "purchase_order_id", "current_owner", "voided_by", "voided_at", "void_reason",
        "ordered_by", "ordered_at"]) {
        assert.ok(!columns.has(field),
          `eos_ops.reorder_requests.${field} exists, duplicating a fact another authority owns`);
      }
    });

    await t.test("the lifecycle columns carry the types their client inputs actually produce", () => {
      // A checkbox is a boolean and an <input type="date"> is a calendar day. Storing either as
      // free text is how "false", "no" and "" come to mean three different things.
      assert.equal(columns.get("vendor_contacted").data_type, "boolean");
      assert.equal(columns.get("expected_availability_date").data_type, "date");
      for (const ts of ["reviewed_at", "purchasing_started_at", "last_purchasing_update_at",
        "cancelled_at", "received_at"]) {
        assert.equal(columns.get(ts).data_type, "timestamp with time zone", `${ts} must be an instant`);
      }
    });

    await t.test("requested_by can say 'unknown' for a migrated row, and cannot for a native one", async () => {
      assert.equal(columns.get("requested_by").is_nullable, "YES",
        "a NOT NULL requester would force the migration to fabricate a Principal");
      assert.equal(columns.get("provenance").is_nullable, "NO");

      // The constraint, not merely the nullability, is what preserves the native guarantee.
      const { rows: checks } = await c.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'reorder_native_requester_present'`);
      assert.equal(checks.length, 1, "the native requester guarantee is not enforced");
    });

    await t.test("provenance must be stated on every insert, never inherited", async () => {
      const { rows } = await c.query(
        `SELECT column_default FROM information_schema.columns
          WHERE table_schema='eos_ops' AND table_name='reorder_requests' AND column_name='provenance'`);
      assert.equal(rows[0].column_default, null,
        "a provenance default would let a migrated row pass itself off as natively raised");
    });

    await t.test("the operating company is governed, not merely non-blank (RULING 3)", async () => {
      const { rows } = await c.query(
        `SELECT conname, confrelid::regclass::text AS refs FROM pg_constraint
          WHERE conrelid = 'eos_ops.reorder_requests'::regclass AND contype = 'f'`);
      const byName = new Map(rows.map((r) => [r.conname, r.refs]));
      assert.ok(byName.has("reorder_operating_company_governed"),
        "a valid-looking slug still reaches the governed column unchallenged");
      assert.match(byName.get("reorder_operating_company_governed"), /tenant_operating_companies/);

      // Every actor column is a member of THIS tenant: composite keys throughout.
      for (const fk of ["reorder_requested_by_member_fk", "reorder_reviewed_by_member_fk",
        "reorder_purchasing_started_by_member_fk", "reorder_last_purchasing_update_by_member_fk",
        "reorder_cancelled_by_member_fk", "reorder_received_by_member_fk"]) {
        assert.ok(byName.has(fk), `${fk} is missing, so an actor column is unconstrained`);
        assert.match(byName.get(fk), /tenant_memberships/);
      }
    });

    await t.test("the warehouse/company agreement is NOT a foreign key", async () => {
      // Deliberate: a composite FK into warehouses would re-derive the pair forever, so a warehouse
      // later changing company would break or silently restate every historical Reorder raised
      // against it. The company stored at creation is a fact about that moment.
      const { rows } = await c.query(
        `SELECT confrelid::regclass::text AS refs FROM pg_constraint
          WHERE conrelid = 'eos_ops.reorder_requests'::regclass AND contype = 'f'`);
      assert.ok(!rows.some((r) => /\bwarehouses\b/.test(r.refs)),
        "a warehouse foreign key would re-derive the operating company and rewrite history");
    });
  });
});

// THE GOVERNED WORK ORDER AUTHORITY, against a real postgres:16.
//
// The parity matrix says where every legacy field's meaning goes. This proves the database actually
// provides those places, and that the identity separations are enforced structurally rather than
// by convention.
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
const matrix = require("../lib/eosOps/migration/workOrderFieldParityMatrix.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
/** The column a matrix entry names on work_orders, extracted rather than restated. */
const workOrderColumn = (entry) => {
  const m = /eos_ops\.work_orders\.([a-z_]+)/.exec(entry.targetAuthority);
  return m ? m[1] : null;
};

test("the governed Work Order authority provides what the parity matrix sends it", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wo_auth_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });

  await withClient(dbUrlFor(name), async (c) => {
    const cols = async (table) => new Map((await c.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='eos_ops' AND table_name=$1`, [table])).rows.map((r) => [r.column_name, r]));
    const workOrders = await cols("work_orders");
    const assignments = await cols("work_order_assignments");

    await t.test("every copied field has the column the matrix names", () => {
      for (const entry of matrix.WORK_ORDER_FIELD_PARITY_MATRIX.filter((e) => e.copied)) {
        const column = workOrderColumn(entry);
        assert.ok(column, `${entry.legacyField} is copied but names no work_orders column`);
        assert.ok(workOrders.has(column),
          `${entry.legacyField} is copied into eos_ops.work_orders.${column}, which does not exist`);
      }
    });

    await t.test("NEITHER technician field became a Work Order column", () => {
      // The whole point of the interval model: one current assignee, phase carried by status.
      for (const absent of ["assigned_tech_id", "scheduled_tech_id", "assignee_employee_id",
        "reassigned_from_tech_id", "rescheduled_from_tech_id", "reassigned_by_uid", "rescheduled_by_uid",
        "labor_hours", "last_updated", "execution_log", "inventory_snapshot"]) {
        assert.ok(!workOrders.has(absent),
          `eos_ops.work_orders.${absent} exists, duplicating a fact another authority owns`);
      }
    });

    await t.test("the assignee is an EMPLOYEE and the actor is a PRINCIPAL, structurally", async () => {
      assert.ok(assignments.has("assignee_employee_id"));
      assert.ok(assignments.has("assigned_by_principal_id"));
      const { rows } = await c.query(
        `SELECT conname, confrelid::regclass::text AS refs FROM pg_constraint
          WHERE conrelid = 'eos_ops.work_order_assignments'::regclass AND contype = 'f'`);
      const byName = new Map(rows.map((r) => [r.conname, r.refs]));
      assert.match(byName.get("wo_assignment_employee_fk"), /employees/,
        "the assignee must be a governed Employee, never a technician id or a uid");
      assert.match(byName.get("wo_assignment_assigned_by_fk"), /tenant_memberships/,
        "the actor must be a Principal who is a member of this tenant");
      assert.match(byName.get("wo_assignment_work_order_fk"), /work_orders/);
    });

    await t.test("no column anywhere in the Work Order authority can hold a uid or a technician id", async () => {
      const { rows } = await c.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema='eos_ops' AND table_name LIKE 'work_order%'
            AND (column_name LIKE '%uid%' OR column_name LIKE '%tech_id%'
                 OR column_name LIKE '%external_subject%')`);
      assert.deepEqual(rows, [], "a legacy identity has a column to land in");
    });

    await t.test("ONE current assignee per Work Order, and history is unconstrained", async () => {
      const { rows } = await c.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname='eos_ops' AND indexname='work_order_assignments_one_current'`);
      assert.equal(rows.length, 1, "nothing stops two open assignments on one Work Order");
      assert.match(rows[0].indexdef, /WHERE \(effective_to IS NULL\)/,
        "the uniqueness must apply to the CURRENT row only, or history becomes impossible");
    });

    await t.test("assignment history is ended, never deleted or re-pointed", async () => {
      const triggers = (await c.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'eos_ops.work_order_assignments'::regclass
           AND NOT tgisinternal`)).rows.map((r) => r.tgname).sort();
      assert.deepEqual(triggers, ["work_order_assignment_close_only", "work_order_assignment_no_delete"]);
    });

    await t.test("a terminal Work Order states when it reached that state", async () => {
      for (const name of ["work_orders_completed_states_when", "work_orders_closed_states_when",
        "work_orders_schedule_is_whole", "work_orders_schedule_ordered"]) {
        const { rows } = await c.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
        assert.equal(rows.length, 1, `${name} is missing`);
      }
    });

    await t.test("provenance is stated, and only a MIGRATED row may have an unknown actor", async () => {
      assert.equal(workOrders.get("provenance").is_nullable, "NO");
      assert.equal(workOrders.get("created_by_principal_id").is_nullable, "YES",
        "a NOT NULL actor would force the migration to fabricate a Principal");
      const { rows } = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_native_actor_present'`);
      assert.equal(rows.length, 1, "the native guarantee is not enforced");
    });

    await t.test("the transition log is append-only", async () => {
      const triggers = (await c.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'eos_ops.work_order_transitions'::regclass
           AND NOT tgisinternal`)).rows.map((r) => r.tgname);
      assert.deepEqual(triggers, ["work_order_transition_append_only"]);
    });
  });
});

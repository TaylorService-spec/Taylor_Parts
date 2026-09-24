// OPERATIONAL SCOPE authority, step B: the governed PostgreSQL schema against a real postgres:16.
//
// Step B adds the authority's SCHEMA and its platform vocabulary; the governed commands arrive in step C. So this suite
// proves what the SCHEMA itself guarantees, which is what later steps are allowed to rely on:
//
//   scope cannot grant access            no capability/permission/role column, and the capability is granted to NO Role
//   scope cannot express qualification   no qualification column: it is a SEPARATE authority (step A)
//   scope is not operating company       no operating-company column (that authority already exists elsewhere)
//   the warehouse resolves exactly       a composite FK to eos_ops.warehouses, same tenant, no fabricated scope
//   one scope type, deliberately         anything but WAREHOUSE is refused by the database
//   multiple concurrent warehouses       one Employee may currently cover several warehouses
//   one current row per target           a duplicate CURRENT row is refused; re-scoping after ending is fine
//   history is kept                      DELETE refused, ended rows immutable, only "end a current row" permitted
//
// The suite migrates its OWN disposable database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vocab = require("../lib/eosWorkforce/operationalScopeVocabulary.js");
const eligibility = require("../lib/eosWorkforce/workEligibilityVocabulary.js");

const MIGRATION_FILE = "1760097600000_employee-operational-scope-authority.sql";
/**
 * How many migrations must be reversed to reach THIS one. Computed, never hardcoded: a later migration must not
 * silently turn this suite's "the reversal refuses" proof into a reversal of someone else's migration.
 */
const DOWN_STEPS_TO_REACH_THIS_MIGRATION = (() => {
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const index = files.indexOf(MIGRATION_FILE);
  if (index < 0) throw new Error(`${MIGRATION_FILE} is missing: this suite proves that migration's guarantees`);
  return files.length - index;
})();

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
const refusal = async (fn) => { try { await fn(); return null; } catch (err) { return err.message; } };

test("Employee Operational Scope authority: one scope type, real warehouse, no access, kept history", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_op_scope_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (direction, steps) => execFileSync(
    process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", direction, ...(steps ? [String(steps)] : []),
      "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" },
  );
  migrate("up");
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (text, values = []) => pool.query(text, values);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  const employee = (id, tenant) => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant],
  );
  const warehouse = (id, tenant, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, 'taylor', $1, 'Somewhere, AZ', $3, 'NATIVE', 'fixture', 'fixture')`, [id, tenant, status],
  );
  await employee("e-1", "t1");
  await employee("e-2", "t1");
  await employee("e-t2", "t2");
  await warehouse("wh-main", "t1");
  await warehouse("wh-north", "t1");
  await warehouse("wh-retired", "t1", "INACTIVE");
  await warehouse("wh-t2", "t2");

  const FROM = "2026-09-17T00:00:00Z";
  let n = 0;
  const scope = (employeeId, scopeId, tenant = "t1", type = "WAREHOUSE", from = FROM) => q(
    `INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'prn_fixture')`, [`eos-${++n}`, tenant, employeeId, type, scopeId, from],
  );
  const current = async (employeeId) => (await q(
    `SELECT scope_id FROM eos_workforce.employee_operational_scopes
      WHERE employee_id = $1 AND effective_to IS NULL ORDER BY scope_id`, [employeeId],
  )).rows.map((r) => r.scope_id);

  await t.test("an Employee may currently cover MULTIPLE warehouses", async () => {
    // WAREHOUSE alone -> WAREHOUSE + REORDER_QUEUE (migration 1761696000000, Owner ruling). This
    // suite is about the WAREHOUSE scope and stays that way; the queue scope has its own proofs.
    assert.deepEqual([...vocab.OPERATIONAL_SCOPE_TYPES], ["WAREHOUSE", "REORDER_QUEUE"]);
    await scope("e-1", "wh-main");
    await scope("e-1", "wh-north");
    assert.deepEqual(await current("e-1"), ["wh-main", "wh-north"]);
    assert.deepEqual(await current("e-2"), [], "and an Employee may hold none");
  });

  await t.test("an unruled scope type is still refused by the database", async () => {
    // REORDER_QUEUE joined the vocabulary; nothing else did, and the CHECK still owns the question.
    for (const type of ["OPERATING_COMPANY", "REGION", "BRANCH", "warehouse", "WAREHOUSE ", "", "ALL", "QUEUE"]) {
      assert.match(await refusal(() => scope("e-2", "wh-main", "t1", type)) ?? "", /operational_scope_type_known/,
        `scope_type ${JSON.stringify(type)} must be refused`);
    }
    // Operating Company in particular is NOT duplicated here: it has its own governed Employee authority.
    assert.deepEqual(await current("e-2"), []);
  });

  await t.test("the warehouse must resolve exactly, in the SAME tenant: no fabricated scope", async () => {
    // The unconditional warehouse FOREIGN KEY became a per-type trigger in migration 1761696000000,
    // because a second scope type cannot point at eos_ops.warehouses. The GUARANTEE is identical --
    // same three cases, same refusals -- only the mechanism that enforces it changed.
    assert.match(await refusal(() => scope("e-1", "no-such-warehouse")) ?? "", /operational_scope_target_exists/);
    // t1's Employee cannot be scoped to t2's warehouse, nor the reverse.
    assert.match(await refusal(() => scope("e-1", "wh-t2", "t1")) ?? "", /operational_scope_target_exists/);
    assert.match(await refusal(() => scope("e-t2", "wh-main", "t2")) ?? "", /operational_scope_target_exists/);
    // A foreign-tenant EMPLOYEE is refused by the composite employee FK.
    assert.match(await refusal(() => scope("e-t2", "wh-main", "t1")) ?? "", /operational_scope_employee_fk/);
    assert.match(await refusal(() => scope("no-such-employee", "wh-main")) ?? "", /operational_scope_employee_fk/);
  });

  await t.test("scope cannot grant access, express a qualification, or name an operating company", async () => {
    const columns = (await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_workforce' AND table_name = 'employee_operational_scopes' ORDER BY column_name`,
    )).rows.map((r) => r.column_name);
    assert.deepEqual(columns, ["assigned_by", "effective_from", "effective_to", "employee_id", "ended_at", "ended_by",
      "id", "reason", "scope_id", "scope_type", "tenant_id"]);
    for (const column of columns) {
      assert.doesNotMatch(column, /capab|permission|_role|role_|grant|access|qualif|eligib|operating|company|job/);
    }
    // The capability VOCABULARY is defined...
    const cap = (await q(`SELECT key FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeOperationalScope_write'`)).rows;
    assert.deepEqual(cap, [{ key: "admin.employeeOperationalScope.write" }]);
    assert.equal(cap[0].key, vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE);
    // ...and granted to NO Role by SQL.
    const granted = (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE capability_id = 'cap_admin_employeeOperationalScope_write'`)).rows[0].n;
    assert.equal(granted, 0);
    // Scope and qualification are SEPARATE authorities with separate capabilities (Owner ruling).
    assert.notEqual(vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE, eligibility.EMPLOYEE_WORK_ELIGIBILITY_WRITE);
    assert.notEqual(vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE, "admin.employeeProfile.write");
    assert.notEqual(vocab.EMPLOYEE_OPERATIONAL_SCOPE_WRITE, "admin.employeeJobRole.write");
  });

  await t.test("scope and qualification are independent: neither table can answer the other's question", async () => {
    // e-1 currently covers two warehouses but holds NO qualification: scope alone proves nothing about eligibility.
    const quals = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility WHERE employee_id = 'e-1' AND effective_to IS NULL`)).rows[0].n;
    assert.equal(quals, 0);
    assert.deepEqual(await current("e-1"), ["wh-main", "wh-north"]);
    // Qualifying e-1 for warehouse operations changes no scope, and scoping changes no qualification.
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ('ewe-1', 't1', 'e-1', 'WAREHOUSE_OPERATIONS', $1, 'prn_fixture')`, [FROM]);
    assert.deepEqual(await current("e-1"), ["wh-main", "wh-north"], "qualifying an Employee grants no scope");
    // e-2 is qualified but scoped nowhere: qualification alone authorizes no warehouse.
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ('ewe-2', 't1', 'e-2', 'WAREHOUSE_OPERATIONS', $1, 'prn_fixture')`, [FROM]);
    assert.deepEqual(await current("e-2"), [], "a qualification grants no warehouse scope");
  });

  await t.test("one CURRENT row per target; re-scoping after ending is allowed", async () => {
    assert.match(await refusal(() => scope("e-1", "wh-main")) ?? "", /employee_operational_scope_one_current_per_target/);
    await q(`UPDATE eos_workforce.employee_operational_scopes SET effective_to = $1, ended_by = 'prn_fixture', ended_at = $1
              WHERE employee_id = 'e-1' AND scope_id = 'wh-main' AND effective_to IS NULL`, ["2026-09-18T00:00:00Z"]);
    assert.deepEqual(await current("e-1"), ["wh-north"]);
    await scope("e-1", "wh-main", "t1", "WAREHOUSE", "2026-09-19T00:00:00Z");
    assert.deepEqual(await current("e-1"), ["wh-main", "wh-north"]);
    const rows = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE employee_id = 'e-1' AND scope_id = 'wh-main'`)).rows[0].n;
    assert.equal(rows, 2, "the ended row is kept: scope history is append-only");
  });

  await t.test("an incomplete or out-of-order period is refused", async () => {
    assert.match(await refusal(() => q(
      `UPDATE eos_workforce.employee_operational_scopes SET effective_to = $1
        WHERE employee_id = 'e-1' AND scope_id = 'wh-north' AND effective_to IS NULL`, ["2026-09-20T00:00:00Z"],
    )) ?? "", /operational_scope_end_is_complete/);
    assert.match(await refusal(() => q(
      `INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, effective_to, ended_by, ended_at, assigned_by)
       VALUES ('eos-bad', 't1', 'e-2', 'WAREHOUSE', 'wh-main', '2026-09-20T00:00:00Z', '2026-09-01T00:00:00Z', 'prn_fixture', '2026-09-01T00:00:00Z', 'prn_fixture')`,
    )) ?? "", /operational_scope_period_ordered/);
  });

  await t.test("history is kept: DELETE refused, ended rows immutable, only ending a current row is permitted", async () => {
    assert.match(await refusal(() => q(`DELETE FROM eos_workforce.employee_operational_scopes WHERE employee_id = 'e-1'`)) ?? "",
      /keeps history: DELETE is refused/);
    assert.match(await refusal(() => q(
      `UPDATE eos_workforce.employee_operational_scopes SET reason = 'rewritten' WHERE employee_id = 'e-1' AND effective_to IS NOT NULL`,
    )) ?? "", /an ended scope is immutable/);
    for (const set of ["employee_id = 'e-2'", "scope_id = 'wh-retired'", "scope_type = 'WAREHOUSE'",
      "effective_from = '2020-01-01T00:00:00Z'", "assigned_by = 'someone-else'", "reason = 'changed'"]) {
      const msg = await refusal(() => q(
        `UPDATE eos_workforce.employee_operational_scopes SET ${set}
          WHERE employee_id = 'e-1' AND scope_id = 'wh-north' AND effective_to IS NULL`,
      ));
      // Re-pointing a current row is not "ending" it. (scope_type = 'WAREHOUSE' is a no-op write, so the trigger's
      // "only ending is permitted" rule catches it for the same reason.)
      assert.match(msg ?? "", /the only permitted change ends a current scope/, `UPDATE ${set} must be refused`);
    }
  });

  await t.test("an INACTIVE warehouse is still referenceable by the FK: ACTIVE is the writer's check, not the FK's", async () => {
    // The FK proves existence and tenancy. It cannot prove ACTIVE status, because status changes after the fact --
    // so the governed writer (step C) checks ACTIVE, and a scope whose warehouse later goes INACTIVE is a
    // remediation finding rather than a silent revocation. This records that division of labour.
    await scope("e-2", "wh-retired");
    assert.deepEqual(await current("e-2"), ["wh-retired"]);
    const status = (await q(`SELECT status::text FROM eos_ops.warehouses WHERE id = 'wh-retired'`)).rows[0].status;
    assert.equal(status, "INACTIVE");
  });

  await t.test("the down migration refuses to destroy recorded scope history", async () => {
    let message = null;
    try { migrate("down", DOWN_STEPS_TO_REACH_THIS_MIGRATION); } catch (err) { message = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message}`; }
    assert.ok(message, "reversing the migration with rows recorded must fail");
    assert.match(message, /refuses to reverse/);
    const still = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes`)).rows[0].n;
    assert.ok(still > 0);
  });
});

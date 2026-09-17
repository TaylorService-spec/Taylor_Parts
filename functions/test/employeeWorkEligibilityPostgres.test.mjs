// WORK ELIGIBILITY / QUALIFICATION authority, step A: the governed PostgreSQL schema against a real postgres:16.
//
// Step A adds the authority's SCHEMA and its platform vocabulary; the governed commands arrive in step C. So this suite
// proves what the SCHEMA itself guarantees, which is what later steps are allowed to rely on:
//
//   the platform vocabulary is closed         an unknown or LEGACY operationalRole value is refused by the database
//   a qualification grants no access          the table has no capability/permission/role/scope column, and the
//                                             migration grants the new capability to NO Role
//   multiple concurrent qualifications        one Employee may hold both codes at once
//   one current row per (Employee, code)      a duplicate CURRENT row is refused; re-qualification after ending is fine
//   history is kept                           DELETE refused, ended rows immutable, only "end a current row" permitted
//   tenant isolation is explicit              the Employee FK is composite (tenant_id, employee_id)
//
// The suite migrates its OWN disposable database.
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
const vocab = require("../lib/eosWorkforce/workEligibilityVocabulary.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
/** The database's own refusal, as a message -- never a hand-built expectation. */
const refusal = async (fn) => { try { await fn(); return null; } catch (err) { return err.message; } };

test("Employee Work Eligibility authority: closed platform vocabulary, no access, kept history", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `emp_work_elig_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (direction) => execFileSync(
    process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", direction, "--migrations-dir", "migrations"],
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
  await employee("e-1", "t1");
  await employee("e-2", "t1");
  await employee("e-t2", "t2");

  const FROM = "2026-09-17T00:00:00Z";
  let n = 0;
  const grant = (employeeId, code, tenant = "t1", from = FROM) => q(
    `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
     VALUES ($1, $2, $3, $4, $5, 'prn_fixture')`, [`ewe-${++n}`, tenant, employeeId, code, from],
  );
  const current = async (employeeId) => (await q(
    `SELECT qualification_code FROM eos_workforce.employee_work_eligibility
      WHERE employee_id = $1 AND effective_to IS NULL ORDER BY qualification_code`, [employeeId],
  )).rows.map((r) => r.qualification_code);

  await t.test("the platform vocabulary is closed: the two ruled codes are accepted", async () => {
    assert.deepEqual([...vocab.WORK_ELIGIBILITY_CODES], ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
    for (const code of vocab.WORK_ELIGIBILITY_CODES) await grant("e-1", code);
    // An Employee may hold MULTIPLE different qualifications simultaneously (Owner ruling).
    assert.deepEqual(await current("e-1"), ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
  });

  await t.test("the eight LEGACY operationalRole values are refused by the database, not merely unused", async () => {
    const legacy = ["PARTS_MANAGER", "PARTS_ASSOCIATE", "TECHNICIAN", "WAREHOUSE_MANAGER",
      "WAREHOUSE_ASSOCIATE", "SERVICE_MANAGER", "SALES_MANAGER", "SALES_ASSOCIATE"];
    for (const code of legacy) {
      const msg = await refusal(() => grant("e-2", code));
      assert.match(msg ?? "", /work_eligibility_code_known/, `legacy value ${code} must be refused`);
    }
    // ...and so is anything else, including a lowercase or padded spelling of a real code.
    for (const code of ["service_technician", " SERVICE_TECHNICIAN", "", "OWNER", "admin"]) {
      assert.match(await refusal(() => grant("e-2", code)) ?? "", /work_eligibility_code_known/);
    }
    assert.deepEqual(await current("e-2"), []);
  });

  await t.test("a qualification cannot grant application access: no such column exists, and the migration grants nothing", async () => {
    const columns = (await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_workforce' AND table_name = 'employee_work_eligibility' ORDER BY column_name`,
    )).rows.map((r) => r.column_name);
    assert.deepEqual(columns, ["assigned_by", "effective_from", "effective_to", "employee_id", "ended_at", "ended_by",
      "id", "qualification_code", "reason", "tenant_id"]);
    // Nothing here can express a capability, permission, Security Role, Job Role or scope.
    for (const column of columns) assert.doesNotMatch(column, /capab|permission|role_|_role|grant|scope|access/);
    // The capability VOCABULARY is defined...
    const cap = (await q(`SELECT key FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeWorkEligibility_write'`)).rows;
    assert.deepEqual(cap, [{ key: "admin.employeeWorkEligibility.write" }]);
    assert.equal(cap[0].key, vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE);
    // ...and granted to NO Role by SQL: who holds it comes only from the Role-catalog reconciliation.
    const granted = (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE capability_id = 'cap_admin_employeeWorkEligibility_write'`)).rows[0].n;
    assert.equal(granted, 0);
    // It is its own narrow capability -- not a rename or alias of the profile or Job Role capabilities.
    assert.notEqual(vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE, "admin.employeeProfile.write");
    assert.notEqual(vocab.EMPLOYEE_WORK_ELIGIBILITY_WRITE, "admin.employeeJobRole.write");
  });

  await t.test("one CURRENT row per (Employee, code); re-qualification after ending is allowed", async () => {
    assert.match(await refusal(() => grant("e-1", "SERVICE_TECHNICIAN")) ?? "", /employee_work_eligibility_one_current_per_code/);
    // End it, exactly as the governed writer will: effective_to + ended_by + ended_at together.
    await q(`UPDATE eos_workforce.employee_work_eligibility SET effective_to = $1, ended_by = 'prn_fixture', ended_at = $1
              WHERE employee_id = 'e-1' AND qualification_code = 'SERVICE_TECHNICIAN' AND effective_to IS NULL`,
      ["2026-09-18T00:00:00Z"]);
    assert.deepEqual(await current("e-1"), ["WAREHOUSE_OPERATIONS"]);
    await grant("e-1", "SERVICE_TECHNICIAN", "t1", "2026-09-19T00:00:00Z");
    assert.deepEqual(await current("e-1"), ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS"]);
    const rows = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility WHERE employee_id = 'e-1' AND qualification_code = 'SERVICE_TECHNICIAN'`)).rows[0].n;
    assert.equal(rows, 2, "the ended row is kept: qualification history is append-only");
  });

  await t.test("an incomplete or out-of-order period is refused", async () => {
    assert.match(await refusal(() => q(
      `UPDATE eos_workforce.employee_work_eligibility SET effective_to = $1
        WHERE employee_id = 'e-1' AND qualification_code = 'WAREHOUSE_OPERATIONS' AND effective_to IS NULL`, ["2026-09-20T00:00:00Z"],
    )) ?? "", /work_eligibility_end_is_complete/, "ending without ended_by/ended_at must be refused");
    assert.match(await refusal(() => q(
      `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, effective_to, ended_by, ended_at, assigned_by)
       VALUES ('ewe-bad', 't1', 'e-2', 'SERVICE_TECHNICIAN', '2026-09-20T00:00:00Z', '2026-09-01T00:00:00Z', 'prn_fixture', '2026-09-01T00:00:00Z', 'prn_fixture')`,
    )) ?? "", /work_eligibility_period_ordered/);
    assert.match(await refusal(() => grant("e-2", "SERVICE_TECHNICIAN", "t1", null)) ?? "", /effective_from/);
  });

  await t.test("history is kept: DELETE refused, ended rows immutable, only ending a current row is permitted", async () => {
    assert.match(await refusal(() => q(`DELETE FROM eos_workforce.employee_work_eligibility WHERE employee_id = 'e-1'`)) ?? "",
      /keeps history: DELETE is refused/);
    assert.match(await refusal(() => q(
      `UPDATE eos_workforce.employee_work_eligibility SET reason = 'rewritten'
        WHERE employee_id = 'e-1' AND effective_to IS NOT NULL`,
    )) ?? "", /an ended qualification is immutable/);
    // Re-pointing a current row at another Employee, code or start is not "ending" it.
    for (const set of ["employee_id = 'e-2'", "qualification_code = 'SERVICE_TECHNICIAN'",
      "effective_from = '2020-01-01T00:00:00Z'", "assigned_by = 'someone-else'", "reason = 'changed'"]) {
      assert.match(await refusal(() => q(
        `UPDATE eos_workforce.employee_work_eligibility SET ${set}
          WHERE employee_id = 'e-1' AND qualification_code = 'WAREHOUSE_OPERATIONS' AND effective_to IS NULL`,
      )) ?? "", /the only permitted change ends a current qualification/, `UPDATE ${set} must be refused`);
    }
  });

  await t.test("tenant isolation is explicit: a foreign-tenant Employee has no qualification row", async () => {
    // The FK is composite, so tenant t1 cannot qualify t2's Employee even with a real employee id.
    assert.match(await refusal(() => grant("e-t2", "SERVICE_TECHNICIAN", "t1")) ?? "", /work_eligibility_employee_fk/);
    assert.match(await refusal(() => grant("e-1", "SERVICE_TECHNICIAN", "t2")) ?? "", /work_eligibility_employee_fk/);
    // An unknown Employee is refused rather than created.
    assert.match(await refusal(() => grant("no-such-employee", "SERVICE_TECHNICIAN")) ?? "", /work_eligibility_employee_fk/);
  });

  await t.test("the down migration refuses to destroy recorded qualification history", async () => {
    let message = null;
    try { migrate("down"); } catch (err) { message = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message}`; }
    assert.ok(message, "reversing the migration with rows recorded must fail");
    assert.match(message, /refuses to reverse/);
    const still = (await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility`)).rows[0].n;
    assert.ok(still > 0, "the history is still there after the refused reversal");
  });
});

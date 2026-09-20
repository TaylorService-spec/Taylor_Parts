// WORK ORDER ASSIGNMENT: the assignee is an EMPLOYEE, the actor is a PRINCIPAL, and eligibility is
// Work Eligibility. Against a real postgres:16.
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
const authority = require("../lib/eosOps/workOrderAssignmentAuthority.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("Work Order assignment names an EMPLOYEE, never a technician id and never a uid", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `woa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);

  const principal = async (tenantId, subject) => repo.transact({ tenantId, uid: "fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const pDispatcher = await principal("t1", "uid-dispatcher");
  const pAlice = await principal("t1", "uid-alice");
  const pBob = await principal("t1", "uid-bob");
  const pUnlinked = await principal("t1", "uid-unlinked");

  const employee = (id, status = "ACTIVE", tenant = "t1") => q(
    `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
     VALUES ($1, $2, $3, 'taylor', '2020-01-01T00:00:00Z')`, [id, tenant, status]);
  let n = 0;
  const link = (employeeId, principalId, tenant = "t1") => q(
    `INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
     VALUES ($1, $2, $3, $4, 'taylor', 'OPERATOR_ASSERTED', 'f', 'test', 'active')`,
    [`epl-${++n}`, tenant, principalId, employeeId]);
  const qualify = (employeeId, code = "SERVICE_TECHNICIAN") => q(
    `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
     VALUES ($1, 't1', $2, $3, now(), 'fixture')`, [`ewe-${employeeId}-${code}`, employeeId, code]);

  await employee("e-alice"); await link("e-alice", pAlice); await qualify("e-alice");
  await employee("e-bob");   await link("e-bob", pBob);     await qualify("e-bob");
  await employee("e-unqualified"); // ACTIVE and linked to nobody in particular, but no qualification
  await employee("e-warehouse"); await qualify("e-warehouse", "WAREHOUSE_OPERATIONS");
  await employee("e-onleave", "ON_LEAVE"); await qualify("e-onleave");
  await employee("e-t2", "ACTIVE", "t2");

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by)
           VALUES ('acct-1','t1','Cust','ACTIVE','f','f')`);
  const workOrder = (id, status = "READY_TO_DISPATCH", tenant = "t1") => q(
    `INSERT INTO eos_ops.work_orders
       (id, tenant_id, operating_company_key, status, work_order_type, priority, customer_id,
        location_id, provenance, created_by_principal_id, created_at, updated_at)
     VALUES ($1, $2, 'sample-co', $3, 'SERVICE_CALL', 2, 'acct-1', 'loc-1', 'NATIVE', $4, now(), now())`,
    [id, tenant, status, tenant === "t1" ? pDispatcher : null]);
  for (const id of ["wo-1", "wo-2", "wo-3", "wo-x"]) await workOrder(id);
  await workOrder("wo-running", "WORK_IN_PROGRESS");

  const deps = { pool };
  const actor = (principalId, caps = [authority.WORK_ORDER_ASSIGN]) =>
    ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const assign = (input, who = pDispatcher) =>
    authority.assignWorkOrderToEmployee(deps, actor(who), { source: "SCHEDULE", ...input });

  await t.test("the capability is required, and it is checked before anything is read", async () => {
    await assert.rejects(
      authority.assignWorkOrderToEmployee(deps, actor(pDispatcher, []), { workOrderId: "wo-1", employeeId: "e-alice", source: "SCHEDULE" }),
      /requires workOrder\.lifecycle\.dispatch/);
  });

  await t.test("the command accepts no field it does not govern", async () => {
    for (const field of ["technicianId", "assignedTechId", "uid", "principalId", "securityRole"]) {
      await assert.rejects(assign({ workOrderId: "wo-1", employeeId: "e-alice", [field]: "x" }),
        /does not accept/, field);
    }
  });

  await t.test("ELIGIBILITY IS WORK ELIGIBILITY: no qualification, no assignment", async () => {
    await assert.rejects(assign({ workOrderId: "wo-1", employeeId: "e-unqualified" }),
      /SERVICE_TECHNICIAN qualification/);
    // Holding a DIFFERENT qualification is not holding this one.
    await assert.rejects(assign({ workOrderId: "wo-1", employeeId: "e-warehouse" }),
      /SERVICE_TECHNICIAN qualification/);
  });

  await t.test("an inactive Employee is not assignable, whatever they are qualified for", async () => {
    await assert.rejects(assign({ workOrderId: "wo-1", employeeId: "e-onleave" }),
      /only an ACTIVE Employee/);
  });

  await t.test("the tenant boundary cannot be named across", async () => {
    await assert.rejects(assign({ workOrderId: "wo-1", employeeId: "e-t2" }), /does not exist in this tenant/);
    await assert.rejects(assign({ workOrderId: "wo-nope", employeeId: "e-alice" }), /Work Order does not exist/);
  });

  await t.test("a Work Order already being worked is not reassignable by this command", async () => {
    await assert.rejects(assign({ workOrderId: "wo-running", employeeId: "e-alice" }),
      /not awaiting assignment/);
  });

  await t.test("assignment records the EMPLOYEE and the actor Principal, and they are different columns", async () => {
    const r = await assign({ workOrderId: "wo-1", employeeId: "e-alice" });
    assert.equal(r.outcome, "ASSIGNED");
    const { rows } = await q(`SELECT * FROM eos_ops.work_order_assignments WHERE work_order_id='wo-1'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assignee_employee_id, "e-alice");
    assert.equal(rows[0].assigned_by_principal_id, pDispatcher);
    assert.equal(rows[0].provenance, "NATIVE");
    assert.equal(rows[0].effective_to, null, "a new assignment is the current one");
    assert.notEqual(rows[0].assignee_employee_id, rows[0].assigned_by_principal_id);
  });

  await t.test("a reassignment states why, ends the prior interval and opens a new one", async () => {
    await assert.rejects(assign({ workOrderId: "wo-1", employeeId: "e-bob", source: "DISPATCH_REASSIGN" }),
      /states why/);
    const r = await authority.assignWorkOrderToEmployee(deps, actor(pDispatcher), {
      workOrderId: "wo-1", employeeId: "e-bob", source: "DISPATCH_REASSIGN", reason: "alice called in sick" });
    assert.equal(r.outcome, "REASSIGNED");
    const rows = (await q(`SELECT assignee_employee_id, effective_to IS NULL AS current, end_reason
                             FROM eos_ops.work_order_assignments WHERE work_order_id='wo-1'
                            ORDER BY effective_from, id`)).rows;
    assert.deepEqual(rows.map((x) => [x.assignee_employee_id, x.current]), [["e-alice", false], ["e-bob", true]]);
    assert.equal(rows[0].end_reason, "alice called in sick");
  });

  await t.test("assigning the same Employee again is NO_CHANGE and writes no history", async () => {
    const before = (await q(`SELECT count(*)::int n FROM eos_ops.work_order_assignments WHERE work_order_id='wo-1'`)).rows[0].n;
    const r = await authority.assignWorkOrderToEmployee(deps, actor(pDispatcher), {
      workOrderId: "wo-1", employeeId: "e-bob", source: "DISPATCH_REASSIGN", reason: "no-op" });
    assert.equal(r.outcome, "NO_CHANGE");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.work_order_assignments WHERE work_order_id='wo-1'`)).rows[0].n, before,
      "an interval that closed and reopened on the same person is a history of nothing");
  });

  await t.test("history is ended, never deleted, and an ended row is never re-pointed", async () => {
    await assert.rejects(q(`DELETE FROM eos_ops.work_order_assignments WHERE work_order_id='wo-1'`), /keeps history/);
    await assert.rejects(
      q(`UPDATE eos_ops.work_order_assignments SET assignee_employee_id='e-alice' WHERE work_order_id='wo-1' AND effective_to IS NOT NULL`),
      /history is not rewritten/);
  });

  await t.test("the own-assignment predicate compares EMPLOYEE to EMPLOYEE", async () => {
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", pBob, "wo-1"), true);
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", pAlice, "wo-1"), false,
      "the predicate follows the CURRENT assignment, not the historical one");
    // An unlinked Principal resolves to no Employee at all, so it can never be the assignee.
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", pUnlinked, "wo-1"), false);
    // A Principal id is not an Employee id, and passing one must not accidentally match.
    assert.equal(await authority.isCallerTheAssignedEmployee(pool, "t1", "e-bob", "wo-1"), false);
  });

  await t.test("two open assignments on one Work Order are impossible", async () => {
    await assert.rejects(
      q(`INSERT INTO eos_ops.work_order_assignments
           (id, tenant_id, work_order_id, assignee_employee_id, source, effective_from, assigned_by_principal_id, provenance)
         VALUES ('woa-dup','t1','wo-1','e-alice','SCHEDULE', now(), $1, 'NATIVE')`, [pDispatcher]),
      /work_order_assignments_one_current/);
  });
});

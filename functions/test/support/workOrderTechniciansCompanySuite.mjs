// COMPANY ISOLATION OF listWorkOrderTechnicians -- the Dispatcher Board lanes and the technician pickers -- under EOS Core
// company authority (DECISIONS #235; Owner ruling 8, 2026-10-17: REMAINING WORK ORDER READ ISOLATION).
//
// Imported by test/workOrderDomainCutoverPostgres.test.mjs so it runs in the Service Work Order Authority CI job; its own
// database and fixture world.
//
// Proves, against real PostgreSQL 16:
//   * capability first (CAPABILITY_MISSING), then company authority (COMPANY_AUTHORITY_REQUIRED);
//   * the roster is the eligible technicians of the caller's companies only -- Taylor never sees Ventana, and back;
//   * a Ventana workOrderId answers EXACTLY as a nonexistent one (code, category, message) in the same number of queries;
//   * the Taylor roster is identical however many Ventana technicians exist.
import { endPoolAndDrain } from "./poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const queries = require("../../lib/eosOps/workOrderQueries.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wotech";
const PICK = new Set(["workOrder.lifecycle.dispatch"]);

test("listWorkOrderTechnicians under EOS Core company authority, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wotech_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const c of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, c]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, c]);
  }
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$1,'eos','active')`, [pid]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`m-${pid}`, T, pid]);
  };
  const employee = async (eid, company, { technician }) => {
    const pid = `prn-${eid}`;
    await principal(pid);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE',$3,$1,$4)`, [eid, T, company, `Person ${eid}`]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','f','f')`, [`l-${eid}`, T, pid, eid, company]);
    if (technician) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
               VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'f','f')`, [`q-${eid}`, T, eid]);
    }
    return pid;
  };
  for (const e of ["emp-t1", "emp-t2"]) await employee(e, "taylor", { technician: true });
  for (const e of ["emp-v1", "emp-v2"]) await employee(e, "ventana", { technician: true });
  const taylorCaller = await employee("emp-office-t", "taylor", { technician: false });
  const ventanaCaller = await employee("emp-office-v", "ventana", { technician: false });
  const bothCaller = await employee("emp-office-both", "taylor", { technician: false });
  await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ('role-reach',$1,'reachFixture','Reach fixture','SYSTEM','f','f')`, [T]);
  await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
           VALUES ('ura-both-v',$1,$2,'role-reach','operatingCompany','ventana','active','f',0,'f','f')`, [T, bothCaller]);
  await principal("prn-unlinked");
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ('loc-1',$1,'acct-1','Main','f','f')`, [T]);
  for (const [id, key] of [["wo-t", "taylor"], ["wo-v", "ventana"]]) {
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,status,work_order_type,priority,customer_id,location_id,provenance,created_at,updated_at)
             VALUES ($1,$2,$3,'READY_TO_DISPATCH','SERVICE_CALL',2,'acct-1','loc-1','MIGRATED',now(),now())`, [id, T, key]);
  }

  const actor = (principalId, capabilities = PICK) => ({ tenantId: T, principalId, capabilities });
  const TAYLOR = actor(taylorCaller), VENTANA = actor(ventanaCaller), BOTH = actor(bothCaller);
  const counted = async (who, input) => {
    let n = 0;
    const p = new Proxy(pool, { get: (o, k) => (k === "query" ? (...a) => { n += 1; return o.query(...a); } : typeof o[k] === "function" ? o[k].bind(o) : o[k]) });
    try { return { ok: await queries.listWorkOrderTechnicians({ pool: p }, who, input), queries: n }; }
    catch (e) { return { refused: e.code, category: e.category, message: e.message, queries: n }; }
  };
  const ids = (r) => r.ok.items.map((e) => e.employeeId).sort();

  await t.test("CAPABILITY FIRST, then COMPANY AUTHORITY", async () => {
    for (const who of [actor("prn-unlinked", new Set()), actor(taylorCaller, new Set(["workOrder.record.read"]))]) {
      assert.equal((await counted(who, {})).refused, "CAPABILITY_MISSING");
    }
    for (const input of [{}, { workOrderId: "wo-t" }]) {
      const r = await counted(actor("prn-unlinked"), input);
      assert.equal(r.refused, "COMPANY_AUTHORITY_REQUIRED");
      assert.equal(r.category, "FORBIDDEN");
    }
  });

  await t.test("VISIBILITY: the roster is the caller's companies' eligible technicians only", async () => {
    assert.deepEqual(ids(await counted(TAYLOR, {})), ["emp-t1", "emp-t2"]);
    assert.deepEqual(ids(await counted(VENTANA, {})), ["emp-v1", "emp-v2"]);
    assert.deepEqual(ids(await counted(BOTH, {})), ["emp-t1", "emp-t2", "emp-v1", "emp-v2"]);
    assert.deepEqual(ids(await counted(TAYLOR, { workOrderId: "wo-t" })), ["emp-t1", "emp-t2"]);
    assert.deepEqual(ids(await counted(BOTH, { workOrderId: "wo-v" })), ["emp-v1", "emp-v2"], "the Work Order's company only (DQ-013)");
  });

  await t.test("EQUIVALENCE: a Ventana workOrderId answers EXACTLY as a nonexistent one, in the same number of queries", async () => {
    const outside = await counted(TAYLOR, { workOrderId: "wo-v" });
    const nothing = await counted(TAYLOR, { workOrderId: "wo-does-not-exist" });
    assert.equal(outside.refused, "WORK_ORDER_NOT_FOUND");
    assert.deepEqual(outside, nothing);
  });

  await t.test("INDEPENDENCE: the Taylor roster is identical however many Ventana technicians exist", async () => {
    const before = await counted(TAYLOR, {});
    await employee("emp-v3", "ventana", { technician: true });
    const after = await counted(TAYLOR, {});
    assert.deepEqual(after, before);
    assert.ok(ids(await counted(VENTANA, {})).includes("emp-v3"), "the Ventana data is real");
  });
});

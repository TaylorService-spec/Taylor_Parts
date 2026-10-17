// COMPANY ISOLATION OF readWorkOrderDetail -- one Work Order by id -- under EOS Core company authority (DECISIONS #235;
// Owner ruling 8, 2026-10-17: REMAINING WORK ORDER READ ISOLATION).
//
// Imported by test/workOrderDomainCutoverPostgres.test.mjs so it runs in the Service Work Order Authority CI job; its own
// database and fixture world.
//
// Proves, against real PostgreSQL 16:
//   * capability first (the entitled per-record decision, CAPABILITY_MISSING), then company authority
//     (COMPANY_AUTHORITY_REQUIRED for an unconditioned reader with no company);
//   * an office caller reads its own company's Work Orders and never another company's;
//   * a Ventana Work Order id answers EXACTLY as a nonexistent id -- code, category and message, in the same number of
//     queries -- for an unconditioned office reader AND for a technician whose grant is conditioned to own assignments;
//   * a technician still reads their own assigned Work Order (the technician field view).
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
const ctx = require("../../lib/eosOps/contextualAuthorization.js");
const model = require("../../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wodetail";

test("readWorkOrderDetail under EOS Core company authority, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wodetail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
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
  const employee = async (eid, company) => {
    const pid = `prn-${eid}`;
    await principal(pid);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE',$3,$1,$4)`, [eid, T, company, `Person ${eid}`]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','f','f')`, [`l-${eid}`, T, pid, eid, company]);
    return pid;
  };
  const taylorOffice = await employee("emp-office-t", "taylor");
  const ventanaOffice = await employee("emp-office-v", "ventana");
  const taylorTech = await employee("emp-tech-t", "taylor");
  await principal("prn-unlinked");
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ('loc-1',$1,'acct-1','Main','f','f')`, [T]);
  for (const [id, key] of [["wo-t", "taylor"], ["wo-t-mine", "taylor"], ["wo-v", "ventana"]]) {
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,customer_id,location_id,provenance,created_at,updated_at)
             VALUES ($1,$2,$3,$4,'READY_TO_DISPATCH','SERVICE_CALL',2,'acct-1','loc-1','MIGRATED',now(),now())`, [id, T, key, `WO-2026-${id === "wo-v" ? "900001" : id === "wo-t" ? "000001" : "000002"}`]);
  }
  await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,provenance)
           VALUES ('a-mine',$1,'wo-t-mine','emp-tech-t','MIGRATION',now(),'MIGRATED')`, [T]);

  const READ = ["workOrder.record.read"];
  const DQ016 = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey: "workOrder.record.read",
    condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
  const operational = (principalId, caps = READ, conditions = model.SHIPPED_GRANT_CONDITIONS) => {
    const ent = model.entitlementsFrom(caps.map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey })), conditions);
    return {
      tenantId: T, principalId,
      capabilities: new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey)),
      conditionallyHeld: new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey)),
      entitlements: () => ent,
    };
  };
  const read = async (who, workOrderId) => {
    let n = 0;
    const p = new Proxy(pool, { get: (o, k) => (k === "query" ? (...a) => { n += 1; return o.query(...a); } : typeof o[k] === "function" ? o[k].bind(o) : o[k]) });
    try { return { ok: await queries.readWorkOrderDetail({ pool: p, reader: ctx.postgresContextualReader(p) }, who, { workOrderId }), queries: n }; }
    catch (e) { return { refused: e.code, category: e.category, message: e.message, queries: n }; }
  };

  await t.test("CAPABILITY FIRST, then COMPANY AUTHORITY", async () => {
    for (const id of ["wo-t", "wo-v", "wo-nothing"]) {
      assert.equal((await read(operational(taylorOffice, []), id)).refused, "CAPABILITY_MISSING", id);
    }
    const r = await read(operational("prn-unlinked"), "wo-t");
    assert.equal(r.refused, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal(r.category, "FORBIDDEN");
  });

  await t.test("VISIBILITY: each office caller reads its own company's Work Orders only", async () => {
    assert.equal((await read(operational(taylorOffice), "wo-t")).ok.workOrderId, "wo-t");
    assert.equal((await read(operational(ventanaOffice), "wo-v")).ok.workOrderId, "wo-v");
    assert.equal((await read(operational(ventanaOffice), "wo-t")).refused, "WORK_ORDER_NOT_FOUND");
  });

  await t.test("EQUIVALENCE (office, unconditioned): a Ventana id answers EXACTLY as a nonexistent id, in the same number of queries", async () => {
    const outside = await read(operational(taylorOffice), "wo-v");
    const nothing = await read(operational(taylorOffice), "wo-does-not-exist");
    assert.equal(outside.refused, "WORK_ORDER_NOT_FOUND");
    assert.deepEqual(outside, nothing);
  });

  await t.test("EQUIVALENCE (technician, conditioned to own assignments): a Ventana id answers EXACTLY as a nonexistent id; their own Work Order still reads", async () => {
    const tech = operational(taylorTech, READ, DQ016);
    assert.equal((await read(tech, "wo-t-mine")).ok.workOrderId, "wo-t-mine", "the technician field view still works");
    const outside = await read(tech, "wo-v");
    const nothing = await read(tech, "wo-does-not-exist");
    assert.ok(outside.refused);
    assert.deepEqual(outside, nothing);
    assert.deepEqual(await read(tech, "wo-t"), await read(tech, "wo-does-not-exist-2"), "someone else's in-company job: the same refusal too");
  });
});

// TECHNICIAN JOB CONTEXT (UAT P1-4) -- the Work Order detail page takes its customer name, site name and site address
// from the governed Work Order read ITSELF (readWorkOrder -> readWorkOrderDetail), not from the CRM Account/Location
// reads. This suite proves the server half of that, against a real postgres:16, with NO server change:
//
//   - the assigned technician (workOrder.record.read conditioned to RECORD_ASSIGNMENT, DQ-016) reads customerName,
//     locationName and the site address on their OWN Work Order;
//   - another technician is refused by the same per-record gate, and the refusal carries no row data;
//   - the technician is STILL refused by the CRM authority (getAccount / getAccountLocation / listAccounts) -- the
//     page change widens nothing in CRM;
//   - an office role reads the SAME values through the Work Order projection that the CRM reads return today, so the
//     page shows the office exactly what it showed before.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { configureRoundTheClock } from "./support/syntheticAvailability.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ops = require("../lib/eosOps/workOrderOperations.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");
const crmAccounts = require("../lib/eosCrm/accountAuthority.js");
const crmLocations = require("../lib/eosCrm/accountLocationAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const capsOf = (...roleKeys) => new Set(BASELINE.grants.filter((g) => roleKeys.includes(g.roleKey)).map((g) => g.capabilityKey));

// ════════════════════ OFFLINE ════════════════════

test("the committed baseline: the technician reads Work Orders but holds no CRM customer read; the dispatcher holds both", () => {
  assert.equal(capsOf("technician").has("workOrder.record.read"), true);
  assert.equal(capsOf("technician").has("customer.record.read"), false, "the job context must not depend on a CRM grant the technician lacks");
  assert.equal(capsOf("dispatcher").has("customer.record.read"), true);
  assert.equal(capsOf("dispatcher").has("workOrder.record.read"), true);
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wojobctx";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("Work Order technician job context", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wojob_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,'taylor','taylor','ACTIVE','MIGRATED','fixture','fixture','fixture')`, [T]);
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'eos','active')`, [pid, `sub-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  const employee = async (eid) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE','taylor',$1,$3)`, [eid, T, `Tech ${eid}`]);
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
             VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','job context fixture')`, [`elig-${eid}`, T, eid]);
  };
  const link = (pid, eid) => q(
    `INSERT INTO eos_policy.employee_principal_links
       (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
     VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','job context fixture')`, [`lnk-${pid}`, T, pid, eid]);
  for (const p of ["prn-dispatcher", "prn-tech-a", "prn-tech-b"]) await principal(p);
  await employee("emp-a"); await link("prn-tech-a", "emp-a");
  await employee("emp-b"); await link("prn-tech-b", "emp-b");
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Grill','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations
             (id,tenant_id,account_id,name,address_street,address_city,address_state,address_postal_code,access_notes,created_by,updated_by)
           VALUES ('loc-1',$1,'acct-1','Main kitchen','1 Pier Rd','Portsmouth','NH','03801','Gate code 4471','f','f')`, [T]);

  const OFFICE = ["workOrder.lifecycle.ready", "workOrder.lifecycle.schedule"];
  const P = Object.freeze({
    dispatcher: { principalId: "prn-dispatcher", caps: new Set([...capsOf("dispatcher"), ...OFFICE]) },
    techA: { principalId: "prn-tech-a", caps: capsOf("technician") },
    techB: { principalId: "prn-tech-b", caps: capsOf("technician") },
  });
  const DQ016 = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey: "workOrder.record.read",
    condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
  const caller = (p, conditions = model.SHIPPED_GRANT_CONDITIONS) => {
    const ent = model.entitlementsFrom([...p.caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey })), conditions);
    const unconditioned = new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey));
    return {
      actor: { tenantId: T, principalId: p.principalId, capabilities: unconditioned },
      operational: { tenantId: T, principalId: p.principalId, capabilities: unconditioned,
        conditionallyHeld: new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey)), entitlements: () => ent },
    };
  };
  const tech = (p) => caller(p, DQ016);
  const deps = { pool, reader: ctx.postgresContextualReader(pool) };
  // The SAME operation the page's useWorkOrder hook calls (readWorkOrder), not a helper beneath it.
  const readWorkOrder = (c, workOrderId) => ops.EOS_WORK_ORDER_OPERATIONS.readWorkOrder(deps, c, { workOrderId });

  let seq = 0;
  const scheduled = async (employeeId, days) => {
    const id = `wo-${++seq}`;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
                complaint, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,'taylor',$3,'READY_TO_DISPATCH','SERVICE_CALL',2,'acct-1','loc-1','Walk-in cooler warm','NATIVE','prn-dispatcher',now(),now())`,
      [id, T, `WO-2034-${String(seq).padStart(6, "0")}`]);
    const s = Date.now() + days * DAY;
    await scheduling.scheduleWorkOrder({ pool }, caller(P.dispatcher).actor,
      { workOrderId: id, employeeId, scheduledStart: new Date(s).toISOString(), scheduledEnd: new Date(s + 2 * HOUR).toISOString() });
    return id;
  };
  await configureRoundTheClock(pool, caller(P.dispatcher).actor, ["emp-a", "emp-b"]);
  const woA = await scheduled("emp-a", 2);
  const woB = await scheduled("emp-b", 3);

  await t.test("the assigned technician's readWorkOrder carries the customer name, site name and site address of their OWN job", async () => {
    const d = await readWorkOrder(tech(P.techA), woA);
    assert.equal(d.workOrderId, woA);
    assert.deepEqual([d.customerId, d.customerName, d.locationId, d.locationName], ["acct-1", "Harbor Grill", "loc-1", "Main kitchen"]);
    assert.equal(d.location.street, "1 Pier Rd");
    assert.equal(d.location.city, "Portsmouth");
    assert.equal(d.location.state, "NH");
    assert.equal(d.location.postalCode, "03801");
  });

  await t.test("another technician is refused by the per-record gate (NOT_ASSIGNED / FORBIDDEN) and the refusal carries no row data", async () => {
    await assert.rejects(readWorkOrder(tech(P.techB), woA), (e) => {
      assert.equal(e.code, "NOT_ASSIGNED");
      assert.equal(e.category, "FORBIDDEN");
      for (const leaked of ["Harbor Grill", "Main kitchen", "1 Pier Rd", "Gate code"]) assert.equal(String(e.message).includes(leaked), false);
      assert.equal("customerName" in e, false);
      return true;
    });
    assert.equal((await readWorkOrder(tech(P.techB), woB)).workOrderId, woB, "techB still reads their own");
  });

  await t.test("the technician is STILL refused by the CRM authority: getAccount, getAccountLocation, listAccounts (CAPABILITY_REQUIRED)", async () => {
    const actor = tech(P.techA).actor;
    const refused = (e) => { assert.equal(e.code, "CAPABILITY_REQUIRED"); assert.equal(e.category, "FORBIDDEN"); return true; };
    await assert.rejects(crmAccounts.getAccount({ pool }, actor, { accountId: "acct-1" }), refused);
    await assert.rejects(crmLocations.getAccountLocation({ pool }, actor, { accountLocationId: "loc-1" }), refused);
    await assert.rejects(crmAccounts.listAccounts({ pool }, actor, {}), refused);
  });

  await t.test("OFFICE PARITY: the dispatcher's Work Order projection equals what the CRM reads returned to the page before", async () => {
    const office = caller(P.dispatcher);
    const d = await readWorkOrder(office, woA);
    const account = await crmAccounts.getAccount({ pool }, office.actor, { accountId: d.customerId });
    const location = await crmLocations.getAccountLocation({ pool }, office.actor, { accountLocationId: d.locationId });
    assert.equal(d.customerName, account.name);
    assert.equal(d.locationName, location.name);
    assert.deepEqual(
      [d.location.street, d.location.city, d.location.state, d.location.postalCode],
      [location.addressStreet, location.addressCity, location.addressState, location.addressPostalCode],
    );
  });
});

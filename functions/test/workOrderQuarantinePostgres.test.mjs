// THE PINNED WORK ORDER QUARANTINE (Owner DECISION 3, 2026-09-30) -- migration 1764310000000,
// eosOps/workOrderQuarantine.ts, scripts/workOrderQuarantineCli.js.
//
// The thirteen real rows exist only in taylor-nonprod, so this suite proves:
//   * the relation admits EXACTLY the committed pins (the CHECK constraint equals PROTECTED_WORK_ORDERS);
//   * an insert whose Work Order does not match its pin is refused by the database, and the CLI refuses the whole
//     step and writes nothing (fail closed);
//   * every operational surface excludes a quarantined Work Order -- proven on a synthetic row after relaxing the
//     pinned-set CHECK in THIS disposable database only (the pin trigger stays on: the synthetic row is pinned with
//     its own real fingerprint);
//   * the relation is append-only, and a quarantined Work Order stays excluded even if it later changes.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pins = require("../lib/eosOps/migration/workOrderProtectedRows.js");
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");
const execution = require("../lib/eosOps/workOrderExecution.js");
const queries = require("../lib/eosOps/workOrderQueries.js");
const partsPlan = require("../lib/eosOps/workOrderPartsPlanAuthority.js");
const assignment = require("../lib/eosOps/workOrderAssignmentAuthority.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const MIGRATION = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1764310000000_work-order-quarantine.sql"), "utf8");

test("the relation's pinned-set CHECK names EXACTLY the committed pins -- id, number and fingerprint", () => {
  const check = MIGRATION.slice(MIGRATION.indexOf("wo_quarantine_exact_pinned_set"));
  const triples = [...check.slice(0, check.indexOf("))\n);")).matchAll(/\('([^']+)', '([^']+)', '([0-9a-f]{64})'\)/g)]
    .map((m) => ({ id: m[1], number: m[2], fingerprint: m[3] }));
  assert.equal(triples.length, 13);
  assert.deepEqual(triples.sort((a, b) => a.number.localeCompare(b.number)),
    pins.PROTECTED_WORK_ORDERS.map((w) => ({ id: w.id, number: w.number, fingerprint: w.fingerprint })));
  assert.equal(pins.OWNER_DECISION, "C_QUARANTINE");
});

test("the quarantine never mutates a Work Order: no UPDATE/DELETE of work_orders or a dependent anywhere in the step", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("--")).join("\n");
  for (const file of ["scripts/workOrderQuarantineCli.js", "migrations/1764310000000_work-order-quarantine.sql"]) {
    const code = strip(readFileSync(resolve(FUNCTIONS_DIR, file), "utf8"));
    assert.doesNotMatch(code, /(UPDATE|DELETE FROM)\s+(eos_ops\.)?work_order(s|_assignments|_parts_plan|_transitions|_schedule_history)\b/i, file);
  }
});

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-woq";
const HOUR = 3_600_000;

test("the pinned quarantine, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `woq_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,'taylor-nonprod-shape',$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,'taylor','taylor','ACTIVE','NATIVE','fixture','fixture','fixture')`, [T]);
  for (const p of ["prn-disp", "prn-tech"]) {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$1,'eos','active')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`m-${p}`, T, p]);
  }
  await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id) VALUES ('emp-t',$1,'ACTIVE','taylor')`, [T]);
  await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
           VALUES ('l-t',$1,'prn-tech','emp-t','taylor','OPERATOR_ASSERTED','active','f','f')`, [T]);
  await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
           VALUES ('el-t',$1,'emp-t','SERVICE_TECHNICIAN',now(),'f','f')`, [T]);

  const PIN = pins.PROTECTED_WORK_ORDERS[0];
  const start = new Date(Date.now() + 3 * 24 * HOUR);
  const end = new Date(start.getTime() + 2 * HOUR);
  // A synthetic row carrying a PINNED id and number but NOT the pinned content.
  await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,customer_id,location_id,
             scheduled_start,scheduled_end,provenance,created_at,updated_at)
           VALUES ($1,$2,'taylor',$3,'SCHEDULED','SERVICE_CALL',2,'acct','loc',$4,$5,'MIGRATED',now(),now())`, [PIN.id, T, PIN.number, start, end]);
  await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,provenance)
           VALUES ('woa-q',$1,$2,'emp-t','MIGRATION',now(),'MIGRATED')`, [T, PIN.id]);
  await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,customer_id,location_id,
             provenance,created_by_principal_id,created_at,updated_at)
           VALUES ('wo-live',$1,'taylor','WO-2031-000001','READY_TO_DISPATCH','SERVICE_CALL',2,'acct','loc','NATIVE','prn-disp',now(),now())`, [T]);
  const insertPin = (row) => q(
    `INSERT INTO eos_ops.work_order_quarantine (tenant_id,work_order_id,work_order_number,fingerprint,classification,reason,provenance,quarantined_by)
     VALUES ($1,$2,$3,$4,'OBSOLETE/BAD_COPY','r','p','test')`, [T, row.id, row.number, row.fingerprint]);

  await t.test("FAIL CLOSED: a pinned id whose row does not match its pin is refused by the database", async () => {
    await assert.rejects(insertPin(PIN), /WORK_ORDER_QUARANTINE_PIN_MISMATCH/);
  });

  await t.test("EXACT SET: a triple outside the pins is refused by the CHECK -- there is no generic quarantine", async () => {
    // Presented with its REAL fingerprint (so the pin trigger passes), an unpinned Work Order is still refused.
    const fp = (await q(`SELECT eos_ops.work_order_pin_fingerprint(w) fp FROM eos_ops.work_orders w WHERE id = 'wo-live'`)).rows[0].fp;
    await assert.rejects(insertPin({ id: "wo-live", number: "WO-2031-000001", fingerprint: fp }), /wo_quarantine_exact_pinned_set/);
  });

  await t.test("the CLI plans read-only, and refuses the whole apply when any pin does not match -- nothing written", async () => {
    const cli = (...args) => spawnSync(process.execPath, ["scripts/workOrderQuarantineCli.js", ...args],
      { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, encoding: "utf8" });
    for (const args of [["taylor-nonprod-shape", "--actor", "operator"], ["taylor-nonprod-shape", "--apply", "--actor", "operator"]]) {
      const run = cli(...args);
      assert.equal(run.status, 3, run.stdout + run.stderr);
      assert.match(run.stdout, /FAILED: (PINNED_ROW_MISSING|FINGERPRINT_MISMATCH)/);
    }
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.work_order_quarantine`)).rows[0].n, 0);
    assert.notEqual(cli("taylor-nonprod-shape").status, 0, "--actor is required");
  });

  // ── Runtime exclusion, on the synthetic row pinned with its OWN fingerprint (pinned-set CHECK relaxed HERE ONLY) ──
  await q(`ALTER TABLE eos_ops.work_order_quarantine DROP CONSTRAINT wo_quarantine_exact_pinned_set`);
  const ownFp = (await q(`SELECT eos_ops.work_order_pin_fingerprint(w) fp FROM eos_ops.work_orders w WHERE id = $1`, [PIN.id])).rows[0].fp;
  await insertPin({ id: PIN.id, number: PIN.number, fingerprint: ownFp });

  const caps = new Set(["workOrder.record.read", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel",
    "workOrder.transition", "workOrder.parts.plan", "workOrder.execution.record", "workOrder.lifecycle.complete"]);
  const actor = (principalId) => ({ tenantId: T, principalId, capabilities: caps });
  const operational = (principalId) => {
    const ent = model.entitlementsFrom([...caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "x" }, capabilityKey })));
    return { ...actor(principalId), conditionallyHeld: new Set(), entitlements: () => ent };
  };
  const reader = ctx.postgresContextualReader(pool);
  const quarantined = (e) => { assert.equal(e.code, "WORK_ORDER_QUARANTINED", JSON.stringify(e)); return true; };

  await t.test("QUEUES and SEARCH: the quarantined Work Order is in no office, dispatcher or technician list", async () => {
    const all = await queries.listWorkOrders({ pool }, actor("prn-disp"), {});
    assert.deepEqual(all.items.map((w) => w.workOrderId), ["wo-live"]);
    assert.deepEqual((await queries.listWorkOrders({ pool }, actor("prn-disp"), { search: PIN.number })).items, []);
    assert.deepEqual((await queries.listMyAssignedWorkOrders({ pool, reader }, operational("prn-tech"), {})).items, [],
      "the technician still holds the migrated assignment, and still does not see it");
  });

  await t.test("DETAIL and every COMMAND refuse WORK_ORDER_QUARANTINED", async () => {
    await assert.rejects(queries.readWorkOrderDetail({ pool, reader }, operational("prn-disp"), { workOrderId: PIN.id }), quarantined);
    await assert.rejects(lifecycle.transitionWorkOrder({ pool }, actor("prn-disp"), { workOrderId: PIN.id, expectedStatus: "SCHEDULED", toStatus: "CANCELLED" }), quarantined);
    await assert.rejects(scheduling.dispatchWorkOrder({ pool }, actor("prn-disp"), { workOrderId: PIN.id }), quarantined);
    await assert.rejects(scheduling.unscheduleWorkOrder({ pool }, actor("prn-disp"), { workOrderId: PIN.id, reason: "x" }), quarantined);
    await assert.rejects(scheduling.setWorkOrderEstimatedDuration({ pool }, actor("prn-disp"), { workOrderId: PIN.id, estimatedDurationMinutes: 30 }), quarantined);
    await assert.rejects(assignment.assignWorkOrderToEmployee({ pool }, actor("prn-disp"),
      { workOrderId: PIN.id, employeeId: "emp-t", source: "DISPATCH_REASSIGN", reason: "x" }), quarantined);
    await assert.rejects(partsPlan.setPartsPlan({ pool }, actor("prn-disp"), { workOrderId: PIN.id, plan: [] }), quarantined);
    await assert.rejects(execution.recordWorkOrderExecution({ pool }, actor("prn-tech"), { workOrderId: PIN.id, idempotencyKey: "k", note: "n" }), quarantined);
  });

  await t.test("SCHEDULING CANDIDATES: a quarantined window never blocks a technician", async () => {
    const w = { scheduledStart: new Date(start.getTime() + HOUR / 2).toISOString(), scheduledEnd: new Date(end.getTime() - HOUR / 2).toISOString() };
    const r = await scheduling.scheduleWorkOrder({ pool }, actor("prn-disp"), { workOrderId: "wo-live", employeeId: "emp-t", ...w });
    assert.equal(r.transition.toStatus, "SCHEDULED", "the quarantined SCHEDULED row's overlapping window was not a conflict");
  });

  await t.test("APPEND-ONLY, and FAIL CLOSED after a change: a quarantine is lifted only by a reviewed migration", async () => {
    await assert.rejects(q(`DELETE FROM eos_ops.work_order_quarantine`), /append-only/);
    await assert.rejects(q(`UPDATE eos_ops.work_order_quarantine SET reason = 'x'`), /append-only/);
    await q(`UPDATE eos_ops.work_orders SET priority = 1 WHERE id = $1`, [PIN.id]);
    assert.deepEqual((await queries.listWorkOrders({ pool }, actor("prn-disp"), {})).items.map((w) => w.workOrderId), ["wo-live"]);
    await assert.rejects(queries.readWorkOrderDetail({ pool, reader }, operational("prn-disp"), { workOrderId: PIN.id }), quarantined);
    const rows = await q(`SELECT count(*)::int n FROM eos_ops.work_orders WHERE id = $1`, [PIN.id]);
    assert.equal(rows.rows[0].n, 1, "preserved, never deleted");
  });
});

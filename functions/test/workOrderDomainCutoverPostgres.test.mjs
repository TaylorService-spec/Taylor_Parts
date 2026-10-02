// WORK ORDER DOMAIN CUTOVER -- the governed PostgreSQL command edges, execution facts and reads, against a real
// postgres:16 (WORK ORDER DOMAIN CUTOVER AUTHORIZATION, 2026-09-30).
//
// Personas hold the COMMITTED baseline grants (roleCapabilityAuthorityBaseline.json) -- and, where a proof needs
// a capability the baseline grants to nobody (workOrder.lifecycle.ready / .schedule / .close,
// workOrder.execution.record), the test states that grant EXPLICITLY as the pending Administration decision it
// is. A baseline-only persona is proven refused first, so no proof below can pass on a grant nobody holds.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");
const execution = require("../lib/eosOps/workOrderExecution.js");
const queries = require("../lib/eosOps/workOrderQueries.js");
const partsPlan = require("../lib/eosOps/workOrderPartsPlanAuthority.js");
const availability = require("../lib/eosOps/workOrderAvailability.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const capsOf = (...roleKeys) => new Set(BASELINE.grants.filter((g) => roleKeys.includes(g.roleKey)).map((g) => g.capabilityKey));

/** The Administration decisions this package proposes (Decision Queue) -- stated, never assumed. */
const PROPOSED_OFFICE_GRANTS = ["workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.lifecycle.close"];
const PROPOSED_TECHNICIAN_GRANTS = ["workOrder.execution.record"];

// ════════════════════ OFFLINE ════════════════════

test("the command modules never write status: applyTransitionWithinTransaction is the one status writer", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const rel of ["workOrderScheduling.ts", "workOrderExecution.ts", "workOrderQueries.ts", "workOrderOperations.ts"]) {
    const src = strip(readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps", rel), "utf8"));
    assert.equal(/\bSET\s+status\s*=/i.test(src), false, `${rel} writes status`);
    assert.equal(/firebase-admin|firebase-functions|getFirestore|onCall|fieldops_wos/.test(src), false, `${rel}: Firebase`);
    assert.equal(/caller\.role|caller\.technicianId|customClaims|operationalRoles|technicianId/.test(src), false, `${rel}: legacy identity`);
    assert.equal(/inventory_commitments|reserveParts|consumeParts|releaseParts|releaseOutstanding|reconcileConsumption/.test(src), false,
      `${rel}: an inventory effect -- stock movement is an explicit boundary`);
  }
});

test("equipment INSTALL is on the Work Order route, and ONLY there (Controller EQUIPMENT ACTIVATION, OD-5): the governed INSTALL Work Order is the one installation workflow", () => {
  const ops = require("../lib/eosOps/workOrderOperations.js");
  assert.deepEqual(Object.keys(ops.EOS_WORK_ORDER_OPERATIONS).filter((k) => /install/i.test(k)).sort(),
    ["listInstallableEquipmentForWorkOrder", "recordWorkOrderEquipmentInstall"]);
  const equipment = require("../lib/eosOps/equipmentOperations.js");
  assert.deepEqual(Object.keys(equipment.EOS_EQUIPMENT_OPERATIONS).filter((k) => /install/i.test(k)), [], "the register route never installs");
});

test("DQ-010: exactly one new capability, registered with no grant", () => {
  const sql = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1764300000000_work-order-execution-facts.sql"), "utf8");
  const up = sql.split("-- Down Migration")[0];
  assert.match(up, /'workOrder\.execution\.record'/);
  assert.equal(/INSERT INTO (eos_policy\.)?role_capabilities/i.test(up), false, "definition is not grant");
  assert.equal(BASELINE.grants.some((g) => g.capabilityKey === "workOrder.execution.record"), false);
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wocut";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("the Work Order domain cutover", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wocut_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$3,'ACTIVE','MIGRATED','fixture','fixture','fixture')`, [T, company, key]);
  }
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'eos','active')`, [pid, `sub-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  const employee = async (eid, { status = "ACTIVE", company = "taylor", qualified = true } = {}) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,$3,$4,$1,$5)`, [eid, T, status, company, `Tech ${eid}`]);
    if (qualified) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
               VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','cutover fixture')`, [`elig-${eid}`, T, eid]);
    }
  };
  const link = (pid, eid, company = "taylor") => q(
    `INSERT INTO eos_policy.employee_principal_links
       (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
     VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','cutover fixture')`, [`lnk-${pid}`, T, pid, eid, company]);

  for (const p of ["prn-dispatcher", "prn-svcmgr", "prn-tech-a", "prn-tech-b", "prn-tech-c", "prn-tech-ventana", "prn-parts"]) await principal(p);
  await employee("emp-a"); await link("prn-tech-a", "emp-a");
  await employee("emp-b"); await link("prn-tech-b", "emp-b");
  await employee("emp-c", { status: "CONTRACTOR" }); await link("prn-tech-c", "emp-c");
  await employee("emp-ventana", { company: "ventana" }); await link("prn-tech-ventana", "emp-ventana", "ventana");
  await employee("emp-unqualified", { qualified: false });
  await employee("emp-unlinked");
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,address_city,created_by,updated_by)
           VALUES ('loc-1',$1,'acct-1','Harbor Diner Main','1 Pier Rd','Portsmouth','f','f')`, [T]);

  const withGrants = (base, extra) => new Set([...base, ...extra]);
  const P = Object.freeze({
    dispatcherBaseline: { principalId: "prn-dispatcher", caps: capsOf("dispatcher") },
    dispatcher: { principalId: "prn-dispatcher", caps: withGrants(capsOf("dispatcher"), PROPOSED_OFFICE_GRANTS) },
    serviceManager: { principalId: "prn-svcmgr", caps: withGrants(capsOf("fieldManager"), PROPOSED_OFFICE_GRANTS) },
    techABaseline: { principalId: "prn-tech-a", caps: capsOf("technician") },
    techA: { principalId: "prn-tech-a", caps: withGrants(capsOf("technician"), PROPOSED_TECHNICIAN_GRANTS) },
    techB: { principalId: "prn-tech-b", caps: withGrants(capsOf("technician"), PROPOSED_TECHNICIAN_GRANTS) },
    techC: { principalId: "prn-tech-c", caps: withGrants(capsOf("technician"), PROPOSED_TECHNICIAN_GRANTS) },
    parts: { principalId: "prn-parts", caps: capsOf("partsAssociate") },
  });
  const actor = (p) => ({ tenantId: T, principalId: p.principalId, capabilities: p.caps });
  /** The entitled actor the record read needs, composed by the SAME model the runtime uses. */
  const operational = (p, conditions = model.SHIPPED_GRANT_CONDITIONS) => {
    const ent = model.entitlementsFrom([...p.caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey })), conditions);
    return {
      tenantId: T, principalId: p.principalId,
      capabilities: new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey)),
      conditionallyHeld: new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey)),
      entitlements: () => ent,
    };
  };
  const reader = ctx.postgresContextualReader(pool);
  const deps = { pool };
  // DECISION 5 (Owner, 2026-09-30): a placement REFUSES AVAILABILITY_NOT_CONFIGURED when the technician has no working
  // hours -- EOS never assumes 24/7. These proofs are about the lifecycle, not the calendar, so each schedulable
  // technician is given EXPLICIT synthetic round-the-clock hours through the governed command (never raw SQL).
  // The calendar itself is proven in workOrderAvailabilityPostgres.test.mjs.
  const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  const configureHours = (employeeId) => availability.setTechnicianWorkingHours(deps, { actor: actor(P.dispatcher) },
    { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "synthetic acceptance availability" });
  for (const e of ["emp-a", "emp-b", "emp-c"]) await configureHours(e);
  let seq = 0;
  const newWo = async (status = "READY_TO_DISPATCH", extra = {}) => {
    const id = `wo-${++seq}`;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
                sales_order_id, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,$6,$3,$4,'SERVICE_CALL',2,'acct-1','loc-1',$5,'NATIVE','prn-dispatcher',now(),now())`,
      [id, T, `WO-2031-${String(seq).padStart(6, "0")}`, status, extra.salesOrderId ?? null, extra.companyKey ?? "taylor"]);
    return id;
  };
  const future = (days, hours = 2) => {
    const start = Date.now() + days * DAY;
    return { scheduledStart: new Date(start).toISOString(), scheduledEnd: new Date(start + hours * HOUR).toISOString() };
  };
  const statusOf = async (id) => (await q(`SELECT status::text AS s FROM eos_ops.work_orders WHERE id=$1`, [id])).rows[0].s;
  const counts = async () => (await q(`SELECT
      (SELECT count(*)::int FROM eos_ops.work_order_transitions) AS t,
      (SELECT count(*)::int FROM eos_ops.work_order_assignments) AS a,
      (SELECT count(*)::int FROM eos_ops.work_order_schedule_history) AS h,
      (SELECT count(*)::int FROM eos_ops.inventory_commitments) AS inv`)).rows[0];

  // ════════════════════ SCHEDULE ════════════════════

  await t.test("SCHEDULE is refused to the baseline dispatcher: workOrder.lifecycle.schedule is granted to nobody", async () => {
    const wo = await newWo();
    const before = await counts();
    await assert.rejects(scheduling.scheduleWorkOrder(deps, actor(P.dispatcherBaseline), { workOrderId: wo, employeeId: "emp-a", ...future(3) }),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); assert.match(e.message, /workOrder\.lifecycle\.schedule/); return true; });
    assert.deepEqual(await counts(), before, "a refused schedule writes nothing");
  });

  await t.test("SCHEDULE places, assigns, records history and a transition -- in one transaction", async () => {
    const wo = await newWo();
    const w = future(3);
    const r = await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-a", ...w });
    assert.equal(r.transition.toStatus, "SCHEDULED");
    assert.equal(r.assignment.outcome, "ASSIGNED");
    assert.equal(r.scheduledStart, w.scheduledStart);
    // DECISION 5: the calendar IS consulted now (emp-a has explicit synthetic hours), and a clean placement carries no
    // warning -- the former AVAILABILITY_NOT_MODELED warning is gone, and outside-hours refuses rather than warns.
    assert.deepEqual(r.warnings.map((x) => x.code), [], "the calendar was consulted and the placement is inside it");
    const { rows } = await q(`SELECT w.status::text AS s, w.scheduled_start, a.assignee_employee_id, a.source
                                FROM eos_ops.work_orders w JOIN eos_ops.work_order_assignments a ON a.work_order_id=w.id AND a.effective_to IS NULL
                               WHERE w.id=$1`, [wo]);
    assert.deepEqual([rows[0].s, new Date(rows[0].scheduled_start).toISOString(), rows[0].assignee_employee_id, rows[0].source],
      ["SCHEDULED", w.scheduledStart, "emp-a", "SCHEDULE"]);
    const hist = await q(`SELECT previous_start, new_start FROM eos_ops.work_order_schedule_history WHERE work_order_id=$1`, [wo]);
    assert.equal(hist.rows.length, 1);
    assert.equal(hist.rows[0].previous_start, null);
  });

  await t.test("SCHEDULE refuses: past start, inverted window, > 14 days, and names the rule", async () => {
    const wo = await newWo();
    const past = new Date(Date.now() - 2 * HOUR);
    for (const [input, code] of [
      [{ scheduledStart: past.toISOString(), scheduledEnd: new Date(past.getTime() + HOUR).toISOString() }, "START_IN_PAST"],
      [{ scheduledStart: future(2).scheduledEnd, scheduledEnd: future(2).scheduledStart }, "SCHEDULE_END_NOT_AFTER_START"],
      [future(2, 15 * 24), "SCHEDULE_WINDOW_TOO_LONG"],
      [{ scheduledStart: "tomorrow", scheduledEnd: "later" }, "SCHEDULE_TIME_INVALID"],
    ]) {
      await assert.rejects(scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-a", ...input }),
        (e) => { assert.equal(e.code, code); return true; }, code);
    }
    assert.equal(await statusOf(wo), "READY_TO_DISPATCH");
  });

  await t.test("DQ-013 / DQ-007: the assignee is an eligible Employee of the Work Order's company", async () => {
    const wo = await newWo();
    for (const [employeeId, code] of [
      ["emp-ventana", "EMPLOYEE_NOT_ELIGIBLE_FOR_OPERATING_COMPANY"], ["emp-unqualified", "EMPLOYEE_NOT_ASSIGNABLE"],
      ["emp-unlinked", "EMPLOYEE_NOT_ASSIGNABLE"], ["prn-tech-a", "EMPLOYEE_NOT_FOUND"],
    ]) {
      await assert.rejects(scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId, ...future(4) }),
        (e) => { assert.equal(e.code, code, employeeId); return true; }, employeeId);
    }
    assert.equal(await statusOf(wo), "READY_TO_DISPATCH", "no refused schedule moved the Work Order");
    const r = await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-c", ...future(4) });
    assert.equal(r.assignment.assigneeEmployeeId, "emp-c", "DQ-012: a CONTRACTOR technician is schedulable");
  });

  await t.test("SCHEDULE_CONFLICT: the same Employee cannot hold two overlapping windows", async () => {
    const w = future(6);
    const first = await newWo();
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: first, employeeId: "emp-b", ...w });
    const second = await newWo();
    const overlap = { scheduledStart: new Date(Date.parse(w.scheduledStart) + HOUR).toISOString(), scheduledEnd: new Date(Date.parse(w.scheduledEnd) + HOUR).toISOString() };
    await assert.rejects(scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: second, employeeId: "emp-b", ...overlap }),
      (e) => { assert.equal(e.code, "SCHEDULE_CONFLICT"); assert.match(e.message, new RegExp(first)); return true; });
    // Back to back is not an overlap.
    const after = { scheduledStart: w.scheduledEnd, scheduledEnd: new Date(Date.parse(w.scheduledEnd) + HOUR).toISOString() };
    const r = await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: second, employeeId: "emp-b", ...after });
    assert.equal(r.transition.toStatus, "SCHEDULED");
  });

  await t.test("two concurrent schedules of one Employee into one window: exactly one wins", async () => {
    const w = future(9);
    const [x, y] = [await newWo(), await newWo()];
    const attempt = (id) => scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: id, employeeId: "emp-a", ...w })
      .then(() => "won").catch((e) => e.code);
    const outcomes = await Promise.all([attempt(x), attempt(y)]);
    assert.deepEqual(outcomes.sort(), ["SCHEDULE_CONFLICT", "won"]);
  });

  // ════════════════════ UNSCHEDULE / RESCHEDULE ════════════════════

  await t.test("UNSCHEDULE (ND-18): reason required; the placement is cleared; the technician given up is recorded", async () => {
    const wo = await newWo();
    const w = future(11);
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-a", ...w });
    await assert.rejects(scheduling.unscheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo }),
      (e) => { assert.equal(e.code, "REASON_REQUIRED"); return true; });
    const r = await scheduling.unscheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, reason: "customer closed Monday" });
    assert.deepEqual([r.transition.toStatus, r.priorAssigneeEmployeeId, r.priorScheduledStart], ["READY_TO_DISPATCH", "emp-a", w.scheduledStart]);
    const { rows } = await q(`SELECT scheduled_start, scheduled_end FROM eos_ops.work_orders WHERE id=$1`, [wo]);
    assert.deepEqual([rows[0].scheduled_start, rows[0].scheduled_end], [null, null], "indistinguishable from never scheduled");
    const ended = await q(`SELECT end_source, end_reason FROM eos_ops.work_order_assignments WHERE work_order_id=$1`, [wo]);
    assert.deepEqual(ended.rows, [{ end_source: "UNSCHEDULE", end_reason: "customer closed Monday" }]);
    const open = await q(`SELECT count(*)::int n FROM eos_ops.work_order_assignments WHERE work_order_id=$1 AND effective_to IS NULL`, [wo]);
    assert.equal(open.rows[0].n, 0);
  });

  await t.test("RESCHEDULE: reason, the stale-window check, and a technician change is a reasoned reassignment", async () => {
    const wo = await newWo();
    const w = future(13);
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-a", ...w });
    const moved = future(14);
    await assert.rejects(scheduling.rescheduleWorkOrder(deps, actor(P.dispatcher),
      { workOrderId: wo, expectedScheduledStart: moved.scheduledStart, ...moved, reason: "x" }),
    (e) => { assert.equal(e.code, "STALE_SCHEDULE"); return true; });
    const r = await scheduling.rescheduleWorkOrder(deps, actor(P.dispatcher),
      { workOrderId: wo, expectedScheduledStart: w.scheduledStart, ...moved, employeeId: "emp-b", reason: "tech A on PTO" });
    assert.equal(r.scheduledStart, moved.scheduledStart);
    assert.equal(r.assignment.outcome, "REASSIGNED");
    assert.equal(await statusOf(wo), "SCHEDULED", "reschedule is not a transition");
    const src = await q(`SELECT source, reason FROM eos_ops.work_order_assignments WHERE work_order_id=$1 AND effective_to IS NULL`, [wo]);
    assert.deepEqual(src.rows[0], { source: "RESCHEDULE", reason: "tech A on PTO" });
  });

  // ════════════════════ DISPATCH ════════════════════

  await t.test("DISPATCH: stamps dispatched_at, states the reserve boundary, and writes NO inventory", async () => {
    const wo = await newWo();
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-c", ...future(16) });
    const before = await counts();
    const r = await scheduling.dispatchWorkOrder(deps, actor(P.dispatcherBaseline), { workOrderId: wo });
    assert.equal(r.transition.toStatus, "DISPATCHED", "dispatch uses the dispatcher's EXISTING baseline grant");
    assert.match(r.inventoryBoundary, /^RESERVE_NOT_APPLIED/);
    assert.equal((await counts()).inv, before.inv, "no reservation was written");
    const { rows } = await q(`SELECT dispatched_at FROM eos_ops.work_orders WHERE id=$1`, [wo]);
    assert.ok(rows[0].dispatched_at);
  });

  await t.test("DISPATCH to someone else (H20) requires a reason and is recorded as DISPATCH_REASSIGN", async () => {
    const wo = await newWo();
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-a", ...future(18) });
    await assert.rejects(scheduling.dispatchWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-b" }),
      (e) => { assert.equal(e.code, "REASSIGN_REASON_REQUIRED"); return true; });
    assert.equal(await statusOf(wo), "SCHEDULED");
    const r = await scheduling.dispatchWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-b", reassignReason: "closer" });
    assert.equal(r.assigneeEmployeeId, "emp-b");
    assert.equal(r.reassignment.outcome, "REASSIGNED");
  });

  await t.test("DOUBLE_BOOKED: an Employee on an active job cannot be dispatched to another", async () => {
    const busy = await q(`SELECT w.id FROM eos_ops.work_orders w JOIN eos_ops.work_order_assignments a ON a.work_order_id=w.id AND a.effective_to IS NULL
                           WHERE a.assignee_employee_id='emp-b' AND w.status='DISPATCHED'`);
    assert.equal(busy.rows.length, 1);
    const wo = await newWo();
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-b", ...future(20) });
    await assert.rejects(scheduling.dispatchWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo }),
      (e) => { assert.equal(e.code, "DOUBLE_BOOKED"); assert.match(e.message, new RegExp(busy.rows[0].id)); return true; });
  });

  await t.test("DQ-014: dispatch re-checks the scheduled Employee's eligibility NOW", async () => {
    await employee("emp-leaver"); await principal("prn-leaver"); await link("prn-leaver", "emp-leaver");
    await configureHours("emp-leaver");
    const wo = await newWo();
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-leaver", ...future(22) });
    await q(`UPDATE eos_workforce.employees SET employment_status='TERMINATED' WHERE id='emp-leaver'`);
    await assert.rejects(scheduling.dispatchWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo }),
      (e) => { assert.equal(e.code, "EMPLOYEE_NOT_ASSIGNABLE"); return true; });
  });

  // ════════════════════ TECHNICIAN RUNTIME ════════════════════

  const dispatched = async (employeeId, days) => {
    const wo = await newWo();
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId, ...future(days) });
    await scheduling.dispatchWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo });
    return wo;
  };
  const step = (p, wo, from, to) => lifecycle.transitionWorkOrder(deps, actor(p), { workOrderId: wo, expectedStatus: from, toStatus: to });

  let journeyWo;
  await t.test("the technician runtime is OWN-ASSIGNMENT: another technician is NOT_ASSIGNED", async () => {
    await q(`UPDATE eos_ops.work_orders SET status='CANCELLED' WHERE status IN ('DISPATCHED','SCHEDULED')`);
    journeyWo = await dispatched("emp-a", 24);
    await assert.rejects(step(P.techB, journeyWo, "DISPATCHED", "ACCEPTED"), (e) => { assert.equal(e.code, "NOT_ASSIGNED"); return true; });
    await assert.rejects(step(P.parts, journeyWo, "DISPATCHED", "ACCEPTED"), (e) => { assert.equal(e.code, "EMPLOYEE_LINK_REQUIRED"); return true; },
      "partsAssociate holds workOrder.transition, and before the cutover could accept any job");
    assert.equal(await statusOf(journeyWo), "DISPATCHED");
  });

  await t.test("accept -> travel -> arrive -> start: each edge stamps its timestamp, by the assigned technician", async () => {
    for (const [from, to] of [["DISPATCHED", "ACCEPTED"], ["ACCEPTED", "EN_ROUTE"], ["EN_ROUTE", "ARRIVED"], ["ARRIVED", "WORK_IN_PROGRESS"]]) {
      const r = await step(P.techABaseline, journeyWo, from, to);
      assert.equal(r.toStatus, to);
    }
    const { rows } = await q(`SELECT accepted_at, en_route_at, arrived_at, work_started_at FROM eos_ops.work_orders WHERE id=$1`, [journeyWo]);
    for (const [k, v] of Object.entries(rows[0])) assert.ok(v, `${k} stamped`);
  });

  // ════════════════════ EXECUTION FACTS ════════════════════

  await t.test("EXECUTION: refused without workOrder.execution.record, and refused to another technician", async () => {
    const input = { workOrderId: journeyWo, idempotencyKey: "k0", note: "on site" };
    await assert.rejects(execution.recordWorkOrderExecution(deps, actor(P.techABaseline), input),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
    await assert.rejects(execution.recordWorkOrderExecution(deps, actor(P.techB), input),
      (e) => { assert.equal(e.code, "NOT_ASSIGNED"); return true; });
  });

  await t.test("EXECUTION: planned vs actual, clamped to [0, planned], idempotent, and moves NO stock", async () => {
    await q(`INSERT INTO eos_ops.work_order_parts_plan (tenant_id, work_order_id, part_id, qty_planned, planned_by, updated_by)
             VALUES ($1,$2,'part-filter',3,'prn-dispatcher','prn-dispatcher')`, [T, journeyWo]);
    const before = await counts();
    const r = await execution.recordWorkOrderExecution(deps, actor(P.techA),
      { workOrderId: journeyWo, idempotencyKey: "k1", partUsage: [{ partId: "part-filter", qtyDelta: 5 }], note: "replaced filter" });
    assert.equal(r.outcome, "RECORDED");
    assert.deepEqual(r.usage[0], { partId: "part-filter", requestedDelta: 5, appliedDelta: 3, qtyUsed: 3, qtyPlanned: 3 });
    assert.equal(r.inventoryBoundary, "NO_STOCK_MOVEMENT");
    assert.equal((await counts()).inv, before.inv);
    const replay = await execution.recordWorkOrderExecution(deps, actor(P.techA),
      { workOrderId: journeyWo, idempotencyKey: "k1", partUsage: [{ partId: "part-filter", qtyDelta: 5 }], note: "replaced filter" });
    assert.equal(replay.outcome, "REPLAYED");
    assert.equal(replay.usage[0].qtyUsed, 3, "a replay applies nothing twice");
    await assert.rejects(execution.recordWorkOrderExecution(deps, actor(P.techA),
      { workOrderId: journeyWo, idempotencyKey: "k1", partUsage: [{ partId: "part-filter", qtyDelta: 1 }], note: "replaced filter" }),
    (e) => { assert.equal(e.code, "IDEMPOTENCY_KEY_REUSED"); return true; });
    const down = await execution.recordWorkOrderExecution(deps, actor(P.techA),
      { workOrderId: journeyWo, idempotencyKey: "k2", partUsage: [{ partId: "part-filter", qtyDelta: -1 }] });
    assert.equal(down.usage[0].qtyUsed, 2, "a correction is a negative delta, never an edit");
    await assert.rejects(execution.recordWorkOrderExecution(deps, actor(P.techA),
      { workOrderId: journeyWo, idempotencyKey: "k3", partUsage: [{ partId: "part-unplanned", qtyDelta: 1 }] }),
    (e) => { assert.equal(e.code, "PART_NOT_PLANNED"); return true; });
    const view = await execution.readWorkOrderExecution(pool, T, journeyWo);
    assert.deepEqual(view.parts, [{ partId: "part-filter", qtyPlanned: 3, qtyUsed: 2 }]);
    assert.deepEqual(view.notes.map((n) => n.note), ["replaced filter"]);
  });

  await t.test("EXECUTION history is APPEND-ONLY at the database", async () => {
    await assert.rejects(q(`UPDATE eos_ops.work_order_execution_records SET applied_delta = 0`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_ops.work_order_execution_records`), /append-only/);
  });

  await t.test("a Part with recorded actuals cannot be un-planned (Firebase refused removing a qtyUsed > 0 row)", async () => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ('prn-planner','sub-planner','eos','active')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ('mem-planner',$1,'prn-planner','active')`, [T]);
    await assert.rejects(partsPlan.setPartsPlan(deps, { tenantId: T, principalId: "prn-planner", capabilities: new Set(["workOrder.parts.plan"]) },
      { workOrderId: journeyWo, plan: [] }),
    (e) => { assert.equal(e.code, "USED_PART_REMOVAL"); return true; });
  });

  // ════════════════════ COMPLETE (DQ-015) / CLOSE / CANCEL ════════════════════

  await t.test("COMPLETE by the assigned technician stamps completed_at and states the consume boundary; a replay is a conflict", async () => {
    await assert.rejects(scheduling.completeWorkOrder(deps, actor(P.techB), { workOrderId: journeyWo }),
      (e) => { assert.equal(e.code, "NOT_ASSIGNED"); return true; });
    const r = await scheduling.completeWorkOrder(deps, actor(P.techABaseline), { workOrderId: journeyWo, note: "done" });
    assert.equal(r.transition.toStatus, "COMPLETED");
    assert.match(r.inventoryBoundary, /^CONSUME_NOT_APPLIED/);
    await assert.rejects(scheduling.completeWorkOrder(deps, actor(P.techABaseline), { workOrderId: journeyWo }),
      (e) => { assert.equal(e.code, "STALE_WORK_ORDER_STATE"); assert.equal(e.category, "CONFLICT"); return true; },
      "COMPLETED is one-way: idempotent by construction");
    await assert.rejects(execution.recordWorkOrderExecution(deps, actor(P.techA), { workOrderId: journeyWo, idempotencyKey: "late", note: "x" }),
      (e) => { assert.equal(e.code, "WORK_ORDER_TERMINAL"); return true; });
  });

  await t.test("DQ-015: a Work Order whose Sales Order PostgreSQL Commercial cannot prove is NOT completed (fails safely)", async () => {
    const wo = await newWo("READY_TO_DISPATCH", { salesOrderId: "so-1" });
    await scheduling.scheduleWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo, employeeId: "emp-a", ...future(26) });
    await scheduling.dispatchWorkOrder(deps, actor(P.dispatcher), { workOrderId: wo });
    for (const [from, to] of [["DISPATCHED", "ACCEPTED"], ["ACCEPTED", "EN_ROUTE"], ["EN_ROUTE", "ARRIVED"], ["ARRIVED", "WORK_IN_PROGRESS"]]) {
      await step(P.techABaseline, wo, from, to);
    }
    await assert.rejects(scheduling.completeWorkOrder(deps, actor(P.techABaseline), { workOrderId: wo }),
      // DECISIONS #195: completion now records the Sales Order fulfillment in its own transaction; a Sales Order that does not
      // exist in PostgreSQL Commercial refuses the whole completion rather than completing with a dangling link.
      (e) => { assert.equal(e.code, "SALES_ORDER_NOT_FOUND"); assert.equal(e.category, "NOT_FOUND"); return true; });
    assert.equal(await statusOf(wo), "WORK_IN_PROGRESS", "nothing moved");
    // The office cancels the held job, which frees the technician (a cancelled job is not an occupying one).
    await step(P.dispatcherBaseline, wo, "WORK_IN_PROGRESS", "CANCELLED");
  });

  await t.test("CLOSE requires workOrder.lifecycle.close (granted to nobody); CANCEL uses the existing grant", async () => {
    await assert.rejects(step(P.dispatcherBaseline, journeyWo, "COMPLETED", "CLOSED"), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
    assert.equal((await step(P.dispatcher, journeyWo, "COMPLETED", "CLOSED")).toStatus, "CLOSED");
    const wo = await newWo();
    const r = await step(P.dispatcherBaseline, wo, "READY_TO_DISPATCH", "CANCELLED");
    assert.match(r.inventoryBoundary, /^RELEASE_NOT_APPLIED/);
  });

  // ════════════════════ READS ════════════════════

  await t.test("READ detail: the Work Order with its site, assignee, execution and history -- behind the record gate", async () => {
    const d = await queries.readWorkOrderDetail({ pool, reader }, operational(P.dispatcher), { workOrderId: journeyWo });
    assert.equal(d.status, "CLOSED");
    assert.equal(d.customerName, "Harbor Diner");
    assert.equal(d.location.street, "1 Pier Rd");
    assert.equal(d.assigneeEmployeeId, "emp-a");
    assert.deepEqual(d.execution.parts, [{ partId: "part-filter", qtyPlanned: 3, qtyUsed: 2 }]);
    assert.deepEqual(d.transitions.map((x) => x.toStatus), ["SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED"]);
    const nobody = { principalId: "prn-parts", caps: new Set() };
    await assert.rejects(queries.readWorkOrderDetail({ pool, reader }, operational(nobody), { workOrderId: journeyWo }),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
  });

  await t.test("DQ-016: with the technician grant conditioned to Employee + RECORD_ASSIGNMENT, a technician reads only their own", async () => {
    // The technician grant as Administration would condition it (setGrantCondition): Employee + RECORD_ASSIGNMENT.
    const DQ016 = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey: "workOrder.record.read",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
    const conditioned = (p) => operational(p, DQ016);
    const own = await dispatched("emp-a", 30);
    const theirs = await dispatched("emp-b", 31);
    const mine = await queries.listMyAssignedWorkOrders({ pool, reader }, conditioned(P.techA), {});
    assert.equal(mine.employeeId, "emp-a");
    assert.ok(mine.items.some((w) => w.workOrderId === own));
    assert.equal(mine.items.some((w) => w.workOrderId === theirs), false);
    assert.equal((await queries.readWorkOrderDetail({ pool, reader }, conditioned(P.techA), { workOrderId: own })).workOrderId, own);
    await assert.rejects(queries.readWorkOrderDetail({ pool, reader }, conditioned(P.techA), { workOrderId: theirs }),
      (e) => { assert.equal(e.category, "FORBIDDEN"); return true; });
    await assert.rejects(queries.listWorkOrders(deps, conditioned(P.techA), {}),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; }, "a conditioned holder does not see the queue");
  });

  await t.test("READ list and the technician picker (DQ-013: the Work Order's company only)", async () => {
    const list = await queries.listWorkOrders(deps, actor(P.dispatcher), { statuses: ["DISPATCHED"] });
    assert.ok(list.items.length >= 2 && list.items.every((w) => w.status === "DISPATCHED"));
    const wo = await newWo();
    const techs = await queries.listWorkOrderTechnicians(deps, actor(P.dispatcherBaseline), { workOrderId: wo });
    const ids = techs.items.map((e) => e.employeeId).sort();
    assert.equal(ids.includes("emp-ventana"), false);
    assert.equal(ids.includes("emp-unqualified") || ids.includes("emp-unlinked") || ids.includes("emp-leaver"), false);
    assert.ok(ids.includes("emp-a") && ids.includes("emp-c"));
    await assert.rejects(queries.listWorkOrderTechnicians(deps, actor(P.techA), { workOrderId: wo }),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
  });
});

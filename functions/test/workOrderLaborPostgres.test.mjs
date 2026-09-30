// WORK ORDER LABOR -- the ported Technician labor behavior, in the governed PostgreSQL Work Order domain (Owner
// DECISION 7, 2026-09-30), against a real postgres:16.
//
// Recording labor reuses workOrder.execution.record + RECORD_ASSIGNMENT; correcting it is workOrder.labor.correct,
// registered by 1764330000000 with NO grant. Both are stated EXPLICITLY below as the pending Administration decisions
// they are, and a baseline-only persona is proven refused first.
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

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const labor = require("../lib/eosOps/workOrderLabor.js");
const ops = require("../lib/eosOps/workOrderOperations.js");
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const capsOf = (...roleKeys) => new Set(BASELINE.grants.filter((g) => roleKeys.includes(g.roleKey)).map((g) => g.capabilityKey));
const MIGRATION = "migrations/1764330000000_work-order-labor.sql";

// ════════════════════ OFFLINE ════════════════════

test("labor is wired to the reserved operation names, and the module holds no Firebase or legacy identity", () => {
  assert.equal(ops.EOS_WORK_ORDER_OPERATIONS.readWorkOrderLabor, labor.readWorkOrderLabor);
  assert.equal(ops.EOS_WORK_ORDER_OPERATIONS.recordWorkOrderLabor, labor.recordWorkOrderLabor);
  assert.ok(ops.WORK_ORDER_READ_OPERATIONS.includes("readWorkOrderLabor"));
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = strip(readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderLabor.ts"), "utf8"));
  assert.equal(/firebase-admin|firebase-functions|getFirestore|onCall|fieldops_wos|work_order_labor_entries"\)|\.collection\(/.test(src), false);
  assert.equal(/caller\.role|getCallerContext|customClaims|operationalRoles|\.technicianId/.test(src), false, "no Firebase technician identity");
  assert.equal(/inventory_commitments|reserveParts|consumeParts|\b(rate|cost|billable)\b/i.test(src), false,
    "labor records work performed only: no stock effect, no rate, no cost");
});

test("the migration: one capability defined with no grant, an append-only table, a guarded Down", () => {
  const sql = readFileSync(resolve(FUNCTIONS_DIR, MIGRATION), "utf8");
  const [up, down] = sql.split("-- Down Migration");
  assert.match(up, /'workOrder\.labor\.correct'/);
  assert.equal(/INSERT INTO (eos_policy\.)?(role_capabilities|principal_capabilities)/i.test(up), false, "definition is not grant");
  assert.equal(BASELINE.grants.some((g) => g.capabilityKey === "workOrder.labor.correct"), false);
  assert.match(up, /BEFORE UPDATE OR DELETE ON work_order_labor_entries/);
  assert.match(down, /refuses to reverse -- workOrder\.labor\.correct is held by/);
  assert.match(down, /labor entr\(ies\) are field history/);
});

test("validation: the Firebase shapes, bounds and refusals are kept", () => {
  const base = { workOrderId: "wo-1", idempotencyKey: "k", laborType: "ONSITE" };
  const code = (input) => { try { labor.validateLaborRequest(input); return "OK"; } catch (e) { return e.code; } };
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 90, workDate: "2026-09-30" }), "OK");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 0, workDate: "2026-09-30" }), "DURATION_INVALID");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 961, workDate: "2026-09-30" }), "DURATION_INVALID");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 60, workDate: "2026-02-30" }), "DURATION_INVALID");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 60, workDate: "2026-09-30", startedAtMillis: 1 }), "DURATION_INVALID");
  assert.equal(code({ ...base, entryKind: "INTERVAL", startedAtMillis: 1000, endedAtMillis: 1000 }), "INTERVAL_INVALID");
  assert.equal(code({ ...base, entryKind: "INTERVAL", startedAtMillis: 0, endedAtMillis: 3_600_000, durationMinutes: 60 }), "INTERVAL_INVALID");
  assert.equal(code({ ...base, laborType: "SHOP", entryKind: "DURATION", durationMinutes: 60, workDate: "2026-09-30" }), "REQUEST_INVALID");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 60, workDate: "2026-09-30", technicianId: "t1" }), "REQUEST_INVALID",
    "whose time it is is never named in the payload");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 60, workDate: "2026-09-30", employeeId: "e1" }), "REQUEST_INVALID");
  assert.equal(code({ ...base, entryKind: "DURATION", durationMinutes: 60, workDate: "2026-09-30", rate: 50 }), "INPUT_FIELD_NOT_ACCEPTED");
  const iv = labor.validateLaborRequest({ ...base, entryKind: "INTERVAL", startedAtMillis: Date.UTC(2026, 8, 30, 14), endedAtMillis: Date.UTC(2026, 8, 30, 15, 30) });
  assert.deepEqual([iv.durationMinutes, iv.workDate], [90, "2026-09-30"], "an INTERVAL derives its duration and UTC work date");
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wolabor";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("Work Order labor", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wolab_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
             VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','labor fixture')`, [`elig-${eid}`, T, eid]);
  };
  const link = (pid, eid) => q(
    `INSERT INTO eos_policy.employee_principal_links
       (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
     VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','labor fixture')`, [`lnk-${pid}`, T, pid, eid]);
  for (const p of ["prn-dispatcher", "prn-svcmgr", "prn-tech-a", "prn-tech-b"]) await principal(p);
  await employee("emp-a"); await link("prn-tech-a", "emp-a");
  await employee("emp-b"); await link("prn-tech-b", "emp-b");
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_city,created_by,updated_by)
           VALUES ('loc-1',$1,'acct-1','Harbor Diner Main','Portsmouth','f','f')`, [T]);

  const OFFICE = ["workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.lifecycle.close"];
  const P = Object.freeze({
    dispatcher: { principalId: "prn-dispatcher", caps: new Set([...capsOf("dispatcher"), ...OFFICE]) },
    serviceManager: { principalId: "prn-svcmgr", caps: new Set([...capsOf("fieldManager"), "workOrder.labor.correct"]) },
    serviceManagerBaseline: { principalId: "prn-svcmgr", caps: capsOf("fieldManager") },
    techABaseline: { principalId: "prn-tech-a", caps: capsOf("technician") },
    techA: { principalId: "prn-tech-a", caps: new Set([...capsOf("technician"), "workOrder.execution.record"]) },
    techB: { principalId: "prn-tech-b", caps: new Set([...capsOf("technician"), "workOrder.execution.record"]) },
  });
  // The technician's record read as Administration conditions it (DQ-016): Employee + RECORD_ASSIGNMENT.
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
  const record = (c, input) => labor.recordWorkOrderLabor(deps, c, input);
  const read = (c, workOrderId) => labor.readWorkOrderLabor(deps, c, { workOrderId });
  const count = async () => (await q(`SELECT count(*)::int n FROM eos_ops.work_order_labor_entries`)).rows[0].n;

  let seq = 0;
  const newWo = async () => {
    const id = `wo-${++seq}`;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
                provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,'taylor',$3,'READY_TO_DISPATCH','SERVICE_CALL',2,'acct-1','loc-1','NATIVE','prn-dispatcher',now(),now())`,
      [id, T, `WO-2032-${String(seq).padStart(6, "0")}`]);
    return id;
  };
  const future = (days) => { const s = Date.now() + days * DAY; return { scheduledStart: new Date(s).toISOString(), scheduledEnd: new Date(s + 2 * HOUR).toISOString() }; };
  const inProgress = async (employeeId, days) => {
    const wo = await newWo();
    const d = { pool };
    await scheduling.scheduleWorkOrder(d, caller(P.dispatcher).actor, { workOrderId: wo, employeeId, ...future(days) });
    await scheduling.dispatchWorkOrder(d, caller(P.dispatcher).actor, { workOrderId: wo });
    const techP = employeeId === "emp-a" ? P.techABaseline : P.techB;
    for (const [from, to] of [["DISPATCHED", "ACCEPTED"], ["ACCEPTED", "EN_ROUTE"], ["EN_ROUTE", "ARRIVED"], ["ARRIVED", "WORK_IN_PROGRESS"]]) {
      await lifecycle.transitionWorkOrder(d, caller(techP).actor, { workOrderId: wo, expectedStatus: from, toStatus: to });
    }
    return wo;
  };
  const duration = (wo, key, minutes = 90, extra = {}) =>
    ({ workOrderId: wo, idempotencyKey: key, laborType: "ONSITE", entryKind: "DURATION", durationMinutes: minutes, workDate: "2026-09-30", ...extra });
  const interval = (wo, key, startH, endH, extra = {}) =>
    ({ workOrderId: wo, idempotencyKey: key, laborType: "TRAVEL", entryKind: "INTERVAL",
      startedAtMillis: Date.UTC(2026, 8, 30, startH), endedAtMillis: Date.UTC(2026, 8, 30, endH), ...extra });

  const woA = await inProgress("emp-a", 2);
  const woB = await inProgress("emp-b", 3);

  await t.test("RECORD is refused without workOrder.execution.record, and to a technician not assigned", async () => {
    await assert.rejects(record(tech(P.techABaseline), duration(woA, "r0")), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
    await assert.rejects(record(tech(P.techB), duration(woA, "r0")), (e) => { assert.equal(e.code, "NOT_ASSIGNED"); return true; });
    await assert.rejects(record(caller(P.dispatcher), duration(woA, "r0")), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; },
      "the office does not record a technician's time -- recording is for yourself");
    assert.equal(await count(), 0);
  });

  let firstId;
  await t.test("RECORD: the assigned technician records their OWN time; the Employee is the subject, the Principal the recorder", async () => {
    const r = await record(tech(P.techA), duration(woA, "r1", 90, { notes: "replaced contactor" }));
    assert.equal(r.outcome, "RECORDED");
    assert.deepEqual([r.employeeId, r.durationMinutes, r.laborType, r.entryKind, r.workDate, r.action], ["emp-a", 90, "ONSITE", "DURATION", "2026-09-30", "RECORD"]);
    firstId = r.laborEntryId;
    const row = (await q(`SELECT employee_id, recorded_by_principal_id, started_at FROM eos_ops.work_order_labor_entries WHERE id=$1`, [firstId])).rows[0];
    assert.deepEqual([row.employee_id, row.recorded_by_principal_id, row.started_at], ["emp-a", "prn-tech-a", null],
      "a DURATION entry invents no clock position");
  });

  await t.test("IDEMPOTENT: the same key and request replays; a different request under the key refuses", async () => {
    const before = await count();
    const replay = await record(tech(P.techA), duration(woA, "r1", 90, { notes: "re-typed note" }));
    assert.deepEqual([replay.outcome, replay.laborEntryId], ["REPLAYED", firstId]);
    await assert.rejects(record(tech(P.techA), duration(woA, "r1", 120)), (e) => { assert.equal(e.code, "IDEMPOTENCY_CONFLICT"); assert.equal(e.category, "CONFLICT"); return true; });
    assert.equal(await count(), before, "neither wrote a row");
  });

  await t.test("OVERLAP: an INTERVAL cannot overlap the same Employee's ACTIVE interval, even across Work Orders", async () => {
    await record(tech(P.techA), interval(woA, "i1", 9, 10));
    const woA2 = await inProgress("emp-a", 4).catch(() => null);
    // emp-a is on an active job, so a second in-progress Work Order is DOUBLE_BOOKED; overlap is proven on woA.
    assert.equal(woA2, null);
    await assert.rejects(record(tech(P.techA), interval(woA, "i2", 9, 11)), (e) => { assert.equal(e.code, "OVERLAPPING_ENTRY"); return true; });
    assert.equal((await record(tech(P.techA), interval(woA, "i3", 10, 11))).outcome, "RECORDED", "back to back is not an overlap");
    assert.equal((await record(tech(P.techB), interval(woB, "i1", 9, 10))).outcome, "RECORDED", "another Employee's time is not an overlap");
    assert.equal((await record(tech(P.techA), duration(woA, "d-any", 30))).outcome, "RECORDED", "a DURATION cannot be overlap-checked, and is not");
  });

  await t.test("EXECUTION STATES: new labor only while the job is being executed", async () => {
    await scheduling.completeWorkOrder({ pool }, caller(P.techABaseline).actor, { workOrderId: woA, note: "done" });
    await assert.rejects(record(tech(P.techA), duration(woA, "late")), (e) => { assert.equal(e.code, "WORK_ORDER_STATE_INVALID"); return true; });
    const replay = await record(tech(P.techA), duration(woA, "r1", 90));
    assert.equal(replay.outcome, "REPLAYED", "a retry of an entry that landed before completion still replays");
  });

  await t.test("CORRECT: a separate authority; a replacement is appended and the original is REVERSED, never edited", async () => {
    const fix = duration(woA, "c1", 60, { correctsLaborEntryId: firstId });
    await assert.rejects(record(tech(P.techA), fix), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; },
      "a technician does not correct -- not even their own entry (Firebase parity)");
    await assert.rejects(record(caller(P.serviceManagerBaseline), fix), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
    const r = await record(caller(P.serviceManager), fix);
    assert.deepEqual([r.outcome, r.action, r.employeeId, r.correctsLaborEntryId, r.durationMinutes], ["RECORDED", "CORRECT", "emp-a", firstId, 60],
      "the replacement keeps the ORIGINAL Employee, on a COMPLETED Work Order");
    const replay = await record(caller(P.serviceManager), fix);
    assert.deepEqual([replay.outcome, replay.laborEntryId], ["REPLAYED", r.laborEntryId]);
    await assert.rejects(record(caller(P.serviceManager), duration(woA, "c2", 45, { correctsLaborEntryId: firstId })),
      (e) => { assert.equal(e.code, "ENTRY_ALREADY_REVERSED"); return true; });
    const chained = await record(caller(P.serviceManager), duration(woA, "c3", 45, { correctsLaborEntryId: r.laborEntryId }));
    assert.equal(chained.outcome, "RECORDED", "a correction of a correction chains forward");
    await assert.rejects(record(caller(P.serviceManager), duration(woB, "c4", 45, { correctsLaborEntryId: chained.laborEntryId })),
      (e) => { assert.equal(e.code, "ENTRY_NOT_FOUND"); return true; }, "a correction names an entry OF the Work Order it is on");
    const original = (await q(`SELECT duration_minutes FROM eos_ops.work_order_labor_entries WHERE id=$1`, [firstId])).rows[0];
    assert.equal(original.duration_minutes, 90, "the original is untouched");
  });

  await t.test("READ: entries with derived status and totals, behind the entitled Work Order read", async () => {
    const view = await read(caller(P.dispatcher), woA);
    assert.equal(view.status, "ready");
    const byId = new Map(view.entries.map((e) => [e.laborEntryId, e]));
    assert.equal(byId.get(firstId).status, "REVERSED");
    assert.ok(byId.get(firstId).reversedByLaborEntryId);
    assert.equal(view.entries.filter((e) => e.status === "ACTIVE").length, view.totals.activeEntries);
    // ACTIVE: interval 9-10 (60 TRAVEL), interval 10-11 (60 TRAVEL), duration 30 ONSITE, the chained correction 45 ONSITE.
    assert.deepEqual(view.totals, { totalMinutes: 195, onsiteMinutes: 75, travelMinutes: 120, activeEntries: 4, reversedEntries: 2 });
    assert.equal(byId.get(firstId).employeeDisplayName, "Tech emp-a");
    assert.deepEqual(view.laborTypes, ["ONSITE", "TRAVEL"]);
    assert.equal(view.maxMinutes, 960);
    assert.deepEqual([view.canRecord, view.canCorrect], [false, false], "the dispatcher neither records nor corrects");
    assert.equal((await read(caller(P.serviceManager), woA)).canCorrect, true);
  });

  await t.test("READ: the assigned technician reads their own job's time; another technician is refused", async () => {
    const own = await read(tech(P.techB), woB);
    assert.equal(own.canRecord, true);
    assert.equal(own.entries.length, 1);
    await assert.rejects(read(tech(P.techB), woA), (e) => { assert.equal(e.category, "FORBIDDEN"); return true; });
    await assert.rejects(read(caller({ principalId: "prn-tech-b", caps: new Set() }), woB),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
  });

  await t.test("APPEND-ONLY at the database: no UPDATE, no DELETE", async () => {
    await assert.rejects(q(`UPDATE eos_ops.work_order_labor_entries SET duration_minutes = 1`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_ops.work_order_labor_entries`), /append-only/);
    await assert.rejects(q(`INSERT INTO eos_ops.work_order_labor_entries (id,tenant_id,work_order_id,employee_id,recorded_by_principal_id,labor_type,
      entry_kind,duration_minutes,work_date,idempotency_key,request_fingerprint,recorded_at) VALUES
      ('x',$1,$2,'emp-a','prn-tech-a','ONSITE','DURATION',961,'2026-09-30','raw','f',now())`, [T, woB]), /wo_labor_duration_bounded/);
  });

  await t.test("the Down refuses while labor exists (field history)", async () => {
    const sql = readFileSync(resolve(FUNCTIONS_DIR, MIGRATION), "utf8").split("-- Down Migration")[1];
    await assert.rejects(q(sql), /refuses to reverse/);
    assert.ok(await count() > 0);
  });
});

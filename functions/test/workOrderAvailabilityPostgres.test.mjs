// TECHNICIAN AVAILABILITY -- the governed PostgreSQL availability model (Owner ruling DECISION 5, 2026-09-30:
// TECHNICIAN AVAILABILITY MODEL APPROVED), against a real postgres:16.
//
// Proves: working hours by weekday in an IANA zone (DST-safe), effective date ranges with close-only history,
// blocked periods, operating-company applicability, and that a placement REFUSES -- AVAILABILITY_NOT_CONFIGURED,
// OUTSIDE_WORKING_HOURS (superseding the Firebase ND-20 warning), TECHNICIAN_UNAVAILABLE -- while the existing
// SCHEDULE_CONFLICT still refuses; the self-scheduling foundation slot query (horizon / earliest bounds, job-type
// seam); the capability boundary; and that the history is append / close-only AT THE DATABASE.
//
// The clock is INJECTED (deps.now), ticking one second per read, so every date below is fixed and the DST cases
// are real calendar dates (US DST ends Sunday 2030-11-03).
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const availability = require("../lib/eosOps/workOrderAvailability.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");
const operations = require("../lib/eosOps/workOrderOperations.js");
const create = require("../lib/eosOps/workOrderCreateCommand.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const MIGRATION = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1764320000000_technician-availability.sql"), "utf8");

// ════════════════════ OFFLINE ════════════════════

test("DECISION 5 registers NO capability and NO grant: availability is governed by workOrder.lifecycle.schedule", () => {
  const up = MIGRATION.split("-- Down Migration")[0].replace(/--.*$/gm, "");
  assert.equal(/INSERT INTO\s+(eos_policy\.)?capabilities/i.test(up), false);
  assert.equal(/role_capabilities/i.test(up), false);
  assert.match(MIGRATION, /-- Down Migration[\s\S]*RAISE EXCEPTION/, "the down migration refuses while history exists");
});

test("the five operations are on the Work Order route; the two reads are read operations; no customer route", () => {
  for (const name of ["readTechnicianAvailability", "setTechnicianWorkingHours", "recordTechnicianUnavailability",
    "endTechnicianUnavailability", "findAvailableTechnicianSlots"]) {
    assert.equal(operations.EOS_WORK_ORDER_OPERATIONS[name], availability[name], name);
  }
  assert.ok(operations.WORK_ORDER_READ_OPERATIONS.includes("readTechnicianAvailability"));
  assert.ok(operations.WORK_ORDER_READ_OPERATIONS.includes("findAvailableTechnicianSlots"));
  const http = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/eosOpsHttp.ts"), "utf8");
  assert.equal(/customer[-_]?(self[-_]?)?schedul/i.test(http), false, "no customer-facing scheduling route");
});

test("job type compatibility is ONE explicit table covering every native Work Order type", () => {
  assert.deepEqual(Object.keys(availability.QUALIFICATION_BY_WORK_ORDER_TYPE).sort(), [...create.NATIVE_WORK_ORDER_TYPES].sort());
  assert.ok(Object.values(availability.QUALIFICATION_BY_WORK_ORDER_TYPE).every((q) => q === "SERVICE_TECHNICIAN"));
});

test("the calendar is DST-safe: 08:00 local is a different UTC instant either side of the November transition", () => {
  assert.equal(new Date(availability.zonedInstant("2030-10-28", 8 * 60, "America/New_York")).toISOString(), "2030-10-28T12:00:00.000Z");
  assert.equal(new Date(availability.zonedInstant("2030-11-04", 8 * 60, "America/New_York")).toISOString(), "2030-11-04T13:00:00.000Z");
  // The transition day itself is 25 hours long.
  const day = availability.zonedInstant("2030-11-04", 0, "America/New_York") - availability.zonedInstant("2030-11-03", 0, "America/New_York");
  assert.equal(day, 25 * 3_600_000);
  assert.equal(availability.isValidTimeZone("America/Phoenix"), true);
  assert.equal(availability.isValidTimeZone("Mars/Olympus"), false);
  assert.equal(availability.isValidTimeZone("+05:00"), false);
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-woavail";
const NOW = Date.parse("2030-10-01T12:00:00Z"); // a Tuesday
const Z = (s) => new Date(s).toISOString();
const WEEKDAYS = (start, end) => Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start, end }]]));

test("technician availability", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `woavail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (...args) => execFileSync(process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  migrate("up");
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$3,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, company, key]);
  }
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'eos','active')`, [pid, `sub-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  const employee = async (eid, { company = "taylor" } = {}) => {
    await principal(`prn-${eid}`);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE',$3,$1,$4)`, [eid, T, company, `Tech ${eid}`]);
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
             VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','availability fixture')`, [`elig-${eid}`, T, eid]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','availability fixture')`, [`lnk-${eid}`, T, `prn-${eid}`, eid, company]);
  };
  for (const p of ["prn-dispatcher", "prn-reader", "prn-nobody"]) await principal(p);
  for (const e of ["emp-ny", "emp-none", "emp-az", "emp-slot", "emp-end"]) await employee(e);
  await employee("emp-ventana", { company: "ventana" });
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,created_by,updated_by)
           VALUES ('loc-1',$1,'acct-1','Harbor Diner Main','1 Pier Rd','f','f')`, [T]);

  let tick = 0;
  const deps = { pool, now: () => new Date(NOW + (tick++) * 1000) };
  const P = Object.freeze({
    dispatcher: { tenantId: T, principalId: "prn-dispatcher",
      capabilities: new Set(["workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.transition"]) },
    reader: { tenantId: T, principalId: "prn-reader", capabilities: new Set(["workOrder.lifecycle.dispatch"]) },
    nobody: { tenantId: T, principalId: "prn-nobody", capabilities: new Set(["workOrder.record.read"]) },
  });
  const op = (name, actor, input) => availability[name](deps, { actor }, input);
  const refusedWith = (code, extra) => (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); extra?.(e); return true; };

  let seq = 0;
  const newWo = async (companyKey = "taylor") => {
    const id = `wo-${++seq}`;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
                provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,$4,$3,'READY_TO_DISPATCH','SERVICE_CALL',2,'acct-1','loc-1','NATIVE','prn-dispatcher',now(),now())`,
      [id, T, `WO-2030-${String(seq).padStart(6, "0")}`, companyKey]);
    return id;
  };
  const schedule = async (employeeId, start, end, companyKey) => {
    const wo = await newWo(companyKey);
    const r = await scheduling.scheduleWorkOrder(deps, P.dispatcher, { workOrderId: wo, employeeId, scheduledStart: Z(start), scheduledEnd: Z(end) });
    return { wo, r };
  };
  const statusOf = async (id) => (await q(`SELECT status::text AS s FROM eos_ops.work_orders WHERE id=$1`, [id])).rows[0].s;
  const check = async (employeeId, start, end, companyKey = "taylor") => {
    const client = await pool.connect();
    try {
      return await availability.checkTechnicianAvailability(client,
        { tenantId: T, employeeId, operatingCompanyKey: companyKey, start: new Date(start), end: new Date(end) });
    } finally { client.release(); }
  };

  // ════════════════════ capability ════════════════════

  await t.test("capability: writes need workOrder.lifecycle.schedule; reads accept schedule or dispatch; nothing else", async () => {
    const hours = { employeeId: "emp-ny", timeZone: "America/New_York", weeklyHours: WEEKDAYS("08:00", "17:00") };
    for (const actor of [P.reader, P.nobody]) {
      await assert.rejects(op("setTechnicianWorkingHours", actor, hours), refusedWith("CAPABILITY_MISSING"));
      await assert.rejects(op("recordTechnicianUnavailability", actor,
        { employeeId: "emp-ny", kind: "PTO", start: "2030-10-08T00:00:00Z", end: "2030-10-09T00:00:00Z" }), refusedWith("CAPABILITY_MISSING"));
      await assert.rejects(op("endTechnicianUnavailability", actor, { unavailabilityId: "tua_x", reason: "x" }), refusedWith("CAPABILITY_MISSING"));
    }
    const range = { start: "2030-10-07T00:00:00Z", end: "2030-10-08T00:00:00Z" };
    await assert.rejects(op("readTechnicianAvailability", P.nobody, range), refusedWith("CAPABILITY_MISSING"));
    await assert.rejects(op("findAvailableTechnicianSlots", P.nobody,
      { operatingCompanyId: "taylor", durationMinutes: 60, earliestDate: "2030-10-07", timeZone: "UTC" }), refusedWith("CAPABILITY_MISSING"));
    assert.ok((await op("readTechnicianAvailability", P.reader, range)).technicians.length > 0, "the dispatcher bucket reads");
    const counts = await q(`SELECT (SELECT count(*)::int FROM eos_workforce.technician_working_schedules) s,
                                   (SELECT count(*)::int FROM eos_workforce.technician_unavailability) u`);
    assert.deepEqual(counts.rows[0], { s: 0, u: 0 }, "no refused write wrote anything");
  });

  // ════════════════════ not configured ════════════════════

  await t.test("AVAILABILITY_NOT_CONFIGURED: no hours means the placement REFUSES -- never an assumed 24/7", async () => {
    const wo = await newWo();
    await assert.rejects(scheduling.scheduleWorkOrder(deps, P.dispatcher,
      { workOrderId: wo, employeeId: "emp-none", scheduledStart: "2030-10-07T14:00:00Z", scheduledEnd: "2030-10-07T15:00:00Z" }),
    refusedWith("AVAILABILITY_NOT_CONFIGURED", (e) => assert.equal(e.category, "PRECONDITION_FAILED")));
    assert.equal(await statusOf(wo), "READY_TO_DISPATCH");
    const open = await q(`SELECT count(*)::int n FROM eos_ops.work_order_assignments WHERE work_order_id=$1`, [wo]);
    assert.equal(open.rows[0].n, 0, "the refusal rolled the assignment back too");
  });

  await t.test("setTechnicianWorkingHours validates the zone, the intervals and the effective date", async () => {
    const base = { employeeId: "emp-ny", timeZone: "America/New_York", weeklyHours: WEEKDAYS("08:00", "17:00") };
    for (const [input, code] of [
      [{ ...base, timeZone: "Eastern" }, "TIME_ZONE_INVALID"],
      [{ ...base, weeklyHours: { 1: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "13:00" }] } }, "WORKING_INTERVALS_OVERLAP"],
      [{ ...base, weeklyHours: { 1: [{ start: "17:00", end: "08:00" }] } }, "WORKING_INTERVAL_INVALID"],
      [{ ...base, weeklyHours: { 7: [{ start: "08:00", end: "09:00" }] } }, "WEEKLY_HOURS_INVALID"],
      [{ ...base, weeklyHours: {} }, "WEEKLY_HOURS_EMPTY"],
      [{ ...base, effectiveFrom: "2030-09-30" }, "EFFECTIVE_FROM_IN_PAST"],
      [{ ...base, effectiveFrom: "2030-02-30" }, "EFFECTIVE_FROM_INVALID"],
      [{ ...base, employeeId: "emp-ghost" }, "EMPLOYEE_NOT_FOUND"],
      [{ ...base, operatingCompanyId: "acme" }, "OPERATING_COMPANY_NOT_GOVERNED"],
      [{ ...base, weeklyHours: null }, "REASON_REQUIRED"],
      [{ ...base, surprise: 1 }, "INPUT_FIELD_NOT_ACCEPTED"],
    ]) {
      await assert.rejects(op("setTechnicianWorkingHours", P.dispatcher, input), refusedWith(code), code);
    }
  });

  // ════════════════════ working hours ════════════════════

  await t.test("working hours: inside succeeds with NO warning; a lunch gap and a weekend REFUSE OUTSIDE_WORKING_HOURS", async () => {
    const set = await op("setTechnicianWorkingHours", P.dispatcher, {
      employeeId: "emp-ny", timeZone: "America/New_York", effectiveFrom: "2030-10-01",
      weeklyHours: Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }]])),
    });
    assert.equal(set.effectiveTo, null);
    assert.deepEqual(set.weeklyHours["1"], [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }]);
    // Monday 2030-10-07, 09:00-11:00 EDT = 13:00-15:00Z.
    const { r } = await schedule("emp-ny", "2030-10-07T13:00:00Z", "2030-10-07T15:00:00Z");
    assert.equal(r.transition.toStatus, "SCHEDULED");
    assert.deepEqual(r.warnings, [], "DECISION 5: no AVAILABILITY_NOT_MODELED, no warning");
    for (const [start, end, why] of [
      ["2030-10-07T15:30:00Z", "2030-10-07T16:30:00Z", "11:30-12:30 EDT crosses the lunch gap"],
      ["2030-10-05T14:00:00Z", "2030-10-05T15:00:00Z", "Saturday"],
      ["2030-10-07T20:30:00Z", "2030-10-07T21:30:00Z", "16:30-17:30 EDT runs past the end of the day"],
    ]) {
      const wo = await newWo();
      await assert.rejects(scheduling.scheduleWorkOrder(deps, P.dispatcher, { workOrderId: wo, employeeId: "emp-ny", scheduledStart: start, scheduledEnd: end }),
        refusedWith("OUTSIDE_WORKING_HOURS", (e) => assert.match(e.message, /DECISION 5/)), why);
      assert.equal(await statusOf(wo), "READY_TO_DISPATCH", why);
    }
  });

  await t.test("DST-safe: 08:00 New York is 12:00Z before the transition and 13:00Z after it", async () => {
    assert.deepEqual(await check("emp-ny", Date.parse("2030-10-28T12:00:00Z"), Date.parse("2030-10-28T14:00:00Z")), []);
    assert.deepEqual(await check("emp-ny", Date.parse("2030-11-04T13:00:00Z"), Date.parse("2030-11-04T15:00:00Z")), []);
    await assert.rejects(check("emp-ny", Date.parse("2030-11-04T12:00:00Z"), Date.parse("2030-11-04T14:00:00Z")),
      refusedWith("OUTSIDE_WORKING_HOURS"), "07:00 EST is before the working day");
  });

  await t.test("effective ranges: a new schedule ENDS the open one at its date; history keeps both; a not-yet-effective one is voided", async () => {
    const later = await op("setTechnicianWorkingHours", P.dispatcher, {
      employeeId: "emp-ny", timeZone: "America/New_York", effectiveFrom: "2030-10-21", weeklyHours: WEEKDAYS("10:00", "18:00"),
      reason: "later shift from the 21st",
    });
    assert.equal(later.endedScheduleIds.length, 1);
    const old = await q(`SELECT to_char(effective_to,'YYYY-MM-DD') AS t, ended_by_principal_id, end_reason
                           FROM eos_workforce.technician_working_schedules WHERE id=$1`, [later.endedScheduleIds[0]]);
    assert.deepEqual(old.rows[0], { t: "2030-10-21", ended_by_principal_id: "prn-dispatcher", end_reason: "later shift from the 21st" });
    assert.deepEqual(await check("emp-ny", Date.parse("2030-10-14T12:30:00Z"), Date.parse("2030-10-14T13:30:00Z")), [], "08:30 EDT on the 14th: old hours");
    await assert.rejects(check("emp-ny", Date.parse("2030-10-21T12:30:00Z"), Date.parse("2030-10-21T13:30:00Z")),
      refusedWith("OUTSIDE_WORKING_HOURS"), "08:30 EDT on the 21st: the new hours start at 10:00");
    assert.deepEqual(await check("emp-ny", Date.parse("2030-10-21T21:00:00Z"), Date.parse("2030-10-21T22:00:00Z")), [], "17:00-18:00 EDT: new hours");
    // A future schedule superseded before it takes effect governed nothing: it is ended ON its own start.
    const future = await op("setTechnicianWorkingHours", P.dispatcher,
      { employeeId: "emp-ny", timeZone: "America/New_York", effectiveFrom: "2030-11-11", weeklyHours: WEEKDAYS("06:00", "07:00") });
    const sooner = await op("setTechnicianWorkingHours", P.dispatcher,
      { employeeId: "emp-ny", timeZone: "America/New_York", effectiveFrom: "2030-11-01", weeklyHours: WEEKDAYS("08:00", "17:00") });
    assert.deepEqual(sooner.endedScheduleIds, [future.scheduleId]);
    const voided = await q(`SELECT to_char(effective_from,'YYYY-MM-DD') f, to_char(effective_to,'YYYY-MM-DD') t
                              FROM eos_workforce.technician_working_schedules WHERE id=$1`, [future.scheduleId]);
    assert.deepEqual(voided.rows[0], { f: "2030-11-11", t: "2030-11-11" });
    assert.deepEqual(await check("emp-ny", Date.parse("2030-11-18T14:00:00Z"), Date.parse("2030-11-18T15:00:00Z")), [], "the voided 06-07 schedule never governs");
    assert.deepEqual(await check("emp-ny", Date.parse("2030-11-04T13:00:00Z"), Date.parse("2030-11-04T15:00:00Z")), []);
    const rows = await q(`SELECT count(*)::int n FROM eos_workforce.technician_working_schedules WHERE employee_id='emp-ny'`);
    assert.equal(rows.rows[0].n, 4, "every schedule ever recorded is still there");
  });

  await t.test("ending a schedule with no replacement: from that date the Employee is NOT CONFIGURED again", async () => {
    await op("setTechnicianWorkingHours", P.dispatcher,
      { employeeId: "emp-end", timeZone: "UTC", effectiveFrom: "2030-10-01", weeklyHours: WEEKDAYS("08:00", "16:00") });
    assert.deepEqual(await check("emp-end", Date.parse("2030-10-14T09:00:00Z"), Date.parse("2030-10-14T10:00:00Z")), []);
    const ended = await op("setTechnicianWorkingHours", P.dispatcher,
      { employeeId: "emp-end", timeZone: "UTC", effectiveFrom: "2030-10-14", weeklyHours: null, reason: "left the field team" });
    assert.equal(ended.scheduleId, null);
    assert.equal(ended.endedScheduleIds.length, 1);
    assert.deepEqual(await check("emp-end", Date.parse("2030-10-08T09:00:00Z"), Date.parse("2030-10-08T10:00:00Z")), [], "before the end date: unchanged");
    await assert.rejects(check("emp-end", Date.parse("2030-10-14T09:00:00Z"), Date.parse("2030-10-14T10:00:00Z")), refusedWith("AVAILABILITY_NOT_CONFIGURED"));
    await assert.rejects(op("setTechnicianWorkingHours", P.dispatcher,
      { employeeId: "emp-end", timeZone: "UTC", weeklyHours: null, reason: "again" }), refusedWith("NO_OPEN_SCHEDULE"));
  });

  // ════════════════════ operating-company applicability ════════════════════

  await t.test("company applicability: another company's hours do not apply; this company's outrank company-wide ones", async () => {
    await op("setTechnicianWorkingHours", P.dispatcher, { employeeId: "emp-az", timeZone: "America/Phoenix", effectiveFrom: "2030-10-01",
      operatingCompanyId: "ventana", weeklyHours: WEEKDAYS("06:00", "18:00") });
    // Phoenix keeps MST all year: 08:00 MST = 15:00Z.
    await assert.rejects(check("emp-az", Date.parse("2030-10-07T15:00:00Z"), Date.parse("2030-10-07T16:00:00Z")),
      refusedWith("AVAILABILITY_NOT_CONFIGURED"), "Ventana hours say nothing about a Taylor Work Order");
    assert.deepEqual(await check("emp-az", Date.parse("2030-10-07T15:00:00Z"), Date.parse("2030-10-07T16:00:00Z"), "ventana"), []);
    await op("setTechnicianWorkingHours", P.dispatcher, { employeeId: "emp-az", timeZone: "America/Phoenix", effectiveFrom: "2030-10-01",
      operatingCompanyId: "taylor", weeklyHours: WEEKDAYS("07:00", "15:00") });
    await op("setTechnicianWorkingHours", P.dispatcher, { employeeId: "emp-az", timeZone: "America/Phoenix", effectiveFrom: "2030-10-01",
      weeklyHours: Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]])) });
    assert.deepEqual(await check("emp-az", Date.parse("2030-10-07T15:00:00Z"), Date.parse("2030-10-07T16:00:00Z")), []);
    await assert.rejects(check("emp-az", Date.parse("2030-10-07T23:00:00Z"), Date.parse("2030-10-08T00:00:00Z")),
      refusedWith("OUTSIDE_WORKING_HOURS"), "16:00 MST: the Taylor schedule governs Taylor work, not the company-wide 24h one");
  });

  await t.test("company applicability: a company-specific schedule governs its dates even where the company-wide one works", async () => {
    // Saturday: the Ventana schedule (weekdays only) governs Ventana work, so the company-wide 24h schedule does not.
    await assert.rejects(check("emp-az", Date.parse("2030-10-05T15:00:00Z"), Date.parse("2030-10-05T16:00:00Z"), "ventana"),
      refusedWith("OUTSIDE_WORKING_HOURS"));
    const r = await op("readTechnicianAvailability", P.reader,
      { start: "2030-10-07T07:00:00Z", end: "2030-10-08T07:00:00Z", employeeIds: ["emp-az"] });
    assert.equal(r.technicians[0].workingAvailability.operatingCompanyId, "taylor", "the lane shows the Employee's own company's schedule");
    assert.deepEqual(r.technicians[0].workingIntervals, [{ startMillis: Date.parse("2030-10-07T14:00:00Z"), endMillis: Date.parse("2030-10-07T22:00:00Z") }]);
  });

  // ════════════════════ blocked periods ════════════════════

  let ptoId;
  await t.test("TECHNICIAN_UNAVAILABLE: a PTO day refuses the placement and names the kind", async () => {
    const pto = await op("recordTechnicianUnavailability", P.dispatcher,
      { employeeId: "emp-ny", kind: "PTO", start: "2030-10-08T04:00:00Z", end: "2030-10-09T04:00:00Z", reason: "family" });
    ptoId = pto.unavailabilityId;
    assert.deepEqual(pto.warnings, []);
    const wo = await newWo();
    await assert.rejects(scheduling.scheduleWorkOrder(deps, P.dispatcher,
      { workOrderId: wo, employeeId: "emp-ny", scheduledStart: "2030-10-08T13:00:00Z", scheduledEnd: "2030-10-08T14:00:00Z" }),
    refusedWith("TECHNICIAN_UNAVAILABLE", (e) => assert.match(e.message, /PTO/)));
    // Overlapping blocks are legitimate facts (Owner ruling 2026-09-12).
    const training = await op("recordTechnicianUnavailability", P.dispatcher,
      { employeeId: "emp-ny", kind: "TRAINING", start: "2030-10-08T13:00:00Z", end: "2030-10-08T15:00:00Z" });
    assert.ok(training.unavailabilityId);
    for (const [input, code] of [
      [{ employeeId: "emp-ny", kind: "VACATION", start: "2030-10-10T00:00:00Z", end: "2030-10-11T00:00:00Z" }, "UNAVAILABILITY_KIND_INVALID"],
      [{ employeeId: "emp-ny", kind: "PTO", start: "2030-10-11T00:00:00Z", end: "2030-10-10T00:00:00Z" }, "UNAVAILABILITY_END_NOT_AFTER_START"],
      [{ employeeId: "emp-ny", kind: "PTO", start: "2030-10-10T00:00:00Z", end: "2031-02-10T00:00:00Z" }, "UNAVAILABILITY_TOO_LONG"],
      [{ employeeId: "emp-ny", kind: "PTO", start: "tomorrow", end: "2030-10-11T00:00:00Z" }, "TIME_INVALID"],
    ]) {
      await assert.rejects(op("recordTechnicianUnavailability", P.dispatcher, input), refusedWith(code), code);
    }
  });

  await t.test("recording unavailability over already-scheduled work does not move it, but says so", async () => {
    const { wo } = await schedule("emp-ny", "2030-10-09T13:00:00Z", "2030-10-09T14:00:00Z");
    const r = await op("recordTechnicianUnavailability", P.dispatcher,
      { employeeId: "emp-ny", kind: "TRUCK_SERVICE", start: "2030-10-09T12:00:00Z", end: "2030-10-09T16:00:00Z" });
    assert.deepEqual(r.overlappingWorkOrderIds, [wo]);
    assert.equal(r.warnings[0].code, "SCHEDULED_WORK_OVERLAPS");
    assert.equal(await statusOf(wo), "SCHEDULED");
    // DISPATCH re-checks availability over the job's own window (DQ-014): the truck is in service.
    await assert.rejects(scheduling.dispatchWorkOrder(deps, P.dispatcher, { workOrderId: wo }), refusedWith("TECHNICIAN_UNAVAILABLE", (e) => assert.match(e.message, /TRUCK_SERVICE/)));
    // RESCHEDULE into the blocked window refuses too; out of it succeeds.
    await assert.rejects(scheduling.rescheduleWorkOrder(deps, P.dispatcher, { workOrderId: wo, expectedScheduledStart: "2030-10-09T13:00:00Z",
      scheduledStart: "2030-10-09T15:00:00Z", scheduledEnd: "2030-10-09T16:00:00Z", reason: "later" }), refusedWith("TECHNICIAN_UNAVAILABLE"));
    const moved = await scheduling.rescheduleWorkOrder(deps, P.dispatcher, { workOrderId: wo, expectedScheduledStart: "2030-10-09T13:00:00Z",
      scheduledStart: "2030-10-09T17:00:00Z", scheduledEnd: "2030-10-09T18:00:00Z", reason: "after the truck is back" });
    assert.deepEqual(moved.warnings, []);
  });

  await t.test("END an unavailability: never deleted -- withdrawn before it starts, and the placement then succeeds", async () => {
    await assert.rejects(op("endTechnicianUnavailability", P.dispatcher, { unavailabilityId: ptoId }), refusedWith("REASON_REQUIRED"));
    await assert.rejects(op("endTechnicianUnavailability", P.dispatcher, { unavailabilityId: ptoId, reason: "x", endAt: "2030-10-12T00:00:00Z" }),
      refusedWith("END_AT_OUT_OF_RANGE"));
    const ended = await op("endTechnicianUnavailability", P.dispatcher, { unavailabilityId: ptoId, reason: "trip cancelled" });
    assert.equal(ended.withdrawn, true, "ending one that has not started withdraws it entirely");
    assert.equal(ended.endedAt, "2030-10-08T04:00:00.000Z");
    await assert.rejects(op("endTechnicianUnavailability", P.dispatcher, { unavailabilityId: ptoId, reason: "again" }), refusedWith("UNAVAILABILITY_ALREADY_ENDED"));
    // The TRAINING block still covers 13:00-15:00Z; 16:00Z (12:00 EDT) is lunch; 17:00-18:00Z is free.
    await assert.rejects(check("emp-ny", Date.parse("2030-10-08T13:30:00Z"), Date.parse("2030-10-08T14:00:00Z")), refusedWith("TECHNICIAN_UNAVAILABLE"));
    const { r } = await schedule("emp-ny", "2030-10-08T17:00:00Z", "2030-10-08T18:00:00Z");
    assert.equal(r.transition.toStatus, "SCHEDULED");
    const row = await q(`SELECT ended_at, end_reason, ended_by_principal_id FROM eos_workforce.technician_unavailability WHERE id=$1`, [ptoId]);
    assert.deepEqual([row.rows[0].end_reason, row.rows[0].ended_by_principal_id], ["trip cancelled", "prn-dispatcher"]);
  });

  await t.test("SCHEDULE_CONFLICT still refuses inside working hours: availability is added, never substituted", async () => {
    const { wo } = await schedule("emp-ny", "2030-10-10T13:00:00Z", "2030-10-10T15:00:00Z");
    const second = await newWo();
    await assert.rejects(scheduling.scheduleWorkOrder(deps, P.dispatcher,
      { workOrderId: second, employeeId: "emp-ny", scheduledStart: "2030-10-10T14:00:00Z", scheduledEnd: "2030-10-10T15:00:00Z" }),
    refusedWith("SCHEDULE_CONFLICT", (e) => assert.match(e.message, new RegExp(wo))));
    await assert.rejects(scheduling.scheduleWorkOrder(deps, P.dispatcher,
      { workOrderId: second, employeeId: "emp-ventana", scheduledStart: "2030-10-10T14:00:00Z", scheduledEnd: "2030-10-10T15:00:00Z" }),
    refusedWith("EMPLOYEE_NOT_ELIGIBLE_FOR_OPERATING_COMPANY"), "eligibility is still checked first");
  });

  // ════════════════════ the board read ════════════════════

  await t.test("readTechnicianAvailability: working intervals, blocks and available minutes; NOT CONFIGURED is null, never zero", async () => {
    const r = await op("readTechnicianAvailability", P.reader, { start: "2030-10-07T04:00:00Z", end: "2030-10-09T04:00:00Z", operatingCompanyId: "taylor" });
    const byId = new Map(r.technicians.map((v) => [v.employeeId, v]));
    assert.equal(byId.has("emp-ventana"), false, "the company filter holds");
    const ny = byId.get("emp-ny");
    assert.equal(ny.availabilityState, "CONFIGURED");
    assert.equal(ny.workingAvailability.timeZone, "America/New_York");
    assert.equal(ny.workingIntervals.length, 4, "two working days, each split by lunch");
    // The PTO was WITHDRAWN (ended at its own start): it no longer blocks, so it is not drawn. The row stays in history.
    assert.deepEqual(ny.blockedTime.map((b) => [b.kind, b.ended]), [["TRAINING", false]]);
    // 16 working hours, minus the withdrawn PTO (0) and the TRAINING hour inside hours (13:00-15:00Z = 09:00-11:00 EDT: 2h).
    assert.equal(ny.availableMinutes, 16 * 60 - 120);
    const none = byId.get("emp-none");
    assert.deepEqual([none.availabilityState, none.workingAvailability, none.availableMinutes], ["NOT_CONFIGURED", null, null]);
    assert.deepEqual(none.notConfiguredIntervals, [{ startMillis: Date.parse("2030-10-07T04:00:00Z"), endMillis: Date.parse("2030-10-09T04:00:00Z") }]);
    const named = await op("readTechnicianAvailability", P.reader, { start: "2030-10-07T04:00:00Z", end: "2030-10-08T04:00:00Z", employeeIds: ["emp-ny", "emp-ghost"] });
    assert.deepEqual(named.technicians.map((v) => v.employeeId), ["emp-ny"]);
    assert.deepEqual(named.notFoundEmployeeIds, ["emp-ghost"]);
    await assert.rejects(op("readTechnicianAvailability", P.reader, { start: "2030-10-01T00:00:00Z", end: "2030-11-02T00:00:00Z" }), refusedWith("RANGE_TOO_LONG"));
  });

  // ════════════════════ the self-scheduling foundation ════════════════════

  await t.test("findAvailableTechnicianSlots: working hours minus Work Orders, on the grid, each one a placement the check accepts", async () => {
    await op("setTechnicianWorkingHours", P.dispatcher,
      { employeeId: "emp-slot", timeZone: "America/New_York", effectiveFrom: "2030-10-01", weeklyHours: WEEKDAYS("08:00", "12:00") });
    await schedule("emp-slot", "2030-10-07T13:00:00Z", "2030-10-07T14:00:00Z"); // 09:00-10:00 EDT
    const base = { operatingCompanyId: "taylor", workOrderType: "SERVICE_CALL", durationMinutes: 60, earliestDate: "2030-10-07",
      horizonDays: 1, timeZone: "America/New_York", employeeIds: ["emp-slot", "emp-none"], slotIncrementMinutes: 60 };
    const r = await op("findAvailableTechnicianSlots", P.reader, base);
    assert.deepEqual(r.slots.map((s) => [s.employeeId, s.start]), [
      ["emp-slot", "2030-10-07T12:00:00.000Z"], ["emp-slot", "2030-10-07T14:00:00.000Z"], ["emp-slot", "2030-10-07T15:00:00.000Z"],
    ]);
    assert.deepEqual(r.notConfiguredEmployeeIds, ["emp-none"]);
    assert.equal(r.qualificationCode, "SERVICE_TECHNICIAN");
    assert.equal(r.truncated, false);
    for (const s of r.slots) assert.deepEqual(await check(s.employeeId, Date.parse(s.start), Date.parse(s.end)), [], s.start);
    const half = await op("findAvailableTechnicianSlots", P.reader, { ...base, slotIncrementMinutes: 30, durationMinutes: 90 });
    assert.deepEqual(half.slots.map((s) => s.start), ["2030-10-07T14:00:00.000Z", "2030-10-07T14:30:00.000Z"], "only 10:00-12:00 EDT fits 90 minutes");
  });

  await t.test("findAvailableTechnicianSlots: the earliest date, the horizon, the limit and the job-type seam are enforced", async () => {
    const base = { operatingCompanyId: "taylor", durationMinutes: 60, timeZone: "America/New_York", employeeIds: ["emp-slot"], slotIncrementMinutes: 60 };
    const past = await op("findAvailableTechnicianSlots", P.reader, { ...base, earliestDate: "2030-09-01", horizonDays: 5 });
    assert.deepEqual(past.slots, [], "an earliest date whose horizon ends before now offers nothing in the past");
    const clipped = await op("findAvailableTechnicianSlots", P.reader, { ...base, earliestDate: "2030-09-30", horizonDays: 3 });
    assert.ok(clipped.slots.every((s) => Date.parse(s.start) >= NOW), "never a slot before now");
    assert.ok(clipped.slots.every((s) => Date.parse(s.start) < Date.parse("2030-10-03T04:00:00Z")), "never past the horizon");
    assert.ok(clipped.slots.length > 0);
    const limited = await op("findAvailableTechnicianSlots", P.reader, { ...base, earliestDate: "2030-10-14", horizonDays: 5, limit: 2 });
    assert.deepEqual([limited.slots.length, limited.truncated], [2, true]);
    assert.equal(limited.slots[0].start, "2030-10-14T12:00:00.000Z", "earliest first");
    for (const [input, code] of [
      [{ ...base, earliestDate: "2030-10-07", horizonDays: 31 }, "HORIZON_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", horizonDays: 0 }, "HORIZON_INVALID"],
      [{ ...base, earliestDate: "10/07/2030" }, "EARLIEST_DATE_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", durationMinutes: 0 }, "DURATION_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", timeZone: "EST5" }, "TIME_ZONE_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", workOrderType: "DEMOLITION" }, "WORK_ORDER_TYPE_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", qualificationCode: "WAREHOUSE_OPERATIONS" }, "QUALIFICATION_NOT_SCHEDULABLE"],
      [{ ...base, earliestDate: "2030-10-07", limit: 500 }, "LIMIT_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", slotIncrementMinutes: 7 }, "SLOT_INCREMENT_INVALID"],
      [{ ...base, earliestDate: "2030-10-07", operatingCompanyId: "acme" }, "OPERATING_COMPANY_NOT_GOVERNED"],
    ]) {
      await assert.rejects(op("findAvailableTechnicianSlots", P.reader, input), refusedWith(code), code);
    }
  });

  // ════════════════════ history is append / close-only at the database ════════════════════

  await t.test("history is append / close-only AT THE DATABASE", async () => {
    await assert.rejects(q(`UPDATE eos_workforce.technician_working_hours SET end_time = '23:00'`), /immutable/);
    await assert.rejects(q(`DELETE FROM eos_workforce.technician_working_hours`), /immutable/);
    await assert.rejects(q(`DELETE FROM eos_workforce.technician_working_schedules`), /never deleted/);
    await assert.rejects(q(`UPDATE eos_workforce.technician_working_schedules SET time_zone = 'UTC' WHERE effective_to IS NULL`), /only permitted change/);
    await assert.rejects(q(`UPDATE eos_workforce.technician_working_schedules SET end_reason = 'x' WHERE effective_to IS NOT NULL`), /ended schedule is immutable/);
    await assert.rejects(q(`UPDATE eos_workforce.technician_unavailability SET kind = 'LUNCH' WHERE ended_at IS NULL`), /only permitted change/);
    await assert.rejects(q(`UPDATE eos_workforce.technician_unavailability SET end_reason = 'x' WHERE ended_at IS NOT NULL`), /immutable/);
    await assert.rejects(q(`DELETE FROM eos_workforce.technician_unavailability`), /never deleted/);
  });

  await t.test("the down migration REFUSES while availability history exists", async () => {
    // COMPUTED step count, never a bare `down 1`: every migration from this one onward is peeled, newest first; the
    // later ones reverse cleanly on this database, and this one must refuse.
    const steps = String(readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql") && Number(f.split("_")[0]) >= 1764320000000).length);
    assert.throws(() => migrate("down", steps), (e) => { assert.match(String(e.stderr ?? e.message), /TECHNICIAN_AVAILABILITY: refuses to reverse/); return true; });
    const still = await q(`SELECT to_regclass('eos_workforce.technician_working_schedules') AS t`);
    assert.ok(still.rows[0].t);
  });
});

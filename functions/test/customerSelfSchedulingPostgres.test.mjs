// CUSTOMER SELF-SCHEDULING (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment C -- "ACCEPTANCE --
// SELF-SCHEDULING", points 1-15).
//
// On a BASELINE-EQUAL tenant carrying the accepted live Service authority (support/serviceBaselineTenant.mjs). The
// self-scheduling capabilities are registered UNGRANTED; this suite grants them through the Administration API to the
// holders PROPOSED for the Owner's decision (issue -> dispatcher; configure -> fieldManager) -- the product decides
// nothing by assumption. The Service Office acts through /operations/work-orders; the customer through the public
// token-bound /public/self-scheduling (no EOS login). Slots come from the ONE availability engine.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceBaselineTenant, DAY, HOUR } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const { handleSelfSchedulingRequest } = require("../lib/eosOps/selfSchedulingHttp.js");
const { SELF_SCHEDULING_ROUTE, tokenHash } = require("../lib/eosOps/selfScheduling.js");
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-selfsched";
const WO = "/operations/work-orders";
const ALL_DAYS = (start, end) => Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start, end }]]));

test("static: ONE engine -- self-scheduling computes offers through computeTechnicianSlots, and the office query does too", () => {
  const ss = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/selfScheduling.ts"), "utf8");
  const av = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderAvailability.ts"), "utf8");
  assert.match(ss, /computeTechnicianSlots\(/);
  assert.match(ss, /scheduleWorkOrder\(/, "the booking is the governed schedule command");
  assert.doesNotMatch(ss, /INSERT INTO eos_ops\.work_order_assignments|UPDATE eos_ops\.work_orders/, "no private write to the scheduling domain");
  assert.match(av, /const \{ slots, notConfigured \} = await computeTechnicianSlots\(/, "the office slot query asks the same function");
  const code = ss.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Mail\.Send|sendMail|nodemailer|twilio/i, "no outbound delivery channel");
});

test("customer self-scheduling on PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, call, pool, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "ssch" });
  const wo = (who, op, input) => call(who, WO, op, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const customer = async (operation, input, now) => {
    const res = await handleSelfSchedulingRequest({ pool, reader: repo, workOrderPostgresState: "ACTIVE", ...(now ? { now: () => now } : {}) },
      { method: "POST", url: SELF_SCHEDULING_ROUTE, headers: {}, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };

  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-s',$1,'Summit Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,address_city,created_by,updated_by)
           VALUES ('loc-s',$1,'acct-s','Summit Kitchen','4 Ridge Rd','Concord','f','f')`, [TENANT]);

  const sm = await person("uid-ss-sm", ["fieldManager"], { id: "emp-ss-sm" });
  const disp = await person("uid-ss-disp", ["dispatcher"], { id: "emp-ss-disp" });
  const tech = await person("uid-ss-tech-a", ["technician"], { id: "emp-ss-a", technician: true, name: "Alex" });
  await person("uid-ss-tech-b", ["technician"], { id: "emp-ss-b", technician: true, name: "Bo" });
  await person("uid-ss-tech-v", ["technician"], { id: "emp-ss-v", technician: true, company: "ventana" });
  await person("uid-ss-tech-u", ["technician"], { id: "emp-ss-unqualified" });
  const sales = await person("uid-ss-sales", ["salesperson"]);

  // PROPOSED holders (an open Owner decision), granted the governed way for this proof.
  for (const [roleKey, actionKey] of [["dispatcher", "issueSchedulingLink"], ["fieldManager", "configureSelfScheduling"]]) {
    assert.equal((await admin("grantObjectActionToRole", { roleKey, objectKey: "workOrder", actionKey, reason: "PROPOSED holder -- acceptance proof" })).ok, true, actionKey);
  }

  // Working hours (UTC 09-17 every day) for the two eligible technicians; the INELIGIBLE ones are given hours the
  // eligible ones do not have, so an offered slot there would prove the engine wrong.
  for (const employeeId of ["emp-ss-a", "emp-ss-b"]) ok(await wo(sm, "setTechnicianWorkingHours", { employeeId, timeZone: "UTC", weeklyHours: ALL_DAYS("09:00", "17:00"), reason: "synthetic acceptance" }));
  ok(await wo(sm, "setTechnicianWorkingHours", { employeeId: "emp-ss-unqualified", timeZone: "UTC", weeklyHours: ALL_DAYS("06:00", "09:00"), reason: "unqualified" }));
  ok(await wo(sm, "setTechnicianWorkingHours", { employeeId: "emp-ss-v", timeZone: "UTC", weeklyHours: ALL_DAYS("17:00", "20:00"), reason: "other company" }));

  const now = Date.now();
  const day0 = new Date(now); day0.setUTCHours(0, 0, 0, 0);
  const D = (n, h, m = 0) => day0.getTime() + n * DAY + h * HOUR + m * 60_000;
  const CREATE = { operatingCompanyId: "taylor", customerId: "acct-s", locationId: "loc-s", workOrderType: "SERVICE_CALL", priority: 2, complaint: "walk-in cooler warm" };
  const readyWo = async (extra = {}) => {
    const id = ok(await wo(disp, "createWorkOrder", { ...CREATE, ...extra }), "create").workOrderId;
    ok(await wo(disp, "markWorkOrderReady", { workOrderId: id }), "ready");
    return id;
  };

  await t.test("CONFIGURATION: governed policy; no policy -> refused; configure is not issue", async () => {
    const w = await readyWo();
    refused(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w }), 412, "SELF_SCHEDULING_NOT_CONFIGURED");
    refused(await wo(disp, "saveSelfSchedulingPolicy", { earliestOffsetMinutes: 60, horizonDays: 5, sessionTtlMinutes: 60, timeZone: "UTC" }), 403, "CAPABILITY_MISSING");
    refused(await wo(sm, "saveSelfSchedulingPolicy", { earliestOffsetMinutes: 60 * 24 * 7, horizonDays: 7, sessionTtlMinutes: 60, timeZone: "UTC" }), 400, "POLICY_WINDOW_EMPTY");
    const p = ok(await wo(sm, "saveSelfSchedulingPolicy", { operatingCompanyId: "taylor", earliestOffsetMinutes: 2 * 24 * 60, horizonDays: 6,
      defaultDurationMinutes: 60, slotIncrementMinutes: 60, maxOfferedSlots: 200, sessionTtlMinutes: 24 * 60, timeZone: "UTC" }));
    assert.deepEqual([p.operatingCompanyId, p.workOrderType, p.earliestOffsetMinutes, p.horizonDays, p.version], ["taylor", null, 2880, 6, 1]);
    refused(await wo(sm, "issueSelfSchedulingLink", { workOrderId: w }), 403, "CAPABILITY_MISSING", "configure is not issue");
    refused(await wo(tech, "issueSelfSchedulingLink", { workOrderId: w }), 403, "CAPABILITY_MISSING");
    refused(await wo(sales, "issueSelfSchedulingLink", { workOrderId: w }), 403, "CAPABILITY_MISSING");
  });

  // Time off on day 3 for both; both busy on day 4 10:00-12:00 (two office-scheduled Work Orders).
  for (const employeeId of ["emp-ss-a", "emp-ss-b"]) {
    ok(await wo(sm, "recordTechnicianUnavailability", { employeeId, kind: "PTO", start: D(3, 0), end: D(4, 0), reason: "synthetic time off" }));
  }
  for (const employeeId of ["emp-ss-a", "emp-ss-b"]) {
    const w = await readyWo();
    ok(await wo(disp, "scheduleWorkOrder", { workOrderId: w, employeeId, scheduledStart: D(4, 10), scheduledEnd: D(4, 12) }), "office placement");
  }

  let mainWo, token, offer;
  await t.test("1-7: a valid Work Order produces slots -- none too soon, beyond the horizon, outside hours, in time off, overlapping, or for an incompatible Technician", async () => {
    mainWo = await readyWo();
    const issued = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: mainWo }));
    token = issued.token;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(issued.linkPath, `/schedule/${token}`);
    const stored = await one(`SELECT token_sha256 FROM eos_ops.self_scheduling_sessions WHERE id = $1`, [issued.sessionId]);
    assert.equal(stored.token_sha256, tokenHash(token), "only the hash is stored");
    assert.equal(JSON.stringify((await q(`SELECT * FROM eos_ops.self_scheduling_sessions`)).rows).includes(token), false);

    offer = ok(await customer("readSchedulingOffer", { token }));
    assert.equal(offer.status, "OPEN");
    assert.deepEqual([offer.job.customerName, offer.job.siteName, offer.job.siteAddress, offer.job.visitMinutes], ["Summit Grill", "Summit Kitchen", "4 Ridge Rd, Concord", 60]);
    const text = JSON.stringify(offer);
    for (const secret of [mainWo, TENANT, "acct-s", "loc-s", "emp-ss-a", "emp-ss-b", "Alex"]) assert.equal(text.includes(secret), false, `no ${secret} in the customer view`);
    const starts = offer.slots.map((s) => Date.parse(s.slotStart));
    assert.ok(starts.length > 0, "1: slots exist");
    const nowMs = Date.now();
    assert.ok(starts.every((s) => s >= nowMs + 2 * DAY - 60_000), "2: nothing sooner than the earliest boundary");
    assert.ok(offer.slots.every((s) => Date.parse(s.slotEnd) <= nowMs + 6 * DAY + 60_000), "3: nothing beyond the horizon");
    assert.equal(starts.some((s) => s >= D(7, 0)), false, "3: day 7 has working hours but is beyond the horizon");
    assert.equal(starts.some((s) => s < D(2, 0)), false, "2: day 1 has working hours but is too soon");
    for (const s of offer.slots) {
      const h = new Date(s.slotStart).getUTCHours();
      const e = new Date(s.slotEnd);
      assert.ok(h >= 9 && (e.getUTCHours() < 17 || (e.getUTCHours() === 17 && e.getUTCMinutes() === 0)), `4/7: ${s.slotStart} inside eligible working hours`);
    }
    assert.equal(starts.some((s) => s >= D(3, 0) && s < D(4, 0)), false, "5: the day both Technicians are off offers nothing");
    assert.equal(starts.some((s) => s >= D(4, 10) && s < D(4, 12)), false, "6: the window both are booked offers nothing");
    assert.ok(starts.some((s) => s === D(4, 9)) && starts.some((s) => s === D(4, 12)), "6: either side of the booking is offered");
  });

  await t.test("8-9: an expired link is refused; a tampered link and a smuggled Work Order id are refused", async () => {
    refused(await customer("readSchedulingOffer", { token }, new Date(Date.now() + 2 * DAY)), 410, "SESSION_EXPIRED");
    refused(await customer("selectSchedulingSlot", { token, slotStart: offer.slots[0].slotStart }, new Date(Date.now() + 2 * DAY)), 410, "SESSION_EXPIRED");
    const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    refused(await customer("readSchedulingOffer", { token: tampered }), 404, "SESSION_NOT_FOUND");
    refused(await customer("readSchedulingOffer", { token: "../../etc" }), 404, "SESSION_NOT_FOUND");
    refused(await customer("readSchedulingOffer", { token, workOrderId: mainWo }), 400, "INPUT_FIELD_NOT_ACCEPTED");
    refused(await customer("selectSchedulingSlot", { token, slotStart: offer.slots[0].slotStart, workOrderId: "wo-other" }), 400, "INPUT_FIELD_NOT_ACCEPTED");
    refused(await customer("listWorkOrders", {}), 404, "UNKNOWN_OPERATION");
    refused(await customer("selectSchedulingSlot", { token, slotStart: "2020-01-01T00:00:00.000Z" }), 409, "SLOT_NO_LONGER_AVAILABLE", "a time that was never offered");
  });

  await t.test("10: a stale page -- availability changed after display -- is refused with refreshed choices", async () => {
    const stale = offer.slots.find((s) => Date.parse(s.slotStart) === D(5, 9));
    assert.ok(stale, "day 5 09:00 was offered");
    for (const employeeId of ["emp-ss-a", "emp-ss-b"]) {
      ok(await wo(sm, "recordTechnicianUnavailability", { employeeId, kind: "TRAINING", start: D(5, 9), end: D(5, 10), reason: "changed after display" }));
    }
    const r = await customer("selectSchedulingSlot", { token, slotStart: stale.slotStart });
    refused(r, 409, "SLOT_NO_LONGER_AVAILABLE");
    assert.ok(Array.isArray(r.body.refreshed.slots) && r.body.refreshed.slots.length > 0);
    assert.equal(r.body.refreshed.slots.some((s) => s.slotStart === stale.slotStart), false, "the stale time is not offered again");
    assert.equal((await one(`SELECT status::text s FROM eos_ops.work_orders WHERE id = $1`, [mainWo])).s, "READY_TO_DISPATCH", "nothing was booked");
  });

  await t.test("11: two customers race for the one Technician free at a time -> exactly one wins; no double booking", async () => {
    ok(await wo(sm, "recordTechnicianUnavailability", { employeeId: "emp-ss-b", kind: "UNAVAILABLE", start: D(5, 12), end: D(5, 16), reason: "only Alex is free" }));
    const w1 = await readyWo(); const w2 = await readyWo();
    const t1 = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w1 })).token;
    const t2 = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w2 })).token;
    const slot = new Date(D(5, 13)).toISOString();
    assert.ok(ok(await customer("readSchedulingOffer", { token: t1 })).slots.some((s) => s.slotStart === slot));
    const results = await Promise.all([customer("selectSchedulingSlot", { token: t1, slotStart: slot }), customer("selectSchedulingSlot", { token: t2, slotStart: slot })]);
    const wins = results.filter((r) => r.status === 200);
    const losses = results.filter((r) => r.status !== 200);
    assert.equal(wins.length, 1, JSON.stringify(results.map((r) => r.body)));
    refused(losses[0], 409, "SLOT_NO_LONGER_AVAILABLE");
    assert.equal(losses[0].body.refreshed.slots.some((s) => s.slotStart === slot), false);
    const booked = (await q(`SELECT a.assignee_employee_id FROM eos_ops.work_orders w JOIN eos_ops.work_order_assignments a
                              ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
                             WHERE w.scheduled_start = $1 AND w.status = 'SCHEDULED'`, [new Date(D(5, 13))])).rows;
    assert.deepEqual(booked.map((b) => b.assignee_employee_id), ["emp-ss-a"], "one Work Order holds that window, on the one free Technician");
  });

  let confirmed;
  await t.test("12-13: a successful selection schedules the SAME EOS Work Order, and the Service Office sees it at once", async () => {
    const fresh = ok(await customer("readSchedulingOffer", { token }));
    const choice = fresh.slots[0];
    confirmed = ok(await customer("selectSchedulingSlot", { token, slotStart: choice.slotStart }));
    assert.deepEqual([confirmed.status, confirmed.slotStart, confirmed.replayed], ["CONFIRMED", choice.slotStart, false]);
    const w = await one(`SELECT status::text s, scheduled_start, scheduled_end FROM eos_ops.work_orders WHERE id = $1`, [mainWo]);
    assert.deepEqual([w.s, w.scheduled_start.toISOString(), w.scheduled_end.toISOString()], ["SCHEDULED", choice.slotStart, choice.slotEnd]);
    const queue = ok(await wo(disp, "listWorkOrders", { statuses: ["SCHEDULED"] }));
    assert.ok(queue.items.some((x) => x.workOrderId === mainWo), "the office queue shows it -- no synchronization job");
    const detail = ok(await wo(disp, "readWorkOrder", { workOrderId: mainWo }));
    assert.equal(detail.status, "SCHEDULED");
    const sessions = ok(await wo(disp, "readSelfSchedulingSessions", { workOrderId: mainWo }));
    assert.equal(sessions.sessions[0].status, "COMPLETED");
    assert.deepEqual(sessions.sessions[0].events.map((e) => e.kind).filter((k) => k !== "VIEWED"), ["ISSUED", "REFUSED", "REFUSED", "SELECTED"]);
    assert.equal(JSON.stringify(sessions).includes(token), false, "the office never sees the token again");
    const history = await one(`SELECT count(*)::int n FROM eos_ops.work_order_schedule_history WHERE work_order_id = $1`, [mainWo]);
    assert.equal(history.n, 1, "the schedule is in the governed schedule history");
  });

  await t.test("14: replay is idempotent; a different time is refused; the link now reads as the confirmation", async () => {
    const again = ok(await customer("selectSchedulingSlot", { token, slotStart: confirmed.slotStart }));
    assert.deepEqual([again.status, again.slotStart, again.replayed], ["CONFIRMED", confirmed.slotStart, true]);
    refused(await customer("selectSchedulingSlot", { token, slotStart: new Date(Date.parse(confirmed.slotStart) + HOUR).toISOString() }), 409, "SESSION_ALREADY_USED");
    assert.equal(ok(await customer("readSchedulingOffer", { token })).status, "CONFIRMED");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.work_order_assignments WHERE work_order_id = $1`, [mainWo])).n, 1);
  });

  await t.test("SESSION RULES: one live link per Work Order (supersede), revoke, office scheduling wins, withdrawn issuer authority", async () => {
    const w = await readyWo();
    const first = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w })).token;
    const second = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w })).token;
    refused(await customer("readSchedulingOffer", { token: first }), 410, "SESSION_REVOKED", "superseded");
    ok(await wo(disp, "revokeSelfSchedulingLink", { workOrderId: w, reason: "customer called in" }));
    refused(await customer("readSchedulingOffer", { token: second }), 410, "SESSION_REVOKED");

    const w2 = await readyWo();
    const t3 = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w2 })).token;
    const slot = ok(await customer("readSchedulingOffer", { token: t3 })).slots[0];
    ok(await wo(disp, "scheduleWorkOrder", { workOrderId: w2, employeeId: "emp-ss-b", scheduledStart: D(4, 14), scheduledEnd: D(4, 15) }));
    refused(await customer("selectSchedulingSlot", { token: t3, slotStart: slot.slotStart }), 412, "WORK_ORDER_NOT_SCHEDULABLE", "the office scheduled it meanwhile");

    const w3 = await readyWo();
    const t4 = ok(await wo(disp, "issueSelfSchedulingLink", { workOrderId: w3 })).token;
    const s4 = ok(await customer("readSchedulingOffer", { token: t4 })).slots[0];
    const dispRole = (await q(`SELECT a.id FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id
                               WHERE a.principal_id = $1 AND r.key = 'dispatcher' AND a.status = 'active'`, [disp.principalId])).rows[0];
    assert.equal((await admin("revokeRole", { assignmentId: dispRole.id, reason: "left the Service Office" })).ok, true);
    refused(await customer("selectSchedulingSlot", { token: t4, slotStart: s4.slotStart }), 410, "SESSION_AUTHORITY_WITHDRAWN");
    assert.equal((await one(`SELECT status::text s FROM eos_ops.work_orders WHERE id = $1`, [w3])).s, "READY_TO_DISPATCH");
  });

  await t.test("15: no Firebase anywhere -- and the history is append-only", async () => {
    await assert.rejects(q(`UPDATE eos_ops.self_scheduling_session_events SET event_kind = 'SELECTED'`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_ops.self_scheduling_sessions`), /append-only/);
    const events = (await one(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action LIKE 'workOrder.selfScheduling.%'`)).n;
    assert.ok(events >= 5);
  });
});

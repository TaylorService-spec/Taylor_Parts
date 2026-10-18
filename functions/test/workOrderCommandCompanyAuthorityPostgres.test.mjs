// D-248-1 -- WORK ORDER COMMANDS ENFORCE EOS CORE COMPANY AUTHORITY (Owner-confirmed SECURITY DEFECT, 2026-10-17; the #237 / #235 rule
// applied to createWorkOrder, scheduleWorkOrder, rescheduleWorkOrder and dispatchWorkOrder; DECISIONS #B1), against a real PostgreSQL.
//
// BEFORE this change those four commands decided capability and the Work Order's own company only: any holder of the capability
// could create a Work Order for any company and schedule, reschedule or dispatch ANY company's Work Order. NOW: capability FIRST,
// then company --
//   * no operating-company authority at all            COMPANY_AUTHORITY_REQUIRED (403), decided before any row is read
//   * a Work Order of a company outside the caller's   exactly a nonexistent Work Order (same code, status and message)
//   * a stated company outside the caller's            exactly an unknown company (same code, status and message)
//   * every refusal precedes any write (a snapshot proves nothing changed)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";
import { grantSyntheticCompanyAuthority, ROUND_THE_CLOCK } from "./support/syntheticAvailability.mjs";

const require = createRequire(import.meta.url);
const create = require("../lib/eosOps/workOrderCreateCommand.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-wocoauth";
const WO = "/operations/work-orders";

test("Work Order create / schedule / reschedule / dispatch enforce company authority (D-248-1)", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "wocoauth" });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body.result; };
  const answer = (r) => [r.status, r.body.code, r.body.message];
  const op = (who, name, input) => call(who, WO, name, input);

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-c',$1,'Harbor Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-c',$1,'acct-c','Downtown','f','f')`, [TENANT]);
  const dsp = await person("uid-dsp", ["dispatcher"], { id: "e-dsp", name: "Dee Taylor-Dispatcher" });                              // Taylor only
  const dspV = await person("uid-dspv", ["dispatcher"], { id: "e-dspv", name: "Val Ventana-Dispatcher", company: "ventana" });        // Ventana only
  const dspB = await person("uid-dspb", ["dispatcher"], { id: "e-dspb", name: "Bo Both-Dispatcher" });                                // Taylor home + explicit Ventana
  const tech = await person("uid-tech", ["technician"], { id: "e-tech", name: "Tay Tech", technician: true });                        // holds no create / schedule key
  await person("uid-ttay", ["technician"], { id: "e-ttay", name: "Tess Taylor-Tech", technician: true });
  await person("uid-tven", ["technician"], { id: "e-tven", name: "Vic Ventana-Tech", company: "ventana", technician: true });
  await grantSyntheticCompanyAuthority(pool, TENANT, dspB.principalId, ["taylor", "ventana"]);

  const base = { customerId: "acct-c", locationId: "loc-c", workOrderType: "SERVICE_CALL", priority: 2 };
  for (const e of ["e-ttay", "e-tven"]) {
    ok(await op(dspB, "setTechnicianWorkingHours", { employeeId: e, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "fixture" }), `hours ${e}`);
  }
  const ready = async (who, company) => {
    const id = ok(await op(who, "createWorkOrder", { ...base, operatingCompanyId: company }), `create ${company}`).workOrderId;
    ok(await op(who, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await op(who, "setWorkOrderPartsPlan", { workOrderId: id, plan: [] }), "plan");
    return id;
  };
  const day = (n) => Date.now() + n * 24 * HOUR;
  const snapshot = async () => JSON.stringify((await q(`SELECT (SELECT json_agg(json_build_array(id, status::text, scheduled_start) ORDER BY id) FROM eos_ops.work_orders) w,
    (SELECT count(*)::int FROM eos_ops.work_order_assignments) a, (SELECT count(*)::int FROM eos_ops.work_order_transitions) t,
    (SELECT count(*)::int FROM eos_ops.work_order_schedule_history) h`)).rows[0]);

  await t.test("CREATE: capability first, then the stated company -- outside the caller's == an unknown company; no row is written", async () => {
    const before = await snapshot();
    const ventana = await op(dsp, "createWorkOrder", { ...base, operatingCompanyId: "ventana" });
    const unknown = await op(dsp, "createWorkOrder", { ...base, operatingCompanyId: "nope-co" });
    assert.notEqual(ventana.status, 200);
    assert.deepEqual([ventana.status, ventana.body.code], [unknown.status, unknown.body.code], "out of scope reads like unknown");
    assert.equal(ventana.body.code, "OPERATING_COMPANY_KEY_NOT_BOUND");
    assert.equal(ventana.body.message.replace("'ventana'", "'X'"), unknown.body.message.replace("'nope-co'", "'X'"));
    assert.equal(await snapshot(), before, "a refused create wrote nothing");
    // Capability FIRST: a caller without workOrder.create is told so, whatever company it names.
    for (const company of ["taylor", "ventana"]) assert.equal((await op(tech, "createWorkOrder", { ...base, operatingCompanyId: company })).body.code, "CAPABILITY_MISSING");
    // The controls: authority over the company is exactly what allows it.
    ok(await op(dsp, "createWorkOrder", { ...base, operatingCompanyId: "taylor" }), "Taylor dispatcher, Taylor");
    ok(await op(dspV, "createWorkOrder", { ...base, operatingCompanyId: "ventana" }), "Ventana dispatcher, Ventana");
    ok(await op(dspB, "createWorkOrder", { ...base, operatingCompanyId: "ventana" }), "explicit cross-company authority");
    assert.equal((await op(dspV, "createWorkOrder", { ...base, operatingCompanyId: "taylor" })).body.code, "OPERATING_COMPANY_KEY_NOT_BOUND", "and the other way round");
  });

  await t.test("SCHEDULE / RESCHEDULE / DISPATCH: a Work Order of another company answers exactly like a nonexistent one; nothing changes", async () => {
    const woV = await ready(dspB, "ventana");           // READY_TO_DISPATCH, Ventana
    const woV2 = await ready(dspB, "ventana");
    const woT = await ready(dsp, "taylor");
    // Place woV (so it can be rescheduled and dispatched) under the authorized dispatcher.
    const start = day(2);
    ok(await op(dspB, "scheduleWorkOrder", { workOrderId: woV, employeeId: "e-tven", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule woV");
    const before = await snapshot();

    const nope = (name, input) => op(dsp, name, { ...input, workOrderId: "wo-nope" });
    const schedule = { employeeId: "e-tven", scheduledStart: day(3), scheduledEnd: day(3) + HOUR };
    const reschedule = { expectedScheduledStart: new Date(start).toISOString(), scheduledStart: day(4), scheduledEnd: day(4) + HOUR, reason: "move it" };
    const dispatch = {};
    for (const [name, input, target] of [["scheduleWorkOrder", schedule, woV2], ["rescheduleWorkOrder", reschedule, woV], ["dispatchWorkOrder", dispatch, woV]]) {
      const outside = await op(dsp, name, { ...input, workOrderId: target });
      const missing = await nope(name, input);
      assert.equal(outside.body.code, "WORK_ORDER_NOT_FOUND", name);
      assert.deepEqual(answer(outside).map((x) => String(x).replace(target, "<id>")), answer(missing).map((x) => String(x).replace("wo-nope", "<id>")), `${name}: outside == nonexistent`);
    }
    assert.equal(await snapshot(), before, "every refusal preceded any write");

    // The other direction: a Ventana-only dispatcher is refused a Taylor Work Order the same way.
    const crossed = await op(dspV, "scheduleWorkOrder", { workOrderId: woT, employeeId: "e-ttay", scheduledStart: day(3), scheduledEnd: day(3) + HOUR });
    assert.equal(crossed.body.code, "WORK_ORDER_NOT_FOUND");
    assert.equal(await snapshot(), before);

    // The controls: the right company's dispatcher, and the one with explicit authority over both, act normally.
    ok(await op(dsp, "scheduleWorkOrder", { workOrderId: woT, employeeId: "e-ttay", scheduledStart: day(3), scheduledEnd: day(3) + HOUR }), "Taylor dispatcher schedules Taylor");
    ok(await op(dspB, "rescheduleWorkOrder", { workOrderId: woV, ...reschedule }), "explicit authority reschedules Ventana");
    ok(await op(dspB, "dispatchWorkOrder", { workOrderId: woV }), "explicit authority dispatches Ventana");
  });

  await t.test("NO AUTHORITY: a principal with the capability but no operating-company authority is COMPANY_AUTHORITY_REQUIRED (before any row is read); capability still comes first", async () => {
    const caps = new Set(["workOrder.create", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch"]);
    const none = { tenantId: TENANT, principalId: "prn-no-company-authority", capabilities: caps };
    const woT = await ready(dsp, "taylor");
    const before = await snapshot();
    const code = async (promise) => { try { await promise; } catch (e) { return [e.code, e.category]; } return assert.fail("expected a refusal"); };
    assert.deepEqual(await code(create.createWorkOrder({ pool }, { ...none, operatingCompanyId: "taylor" }, base)), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    const window = { scheduledStart: day(5), scheduledEnd: day(5) + HOUR };
    assert.deepEqual(await code(scheduling.scheduleWorkOrder({ pool }, none, { workOrderId: woT, employeeId: "e-ttay", ...window })), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    assert.deepEqual(await code(scheduling.rescheduleWorkOrder({ pool }, none, { workOrderId: woT, expectedScheduledStart: window.scheduledStart, ...window, reason: "x" })), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    assert.deepEqual(await code(scheduling.dispatchWorkOrder({ pool }, none, { workOrderId: woT })), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    // The same answer whether the Work Order exists or not (decided before any lookup).
    assert.deepEqual(await code(scheduling.dispatchWorkOrder({ pool }, none, { workOrderId: "wo-nope" })), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    assert.equal(await snapshot(), before);
    // CAPABILITY FIRST: without the key the answer is the capability, never the company.
    const keyless = { ...none, capabilities: new Set() };
    assert.equal((await code(create.createWorkOrder({ pool }, { ...keyless, operatingCompanyId: "taylor" }, base)))[0], "CAPABILITY_MISSING");
    assert.equal((await code(scheduling.scheduleWorkOrder({ pool }, keyless, { workOrderId: woT, employeeId: "e-ttay", ...window })))[0], "CAPABILITY_MISSING");
    assert.equal((await code(scheduling.dispatchWorkOrder({ pool }, keyless, { workOrderId: woT })))[0], "CAPABILITY_MISSING");
  });
});

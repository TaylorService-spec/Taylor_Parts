// TECHNICIAN AVAILABILITY, CLIENT HALF (Owner ruling DECISION 5, 2026-09-30).
//
// The board's availability read, the availability writes and the planning estimate go through the GOVERNED
// /operations/work-orders route only (services/workOrderService.ts), keyed by EMPLOYEE id -- the Firebase
// readTechnicianAvailabilityCallable is retired with no fallback. The three availability refusals render as three
// DIFFERENT sentences (domain/schedulingRefusal.js).
//
// Run: node --test test/technicianAvailabilityClient.test.mjs   (also `npm test`)
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { __setWorkOrderTransportForTests } from "../src/services/workOrderService.ts";
import {
  adaptAvailabilityView,
  endTechnicianUnavailability,
  findAvailableTechnicianSlots,
  readTechnicianAvailability,
  recordTechnicianUnavailability,
  setTechnicianWorkingHours,
  setWorkOrderEstimatedDuration,
} from "../src/services/schedulingCommandClient.js";
import { schedulingRefusalMessage, unavailabilityKindFrom } from "../src/domain/schedulingRefusal.js";

const read = (f) => readFileSync(path.resolve(process.cwd(), f), "utf8");
const recorder = (answer) => {
  const calls = [];
  const call = async (operation, input) => { calls.push({ operation, input }); return answer(operation, input); };
  return { calls, call };
};

const VIEW = {
  employeeId: "emp-1", displayName: "Avery Tech", operatingCompanyId: "taylor", availabilityState: "CONFIGURED",
  workingAvailability: { scheduleId: "tws_1", timeZone: "America/New_York", weeklyHours: { 1: [{ start: "08:00", end: "17:00" }] },
    effectiveFrom: "2030-10-01", effectiveTo: null, operatingCompanyId: null },
  workingIntervals: [{ startMillis: 1, endMillis: 2 }], notConfiguredIntervals: [],
  blockedTime: [{ unavailabilityId: "tua_1", kind: "PTO", startMillis: 10, endMillis: 20, ended: false, reason: "family" }],
  availableMinutes: 480,
};

afterEach(() => __setWorkOrderTransportForTests(null));

describe("the availability read is the governed operation, keyed by Employee id", () => {
  it("readTechnicianAvailability calls readTechnicianAvailability and adapts to the lane shape", async () => {
    const t = recorder(() => ({ ok: true, operation: "readTechnicianAvailability",
      result: { startMillis: 0, endMillis: 100, technicians: [VIEW, { ...VIEW, employeeId: "emp-2", availabilityState: "NOT_CONFIGURED",
        workingAvailability: null, availableMinutes: null, blockedTime: [] }], notFoundEmployeeIds: [] } }));
    __setWorkOrderTransportForTests(t.call);
    const res = await readTechnicianAvailability({ startMillis: 0, endMillis: 100, technicianIds: ["emp-1", "emp-2"] });
    assert.deepEqual(t.calls, [{ operation: "readTechnicianAvailability", input: { start: 0, end: 100, employeeIds: ["emp-1", "emp-2"] } }]);
    const [a, b] = res.result.technicians;
    assert.equal(a.technicianId, "emp-1", "the lane key IS the Employee id");
    assert.deepEqual(a.blockedTime, [{ blockId: "tua_1", unavailabilityId: "tua_1", kind: "PTO", startMillis: 10, endMillis: 20, note: "family" }]);
    assert.equal(a.workingAvailability.weeklyHours[1][0].start, "08:00");
    assert.equal(a.availableMinutes, 480);
    assert.deepEqual([b.availabilityState, b.workingAvailability, b.availableMinutes], ["NOT_CONFIGURED", null, null],
      "NOT CONFIGURED stays null -- never zero");
  });

  it("without technicianIds the read asks for every schedulable technician", async () => {
    const t = recorder(() => ({ ok: true, result: { startMillis: 0, endMillis: 1, technicians: [] } }));
    __setWorkOrderTransportForTests(t.call);
    await readTechnicianAvailability({ startMillis: 0, endMillis: 1 });
    assert.deepEqual(t.calls[0].input, { start: 0, end: 1 });
  });

  it("a refusal is returned as a value, never thrown, and never falls back", async () => {
    const t = recorder(() => ({ ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503, message: "inactive" }));
    __setWorkOrderTransportForTests(t.call);
    const res = await readTechnicianAvailability({ startMillis: 0, endMillis: 1 });
    assert.deepEqual(res, { errorStatus: "not_activated", errorCode: "NOT_ACTIVATED", errorMessage: "inactive" });
    assert.equal(t.calls.length, 1);
  });

  it("adaptAvailabilityView refuses a shapeless row rather than inventing one", () => {
    assert.equal(adaptAvailabilityView(null), null);
    assert.equal(adaptAvailabilityView({ technicianId: "legacy-tech" }), null);
  });
});

describe("the availability writes and the planning estimate are governed operations", () => {
  it("each write names its operation and passes its input through", async () => {
    const t = recorder((operation) => ({ ok: true, operation, result: { ok: operation } }));
    __setWorkOrderTransportForTests(t.call);
    await setTechnicianWorkingHours({ employeeId: "emp-1", timeZone: "UTC", weeklyHours: { 1: [{ start: "08:00", end: "16:00" }] } });
    await recordTechnicianUnavailability({ employeeId: "emp-1", kind: "PTO", start: 1, end: 2 });
    await endTechnicianUnavailability({ unavailabilityId: "tua_1", reason: "cancelled" });
    await findAvailableTechnicianSlots({ operatingCompanyId: "taylor", durationMinutes: 60, earliestDate: "2030-10-07", timeZone: "UTC" });
    assert.deepEqual(t.calls.map((c) => c.operation),
      ["setTechnicianWorkingHours", "recordTechnicianUnavailability", "endTechnicianUnavailability", "findAvailableTechnicianSlots"]);
    assert.equal(t.calls[0].input.employeeId, "emp-1");
  });

  it("the planning estimate goes to setWorkOrderEstimatedDuration (no longer NOT_ON_GOVERNED_ROUTE); null clears", async () => {
    const t = recorder((operation, input) => ({ ok: true, operation, result: { ...input } }));
    __setWorkOrderTransportForTests(t.call);
    const set = await setWorkOrderEstimatedDuration({ workOrderId: "wo-1", estimatedDurationMinutes: 90 });
    assert.deepEqual(set, { result: { workOrderId: "wo-1", estimatedDurationMinutes: 90 } });
    await setWorkOrderEstimatedDuration({ workOrderId: "wo-1", estimatedDurationMinutes: null });
    assert.deepEqual(t.calls.map((c) => [c.operation, c.input.estimatedDurationMinutes]),
      [["setWorkOrderEstimatedDuration", 90], ["setWorkOrderEstimatedDuration", null]]);
  });

  it("a terminal Work Order's refusal comes back as its own code", async () => {
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "PRECONDITION_FAILED", reason: "WORK_ORDER_TERMINAL", status: 412, message: "closed" }));
    const res = await setWorkOrderEstimatedDuration({ workOrderId: "wo-1", estimatedDurationMinutes: 30 });
    assert.deepEqual([res.errorStatus, res.errorCode], ["precondition_failed", "WORK_ORDER_TERMINAL"]);
  });
});

describe("no Firebase technician-availability path remains", () => {
  it("schedulingCommandClient imports no firebase and names no availability callable", () => {
    const src = read("src/services/schedulingCommandClient.js");
    assert.doesNotMatch(src, /from ["']firebase|import\(["']firebase|httpsCallable/);
    assert.doesNotMatch(src, /["'](readTechnicianAvailabilityCallable|setTechnicianWorkingAvailabilityCallable|createTechnicianBlockedTimeCallable|deleteTechnicianBlockedTimeCallable|setWorkOrderEstimatedDurationCallable)["']/);
    assert.doesNotMatch(src, /NOT_ON_GOVERNED_ROUTE/);
  });
});

describe("the three availability refusals are three different sentences (DECISION 5)", () => {
  const ctx = { technicianName: "J. Barela" };
  it("not configured, outside hours and unavailable are distinct, and none is a raw code", () => {
    const notConfigured = schedulingRefusalMessage("AVAILABILITY_NOT_CONFIGURED", "precondition_failed", ctx);
    const outside = schedulingRefusalMessage("OUTSIDE_WORKING_HOURS", "precondition_failed", ctx);
    const unavailable = schedulingRefusalMessage("TECHNICIAN_UNAVAILABLE", "precondition_failed",
      { ...ctx, serverMessage: "the Employee is unavailable (PTO) from 2030-10-08T04:00:00.000Z to 2030-10-09T04:00:00.000Z" });
    assert.equal(new Set([notConfigured, outside, unavailable]).size, 3);
    for (const m of [notConfigured, outside, unavailable]) {
      assert.match(m, /^Refused — /);
      assert.match(m, /J\. Barela/);
      assert.doesNotMatch(m, /[A-Z]{3,}_[A-Z]/, "never a raw backend code");
    }
    assert.match(notConfigured, /no working hours configured/);
    assert.match(outside, /outside .* working hours/);
    assert.match(unavailable, /time off/, "the kind the server named, in words");
  });
  it("the kind is read only from the governed vocabulary", () => {
    assert.equal(unavailabilityKindFrom("the Employee is unavailable (TRUCK_SERVICE) from x"), "TRUCK_SERVICE");
    assert.equal(unavailabilityKindFrom("the Employee is unavailable (HOLIDAY_PARTY) from x"), null);
    assert.equal(unavailabilityKindFrom(null), null);
    assert.match(schedulingRefusalMessage("TECHNICIAN_UNAVAILABLE", "precondition_failed", {}), /recorded unavailable time/);
  });
});

// Scheduling workspace -- OFFLINE tests for the pure domain spine. TZ-robust: every expected instant is
// built with the SAME local Date API the domain uses, so day-bucketing is self-consistent on any CI zone.
import assert from "node:assert/strict";
import {
  toMillis,
  startOfWeekMillis,
  addWeeks,
  buildWeekDays,
  durationMinutes,
  detectDayOverlaps,
  buildWeeklySchedule,
  buildScheduleInput,
  SCHEDULABLE_STATUS,
} from "../src/domain/schedulingWorkspace.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("schedulingWorkspace.test.mjs");

// Local helper mirroring how a dispatcher-chosen local time becomes ms.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

check("toMillis: number/Date/Timestamp/{seconds}/null", () => {
  assert.equal(toMillis(1000), 1000);
  assert.equal(toMillis(new Date(1000)), 1000);
  assert.equal(toMillis({ toMillis: () => 2000 }), 2000);
  assert.equal(toMillis({ seconds: 3 }), 3000);
  assert.equal(toMillis(null), null);
  assert.equal(toMillis(undefined), null);
  assert.equal(toMillis({ nope: 1 }), null);
  assert.equal(toMillis(Number.NaN), null);
});

check("startOfWeekMillis: Monday 00:00 for any day in the week; Monday maps to itself", () => {
  // 2026-08-05 is a Wednesday. Its week's Monday is 2026-08-03.
  const wed = at(2026, 8, 5, 14, 30);
  assert.equal(startOfWeekMillis(wed), at(2026, 8, 3, 0, 0));
  // Sunday 2026-08-09 belongs to the SAME week (Mon 08-03).
  assert.equal(startOfWeekMillis(at(2026, 8, 9, 23, 0)), at(2026, 8, 3, 0, 0));
  // Monday maps to itself at midnight.
  assert.equal(startOfWeekMillis(at(2026, 8, 3, 9, 0)), at(2026, 8, 3, 0, 0));
});

check("addWeeks: prev/this/next", () => {
  const monday = at(2026, 8, 3, 0, 0);
  assert.equal(addWeeks(monday, 0), monday);
  assert.equal(addWeeks(monday, 1), at(2026, 8, 10, 0, 0));
  assert.equal(addWeeks(monday, -1), at(2026, 7, 27, 0, 0));
});

check("buildWeekDays: 7 days Mon..Sun; isToday + isWeekend", () => {
  const monday = at(2026, 8, 3, 0, 0);
  const now = at(2026, 8, 5, 10, 0); // Wednesday
  const days = buildWeekDays(monday, now);
  assert.equal(days.length, 7);
  assert.equal(days[0].dateMillis, at(2026, 8, 3));
  assert.equal(days[6].dateMillis, at(2026, 8, 9));
  assert.equal(days[2].isToday, true); // Wed
  assert.equal(days[0].isToday, false);
  assert.equal(days[5].isWeekend, true); // Sat
  assert.equal(days[6].isWeekend, true); // Sun
  assert.equal(days[0].isWeekend, false); // Mon
});

check("durationMinutes: positive diff only", () => {
  assert.equal(durationMinutes(at(2026, 8, 3, 9, 0), at(2026, 8, 3, 10, 30)), 90);
  assert.equal(durationMinutes(at(2026, 8, 3, 10, 0), at(2026, 8, 3, 9, 0)), null); // negative
  assert.equal(durationMinutes(null, 1), null);
});

check("detectDayOverlaps: flags overlapping intervals, ignores untimed/adjacent", () => {
  const jobs = [
    { id: "a", startMillis: at(2026, 8, 3, 9, 0), endMillis: at(2026, 8, 3, 10, 0) },
    { id: "b", startMillis: at(2026, 8, 3, 9, 30), endMillis: at(2026, 8, 3, 10, 30) }, // overlaps a
    { id: "c", startMillis: at(2026, 8, 3, 11, 0), endMillis: at(2026, 8, 3, 12, 0) }, // separate from a & b, no overlap
    { id: "d", startMillis: null, endMillis: null }, // untimed -> ignored
  ];
  const o = detectDayOverlaps(jobs);
  assert.equal(o.has("a"), true);
  assert.equal(o.has("b"), true);
  assert.equal(o.has("c"), false);
  assert.equal(o.has("d"), false);
});

check("buildWeeklySchedule: buckets by tech/day, weekly totals, ready queue, excludes CANCELLED/out-of-week", () => {
  const weekStart = at(2026, 8, 3, 0, 0);
  const now = at(2026, 8, 5, 8, 0);
  const technicians = [
    { id: "t1", name: "Bravo Tech" },
    { id: "t2", name: "Alpha Tech" },
  ];
  const workOrders = [
    // t2 (Alpha) Monday 2 jobs (one 60m, one 120m)
    { id: "w1", woNumber: "WO-1", status: "SCHEDULED", scheduledTechId: "t2", scheduledStart: at(2026, 8, 3, 9, 0), scheduledEnd: at(2026, 8, 3, 10, 0), priority: 3, type: "PM" },
    { id: "w2", woNumber: "WO-2", status: "DISPATCHED", scheduledTechId: "t2", scheduledStart: at(2026, 8, 3, 13, 0), scheduledEnd: at(2026, 8, 3, 15, 0), priority: 2, type: "SERVICE_CALL" },
    // t1 (Bravo) Wednesday 1 job
    { id: "w3", woNumber: "WO-3", status: "SCHEDULED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 5, 9, 0), scheduledEnd: at(2026, 8, 5, 9, 45), priority: 1, type: "INSTALL" },
    // CANCELLED scheduled -> excluded
    { id: "w4", woNumber: "WO-4", status: "CANCELLED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 4, 9, 0), scheduledEnd: at(2026, 8, 4, 10, 0) },
    // scheduled in a DIFFERENT week -> excluded from this week
    { id: "w5", woNumber: "WO-5", status: "SCHEDULED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 12, 9, 0), scheduledEnd: at(2026, 8, 12, 10, 0) },
    // ready-to-schedule (READY_TO_DISPATCH) -> queue, not the grid
    { id: "w6", woNumber: "WO-6", status: SCHEDULABLE_STATUS, priority: 1, type: "SERVICE_CALL" },
    { id: "w7", woNumber: "WO-7", status: SCHEDULABLE_STATUS, priority: 3, type: "PM" },
  ];

  const vm = buildWeeklySchedule({ workOrders, technicians, weekStartMillis: weekStart, nowMillis: now });

  // Rows are name-sorted: Alpha (t2) before Bravo (t1).
  assert.deepEqual(vm.technicianRows.map((r) => r.tech.id), ["t2", "t1"]);
  const alpha = vm.technicianRows[0];
  const bravo = vm.technicianRows[1];
  // Alpha Monday (day index 0) has both jobs, sorted by start.
  assert.deepEqual(alpha.jobsByDay[0].map((j) => j.id), ["w1", "w2"]);
  assert.equal(alpha.weekJobCount, 2);
  assert.equal(alpha.weekMinutes, 60 + 120);
  // Bravo Wednesday (index 2) has the one job.
  assert.deepEqual(bravo.jobsByDay[2].map((j) => j.id), ["w3"]);
  assert.equal(bravo.weekJobCount, 1);
  // Totals + ready queue (priority then woNumber: WO-6 p1 before WO-7 p3).
  assert.equal(vm.totals.scheduledThisWeek, 3); // w1,w2,w3 (w4 cancelled, w5 other week)
  assert.deepEqual(vm.readyToSchedule.map((r) => r.id), ["w6", "w7"]);
  assert.equal(vm.totals.readyToSchedule, 2);
  assert.equal(vm.totals.technicians, 2);
});

check("buildWeeklySchedule: unknown-tech scheduled work is surfaced (never dropped); overlaps + past-due flagged", () => {
  const weekStart = at(2026, 8, 3, 0, 0);
  const now = at(2026, 8, 5, 8, 0); // Wednesday
  const technicians = [{ id: "t1", name: "Only Tech" }];
  const workOrders = [
    // scheduled to a tech that isn't in the technicians list -> unassignedScheduled
    { id: "u1", woNumber: "WO-U", status: "SCHEDULED", scheduledTechId: "ghost", scheduledStart: at(2026, 8, 3, 9, 0), scheduledEnd: at(2026, 8, 3, 10, 0) },
    // t1 Monday two overlapping jobs
    { id: "o1", woNumber: "WO-O1", status: "SCHEDULED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 3, 9, 0), scheduledEnd: at(2026, 8, 3, 11, 0) },
    { id: "o2", woNumber: "WO-O2", status: "SCHEDULED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 3, 10, 0), scheduledEnd: at(2026, 8, 3, 12, 0) },
    // past-due SCHEDULED (Monday, before Wed today) -> also NEEDS ATTENTION
  ];
  const vm = buildWeeklySchedule({ workOrders, technicians, weekStartMillis: weekStart, nowMillis: now });
  assert.deepEqual(vm.unassignedScheduled.map((j) => j.id), ["u1"]);
  const row = vm.technicianRows[0];
  assert.equal(row.overlapIds.has("o1"), true);
  assert.equal(row.overlapIds.has("o2"), true);
  const kinds = vm.needsAttention.map((n) => `${n.kind}:${n.job.id}`);
  assert.ok(kinds.includes("OVERLAP:o1"));
  assert.ok(kinds.includes("OVERLAP:o2"));
  // o1/o2 are Monday, before Wednesday "now" -> past-due too.
  assert.ok(kinds.includes("PAST_DUE:o1"));
});

check("buildScheduleInput: valid payload mirrors the required Schedule fields", () => {
  const r = buildScheduleInput({ date: "2026-08-10", start: "09:00", end: "11:30", techId: "t1" });
  assert.equal(r.ok, true);
  assert.equal(r.value.scheduledTechId, "t1");
  assert.equal(r.value.scheduledStart, at(2026, 8, 10, 9, 0));
  assert.equal(r.value.scheduledEnd, at(2026, 8, 10, 11, 30));
});

check("buildScheduleInput: honest failures (no partial payload)", () => {
  assert.deepEqual(buildScheduleInput({ date: "2026-08-10", start: "09:00", end: "11:00" }), { ok: false, error: "TECH_REQUIRED" });
  assert.deepEqual(buildScheduleInput({ start: "09:00", end: "11:00", techId: "t1" }), { ok: false, error: "DATE_REQUIRED" });
  assert.deepEqual(buildScheduleInput({ date: "2026-08-10", end: "11:00", techId: "t1" }), { ok: false, error: "TIME_REQUIRED" });
  assert.equal(buildScheduleInput({ date: "2026-08-10", start: "11:00", end: "09:00", techId: "t1" }).error, "END_BEFORE_START");
  assert.equal(buildScheduleInput({ date: "2026-08-10", start: "11:00", end: "11:00", techId: "t1" }).error, "END_BEFORE_START");
  assert.equal(buildScheduleInput({ date: "bad", start: "09:00", end: "11:00", techId: "t1" }).error, "TIME_INVALID");
  assert.equal(buildScheduleInput({ date: "2026-08-10", start: "9am", end: "11:00", techId: "t1" }).error, "TIME_INVALID");
  // Well-formed but OUT OF RANGE must be rejected (not silently rolled over by the Date constructor).
  assert.equal(buildScheduleInput({ date: "2026-02-30", start: "09:00", end: "11:00", techId: "t1" }).error, "TIME_INVALID");
  assert.equal(buildScheduleInput({ date: "2026-13-01", start: "09:00", end: "11:00", techId: "t1" }).error, "TIME_INVALID");
  assert.equal(buildScheduleInput({ date: "2026-08-10", start: "09:99", end: "11:00", techId: "t1" }).error, "TIME_INVALID");
  assert.equal(buildScheduleInput({ date: "2026-08-10", start: "25:00", end: "26:00", techId: "t1" }).error, "TIME_INVALID");
});

check("SCHEDULABLE_STATUS is derived from the workflow mirror (READY_TO_DISPATCH)", () => {
  assert.equal(SCHEDULABLE_STATUS, "READY_TO_DISPATCH");
});

check("buildWeeklySchedule: the ACTUAL owner (assignedTechId) wins over the original scheduledTechId", () => {
  const weekStart = at(2026, 8, 3, 0, 0);
  const technicians = [{ id: "t1", name: "Alpha" }, { id: "t2", name: "Bravo" }];
  const workOrders = [
    // Scheduled to t2, but reassigned to t1 at Dispatch -> must appear on t1's row (actual owner), not t2's.
    { id: "d1", woNumber: "WO-D", status: "DISPATCHED", scheduledTechId: "t2", assignedTechId: "t1", scheduledStart: at(2026, 8, 3, 9, 0), scheduledEnd: at(2026, 8, 3, 10, 0) },
  ];
  const vm = buildWeeklySchedule({ workOrders, technicians, weekStartMillis: weekStart, nowMillis: at(2026, 8, 3, 8, 0) });
  const alpha = vm.technicianRows.find((r) => r.tech.id === "t1");
  const bravo = vm.technicianRows.find((r) => r.tech.id === "t2");
  assert.deepEqual(alpha.jobsByDay[0].map((j) => j.id), ["d1"]); // actual owner t1
  assert.equal(bravo.jobsByDay[0].length, 0); // NOT on the originally-scheduled t2
});

console.log(`\n${passed} passed, 0 failed`);

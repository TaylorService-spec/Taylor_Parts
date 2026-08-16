// Wave 7 completion, PART 1 -- OFFLINE tests for the combined Dispatch/Scheduling board's pure domain
// spine. Matches schedulingWorkspace.test.mjs's own TZ-robust convention: every expected instant is built
// with the same local Date API the domain module uses.
import assert from "node:assert/strict";
import {
  DAY_WINDOW_START_HOUR,
  DAY_WINDOW_END_HOUR,
  DEFAULT_SLOT_DURATION_MINUTES,
  toDateString,
  toTimeString,
  computeTimelineSlot,
  offsetFractionToMillis,
  buildDropDefaults,
  groupReadyQueueByPriority,
  buildDayBoard,
  buildHourTicks,
} from "../src/domain/dispatchSchedulingBoard.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("dispatchSchedulingBoard.test.mjs");

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

check("toDateString / toTimeString round-trip local wall-clock", () => {
  const ms = at(2026, 8, 5, 9, 30);
  assert.equal(toDateString(ms), "2026-08-05");
  assert.equal(toTimeString(ms), "09:30");
});

check("computeTimelineSlot: a job fully inside the window positions proportionally, not clipped", () => {
  const dayStart = at(2026, 8, 5, 0, 0);
  const slot = computeTimelineSlot({
    startMillis: at(2026, 8, 5, 9, 0),
    endMillis: at(2026, 8, 5, 10, 0),
    dayStartMillis: dayStart,
    windowStartHour: 6,
    windowEndHour: 18,
  });
  // window is 6..18 (12h); 9:00 is 3h in -> 25%; 1h duration -> ~8.33% wide
  assert.ok(Math.abs(slot.leftPct - 25) < 0.001);
  assert.ok(Math.abs(slot.widthPct - (100 / 12)) < 0.01);
  assert.equal(slot.startClipped, false);
  assert.equal(slot.endClipped, false);
  assert.equal(slot.hasEnd, true);
});

check("computeTimelineSlot: a job before/after the window is clipped to the edge, never hidden (leftPct stays in [0,100])", () => {
  const dayStart = at(2026, 8, 5, 0, 0);
  const early = computeTimelineSlot({
    startMillis: at(2026, 8, 5, 3, 0), // before the 6am window
    endMillis: at(2026, 8, 5, 7, 0),
    dayStartMillis: dayStart,
    windowStartHour: 6,
    windowEndHour: 18,
  });
  assert.equal(early.startClipped, true);
  assert.ok(early.leftPct >= 0);

  const late = computeTimelineSlot({
    startMillis: at(2026, 8, 5, 17, 0),
    endMillis: at(2026, 8, 5, 21, 0), // after the 6pm window
    dayStartMillis: dayStart,
    windowStartHour: 6,
    windowEndHour: 18,
  });
  assert.equal(late.endClipped, true);
  assert.ok(late.leftPct + late.widthPct <= 100.001);
});

check("computeTimelineSlot: no end -> a default width is used but hasEnd is false (never fabricates a real end)", () => {
  const dayStart = at(2026, 8, 5, 0, 0);
  const slot = computeTimelineSlot({
    startMillis: at(2026, 8, 5, 9, 0),
    endMillis: null,
    dayStartMillis: dayStart,
    windowStartHour: 6,
    windowEndHour: 18,
  });
  assert.equal(slot.hasEnd, false);
  assert.ok(slot.widthPct > 0);
});

check("offsetFractionToMillis: snaps to DROP_SNAP_MINUTES and respects the window bounds", () => {
  const dayStart = at(2026, 8, 5, 0, 0);
  const start = offsetFractionToMillis(dayStart, 0, { windowStartHour: 6, windowEndHour: 18 });
  assert.equal(start, at(2026, 8, 5, 6, 0));
  const end = offsetFractionToMillis(dayStart, 1, { windowStartHour: 6, windowEndHour: 18 });
  assert.equal(end, at(2026, 8, 5, 18, 0));
  // 0.5 of a 12h window from 6am = noon
  const mid = offsetFractionToMillis(dayStart, 0.5, { windowStartHour: 6, windowEndHour: 18 });
  assert.equal(mid, at(2026, 8, 5, 12, 0));
});

check("buildDropDefaults: prefills date/start/tech from the drop, suggests (not fabricates authoritatively) an end", () => {
  const dayStart = at(2026, 8, 5, 0, 0);
  const defaults = buildDropDefaults({ dayStartMillis: dayStart, offsetFraction: 0.5, techId: "tech-1", windowStartHour: 6, windowEndHour: 18 });
  assert.equal(defaults.date, "2026-08-05");
  assert.equal(defaults.start, "12:00");
  assert.equal(defaults.techId, "tech-1");
  const startMs = at(2026, 8, 5, 12, 0);
  assert.equal(defaults.end, toTimeString(startMs + DEFAULT_SLOT_DURATION_MINUTES * 60000));
});

check("groupReadyQueueByPriority: buckets in priority order with a trailing Unspecified group, drops nothing", () => {
  const ready = [
    { id: "a", priority: 3 },
    { id: "b", priority: 1 },
    { id: "c", priority: undefined },
    { id: "d", priority: 1 },
    { id: "e", priority: 99 }, // unrecognized -> treated as unspecified, never guessed
  ];
  const groups = groupReadyQueueByPriority(ready);
  assert.deepEqual(groups.map((g) => g.label), ["Emergency", "Normal", "Unspecified priority"]);
  assert.equal(groups[0].items.length, 2); // b, d
  assert.equal(groups[1].items.length, 1); // a
  assert.equal(groups[2].items.length, 2); // c, e
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(totalItems, ready.length);
});

check("groupReadyQueueByPriority: empty input -> empty groups", () => {
  assert.deepEqual(groupReadyQueueByPriority([]), []);
  assert.deepEqual(groupReadyQueueByPriority(), []);
});

check("buildDayBoard: slices the weekly board down to one day, positions jobs, never drops unassigned/attention rows", () => {
  const monday = at(2026, 8, 3, 0, 0);
  const tech = { id: "t1", name: "Alex" };
  const workOrders = [
    { id: "wo1", woNumber: "WO-1", status: "SCHEDULED", scheduledStart: at(2026, 8, 3, 9, 0), scheduledEnd: at(2026, 8, 3, 10, 0), assignedTechId: "t1" },
    { id: "wo2", woNumber: "WO-2", status: "SCHEDULED", scheduledStart: at(2026, 8, 4, 9, 0), scheduledEnd: at(2026, 8, 4, 10, 0), assignedTechId: "t1" }, // different day
    { id: "wo3", woNumber: "WO-3", status: "READY_TO_DISPATCH", priority: 2 },
    { id: "wo4", woNumber: "WO-4", status: "SCHEDULED", scheduledStart: at(2026, 8, 3, 11, 0), scheduledEnd: at(2026, 8, 3, 12, 0), assignedTechId: "ghost-tech" }, // unassigned-scheduled
  ];

  const board = buildDayBoard({ workOrders, technicians: [tech], dayMillis: monday, nowMillis: monday });
  assert.equal(board.dayMillis, monday);
  assert.equal(board.technicianRows.length, 1);
  assert.equal(board.technicianRows[0].jobs.length, 1); // only wo1 (wo2 is a different day)
  assert.equal(board.technicianRows[0].jobs[0].id, "wo1");
  assert.ok(board.technicianRows[0].jobs[0].slot != null);
  assert.equal(board.unassignedScheduledToday.length, 1);
  assert.equal(board.unassignedScheduledToday[0].id, "wo4");
  assert.equal(board.readyToSchedule.length, 1);
  assert.equal(board.readyGroups.length, 1);
  assert.equal(board.readyGroups[0].label, "High");
  assert.equal(board.totals.scheduledToday, 2); // wo1 (row) + wo4 (unassigned)
});

check("buildDayBoard: a day outside the currently-loaded data still returns an empty, well-formed board", () => {
  const board = buildDayBoard({ workOrders: [], technicians: [{ id: "t1", name: "Alex" }], dayMillis: at(2026, 8, 3), nowMillis: at(2026, 8, 3) });
  assert.equal(board.technicianRows.length, 1);
  assert.equal(board.technicianRows[0].jobs.length, 0);
  assert.equal(board.readyToSchedule.length, 0);
  assert.equal(board.unassignedScheduledToday.length, 0);
});

check("buildHourTicks: spans the configured window inclusive of both ends", () => {
  const ticks = buildHourTicks(6, 8);
  assert.deepEqual(ticks.map((t) => t.hour), [6, 7, 8]);
  assert.equal(ticks[0].leftPct, 0);
  assert.equal(ticks[ticks.length - 1].leftPct, 100);
  assert.equal(ticks[0].label, "6 AM");
});

check("default window constants are the documented 6am-7pm display convention", () => {
  assert.equal(DAY_WINDOW_START_HOUR, 6);
  assert.equal(DAY_WINDOW_END_HOUR, 19);
});

console.log(`${passed} passed`);

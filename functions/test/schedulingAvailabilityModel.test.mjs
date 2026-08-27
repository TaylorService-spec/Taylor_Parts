// Dispatch & Scheduler -- unit tests for the pure availability model and its input validation.
//
// Neither module under test touches Firestore, so this is a plain node:test suite against the
// compiled lib/ output, matching this repo's pure-logic convention (transitionEngine.test.mjs,
// compactClaims.test.mjs).
//
// Prerequisite: `npm run build` in functions/ first.
//
// What this suite is FOR. ND-20's collision policy is a product decision, and a product decision
// that only exists in prose drifts. These assertions are where "blocked time refuses and working
// hours only warn" becomes falsifiable: invert either and a test goes red.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessWorkingHours,
  availableMinutesInWindow,
  blockedMinutesInWindow,
  findBlockedTimeConflict,
  localWallClock,
  minutesOutsideWorkingHours,
  normalizeIntervals,
  parseTimeOfDay,
  workingIntervalsFor,
} from "../lib/scheduling/availabilityModel.js";
import {
  MAX_WINDOW_MINUTES,
  parseEstimatedDurationMinutes,
  parseReason,
  parseScheduleWindow,
  validateBlockedTimeInput,
  validateWorkingAvailabilityInput,
  isUsableTimeZone,
} from "../lib/scheduling/validation.js";

const ZONE = "America/Phoenix"; // no daylight saving -- a stable baseline for the arithmetic tests
const DST_ZONE = "America/Denver"; // observes daylight saving -- used where that is the point

// 2026-08-27 is a Thursday (weekday 4).
const THURSDAY_0700_PHX = Date.UTC(2026, 7, 27, 14, 0); // 07:00 MST (UTC-7)
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const availability = (weeklyHours, timeZone = ZONE) => ({
  technicianId: "tech-1",
  timeZone,
  weeklyHours,
});

// ---------------------------------------------------------------------------------------------
// parseTimeOfDay
// ---------------------------------------------------------------------------------------------

test("parseTimeOfDay accepts valid 24-hour times and rejects everything else", () => {
  assert.equal(parseTimeOfDay("00:00"), 0);
  assert.equal(parseTimeOfDay("07:30"), 450);
  assert.equal(parseTimeOfDay("23:59"), 1439);

  for (const bad of ["24:00", "7:30", "07:60", "0730", "", "  ", null, undefined, 730, {}]) {
    assert.equal(parseTimeOfDay(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

// ---------------------------------------------------------------------------------------------
// localWallClock
// ---------------------------------------------------------------------------------------------

test("localWallClock places an instant on the right weekday and minute in its own zone", () => {
  const local = localWallClock(THURSDAY_0700_PHX, ZONE);
  assert.deepEqual(local, { weekday: 4, minutes: 7 * 60, dateKey: "2026-08-27" });
});

test("localWallClock returns null for an unusable zone rather than throwing", () => {
  assert.equal(localWallClock(THURSDAY_0700_PHX, "Not/AZone"), null);
  assert.equal(localWallClock(Number.NaN, ZONE), null);
});

test("localWallClock reads the same instant differently in two zones", () => {
  // The whole reason working hours are stored as wall-clock: 07:00 in Phoenix is 08:00 in Denver
  // during summer, and a technician's day should not move because a server did.
  assert.equal(localWallClock(THURSDAY_0700_PHX, ZONE).minutes, 7 * 60);
  assert.equal(localWallClock(THURSDAY_0700_PHX, DST_ZONE).minutes, 8 * 60);
});

// ---------------------------------------------------------------------------------------------
// normalizeIntervals
// ---------------------------------------------------------------------------------------------

test("normalizeIntervals sorts, merges touching intervals, and drops malformed ones", () => {
  assert.deepEqual(
    normalizeIntervals([
      { start: "13:00", end: "16:00" },
      { start: "07:00", end: "12:00" },
    ]),
    [
      { start: 420, end: 720 },
      { start: 780, end: 960 },
    ],
    "a real lunch gap must survive normalization",
  );

  assert.deepEqual(
    normalizeIntervals([
      { start: "07:00", end: "12:00" },
      { start: "12:00", end: "16:00" },
    ]),
    [{ start: 420, end: 960 }],
    "touching intervals leave no gap, so they merge",
  );

  assert.deepEqual(normalizeIntervals([{ start: "16:00", end: "07:00" }]), [], "a reversed interval is not working time");
  assert.deepEqual(normalizeIntervals([{ start: "bad", end: "16:00" }]), []);
  assert.deepEqual(normalizeIntervals(undefined), []);
  assert.deepEqual(normalizeIntervals("not an array"), []);
});

test("workingIntervalsFor returns nothing for an absent availability record or an unlisted weekday", () => {
  assert.deepEqual(workingIntervalsFor(null, 4), []);
  assert.deepEqual(workingIntervalsFor(availability({ 1: [{ start: "07:00", end: "16:00" }] }), 4), []);
});

// ---------------------------------------------------------------------------------------------
// minutesOutsideWorkingHours
// ---------------------------------------------------------------------------------------------

test("a placement fully inside working hours is zero minutes outside", () => {
  const record = availability({ 4: [{ start: "07:00", end: "16:00" }] });
  assert.equal(minutesOutsideWorkingHours(record, THURSDAY_0700_PHX, THURSDAY_0700_PHX + 2 * HOUR), 0);
});

test("a placement running past the end of the day counts only the minutes that spill", () => {
  const record = availability({ 4: [{ start: "07:00", end: "08:00" }] });
  // 07:00-09:00 against a 07:00-08:00 day: exactly one hour is outside.
  assert.equal(minutesOutsideWorkingHours(record, THURSDAY_0700_PHX, THURSDAY_0700_PHX + 2 * HOUR), 60);
});

test("a placement across the lunch gap counts the gap", () => {
  const record = availability({
    4: [
      { start: "07:00", end: "12:00" },
      { start: "13:00", end: "16:00" },
    ],
  });
  const noon = THURSDAY_0700_PHX + 5 * HOUR;
  assert.equal(minutesOutsideWorkingHours(record, noon - 30 * MINUTE, noon + 90 * MINUTE), 60);
});

test("a placement on a weekday with no recorded hours is entirely outside", () => {
  const record = availability({ 1: [{ start: "07:00", end: "16:00" }] }); // Monday only
  assert.equal(minutesOutsideWorkingHours(record, THURSDAY_0700_PHX, THURSDAY_0700_PHX + HOUR), 60);
});

test("minutesOutsideWorkingHours refuses to guess when the stored zone is unusable", () => {
  const record = availability({ 4: [{ start: "07:00", end: "16:00" }] }, "Not/AZone");
  assert.equal(minutesOutsideWorkingHours(record, THURSDAY_0700_PHX, THURSDAY_0700_PHX + HOUR), null);
});

// ---------------------------------------------------------------------------------------------
// assessWorkingHours -- the WARN half of ND-20
// ---------------------------------------------------------------------------------------------

test("an unrecorded schedule warns that it is unrecorded, never that the placement is outside hours", () => {
  // The distinction this asserts is the one that keeps every technician schedulable on the day this
  // collection ships and nobody has filled it in yet. Absent is not empty.
  const { warnings } = assessWorkingHours(null, THURSDAY_0700_PHX, THURSDAY_0700_PHX + HOUR);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "NO_WORKING_AVAILABILITY_RECORDED");
});

test("a placement inside recorded hours produces no warnings at all", () => {
  const record = availability({ 4: [{ start: "07:00", end: "16:00" }] });
  assert.deepEqual(assessWorkingHours(record, THURSDAY_0700_PHX, THURSDAY_0700_PHX + HOUR).warnings, []);
});

test("a placement outside recorded hours WARNS and does not refuse", () => {
  // ND-20: field service legitimately schedules emergency work outside working hours. If this ever
  // becomes a refusal, this assertion is where the change has to be made deliberately.
  const record = availability({ 4: [{ start: "07:00", end: "08:00" }] });
  const { warnings } = assessWorkingHours(record, THURSDAY_0700_PHX, THURSDAY_0700_PHX + 2 * HOUR);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "OUTSIDE_WORKING_HOURS");
  assert.match(warnings[0].detail, /60 minutes/);
});

// ---------------------------------------------------------------------------------------------
// findBlockedTimeConflict -- the REFUSE half
// ---------------------------------------------------------------------------------------------

const block = (startMillis, endMillis, kind = "PTO") => ({
  blockId: "b1",
  technicianId: "tech-1",
  kind,
  startMillis,
  endMillis,
});

test("blocked time overlapping the placement is found", () => {
  const conflict = findBlockedTimeConflict(
    [block(THURSDAY_0700_PHX + 30 * MINUTE, THURSDAY_0700_PHX + 90 * MINUTE)],
    THURSDAY_0700_PHX,
    THURSDAY_0700_PHX + HOUR,
  );
  assert.equal(conflict?.kind, "PTO");
});

test("back-to-back blocked time does not collide (half-open windows)", () => {
  // A block ending exactly when the job starts is not a conflict -- the same convention
  // findScheduleConflict already uses, so the two authorities agree at the seam.
  assert.equal(
    findBlockedTimeConflict([block(THURSDAY_0700_PHX - HOUR, THURSDAY_0700_PHX)], THURSDAY_0700_PHX, THURSDAY_0700_PHX + HOUR),
    null,
  );
  assert.equal(
    findBlockedTimeConflict([block(THURSDAY_0700_PHX + HOUR, THURSDAY_0700_PHX + 2 * HOUR)], THURSDAY_0700_PHX, THURSDAY_0700_PHX + HOUR),
    null,
  );
});

test("a block that encloses the placement conflicts, and a malformed block is ignored", () => {
  assert.ok(
    findBlockedTimeConflict(
      [block(THURSDAY_0700_PHX - HOUR, THURSDAY_0700_PHX + 5 * HOUR, "COMPANY_CLOSURE")],
      THURSDAY_0700_PHX,
      THURSDAY_0700_PHX + HOUR,
    ),
  );
  assert.equal(
    findBlockedTimeConflict([block(THURSDAY_0700_PHX + HOUR, THURSDAY_0700_PHX)], THURSDAY_0700_PHX, THURSDAY_0700_PHX + 5 * HOUR),
    null,
    "a reversed block is not an absence",
  );
});

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

test("available minutes counts only recorded working time in the window", () => {
  const record = availability({ 4: [{ start: "07:00", end: "16:00" }] });
  // Ask for 06:00-18:00 on the Thursday: nine recorded working hours fall inside it.
  const dayStart = THURSDAY_0700_PHX - HOUR;
  assert.equal(availableMinutesInWindow(record, { startMillis: dayStart, endMillis: dayStart + 12 * HOUR }), 9 * 60);
});

test("available minutes is null -- not zero -- when no schedule is recorded", () => {
  // The single most important assertion for the board: an unknown denominator is unanswerable, and
  // rendering it as 0% would report our data entry as though it were the business.
  assert.equal(availableMinutesInWindow(null, { startMillis: THURSDAY_0700_PHX, endMillis: THURSDAY_0700_PHX + HOUR }), null);
  assert.equal(blockedMinutesInWindow(null, [], { startMillis: THURSDAY_0700_PHX, endMillis: THURSDAY_0700_PHX + HOUR }), null);
});

test("blocked minutes counts only blocked time that lands inside working hours", () => {
  const record = availability({ 4: [{ start: "07:00", end: "09:00" }] });
  const window = { startMillis: THURSDAY_0700_PHX, endMillis: THURSDAY_0700_PHX + 4 * HOUR };
  // A three-hour block starting at 07:00 only overlaps two hours of recorded working time.
  assert.equal(blockedMinutesInWindow(record, [block(THURSDAY_0700_PHX, THURSDAY_0700_PHX + 3 * HOUR)], window), 120);
  // A block entirely outside working hours consumes no capacity.
  assert.equal(
    blockedMinutesInWindow(record, [block(THURSDAY_0700_PHX + 3 * HOUR, THURSDAY_0700_PHX + 4 * HOUR)], window),
    0,
  );
});

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

test("parseScheduleWindow accepts an ordered, bounded window and names every honest failure", () => {
  const ok = parseScheduleWindow({ scheduledStart: 1_000_000, scheduledEnd: 2_000_000 });
  assert.deepEqual(ok, { valid: true, value: { startMillis: 1_000_000, endMillis: 2_000_000 } });

  assert.equal(parseScheduleWindow({ scheduledStart: 2_000_000, scheduledEnd: 1_000_000 }).valid, false);
  assert.equal(parseScheduleWindow({ scheduledStart: 1_000, scheduledEnd: 1_000 }).valid, false, "zero length is not a window");
  assert.equal(parseScheduleWindow({ scheduledStart: "1000", scheduledEnd: 2000 }).valid, false);
  assert.equal(parseScheduleWindow({ scheduledStart: 1.5, scheduledEnd: 2000 }).valid, false);
  assert.equal(parseScheduleWindow(null).valid, false);
  assert.equal(
    parseScheduleWindow({ scheduledStart: 1_000_000, scheduledEnd: 1_000_000 + MAX_WINDOW_MINUTES * 60_000 + 1 }).valid,
    false,
    "an unbounded window would let a typo reserve a technician for a decade",
  );
});

test("parseReason requires a non-empty reason and trims it", () => {
  assert.deepEqual(parseReason("  emergency coverage  "), { valid: true, value: "emergency coverage" });
  assert.equal(parseReason("").valid, false);
  assert.equal(parseReason("   ").valid, false);
  assert.equal(parseReason(undefined).valid, false);
  assert.equal(parseReason("x".repeat(501)).valid, false);
});

test("the planning estimate is optional, and absent is not zero", () => {
  // ND-21: every Work Order written before this field existed has none, so absence must never be an
  // error, and clearing an estimate must be expressible.
  assert.deepEqual(parseEstimatedDurationMinutes(undefined), { valid: true, value: null });
  assert.deepEqual(parseEstimatedDurationMinutes(null), { valid: true, value: null });
  assert.deepEqual(parseEstimatedDurationMinutes(90), { valid: true, value: 90 });
  assert.equal(parseEstimatedDurationMinutes(0).valid, false, "zero minutes is not an estimate");
  assert.equal(parseEstimatedDurationMinutes(-5).valid, false);
  assert.equal(parseEstimatedDurationMinutes(1.5).valid, false);
  assert.equal(parseEstimatedDurationMinutes("90").valid, false);
});

test("isUsableTimeZone asks the runtime rather than pattern-matching", () => {
  assert.equal(isUsableTimeZone("America/Phoenix"), true);
  assert.equal(isUsableTimeZone("UTC"), true);
  assert.equal(isUsableTimeZone("Not/AZone"), false);
  assert.equal(isUsableTimeZone(""), false);
  assert.equal(isUsableTimeZone(null), false);
});

test("validateBlockedTimeInput accepts a governed kind and refuses everything else", () => {
  const ok = validateBlockedTimeInput({
    technicianId: "tech-1",
    kind: "PTO",
    startMillis: 1_000_000,
    endMillis: 2_000_000,
    note: "  annual leave  ",
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.note, "annual leave");

  assert.equal(validateBlockedTimeInput({ technicianId: "tech-1", kind: "VACATION", startMillis: 1, endMillis: 2 }).valid, false);
  assert.equal(validateBlockedTimeInput({ technicianId: "", kind: "PTO", startMillis: 1_000, endMillis: 2_000 }).valid, false);

  const reversed = validateBlockedTimeInput({ technicianId: "tech-1", kind: "PTO", startMillis: 2_000, endMillis: 1_000 });
  assert.equal(reversed.valid, false);
  assert.deepEqual(reversed.errors.map((e) => e.path), ["endMillis"], "the error must name the blocked-time field, not the schedule one");
});

test("validateWorkingAvailabilityInput refuses a reversed interval rather than silently dropping it", () => {
  // normalizeIntervals ignores a reversed interval so the READ path stays safe. Accepting one on the
  // WRITE path would store a record whose displayed hours and enforced hours differ -- the exact
  // disagreement this whole domain exists to prevent.
  const bad = validateWorkingAvailabilityInput({
    technicianId: "tech-1",
    timeZone: ZONE,
    weeklyHours: { 4: [{ start: "16:00", end: "07:00" }] },
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors[0].code, "end_not_after_start");
});

test("validateWorkingAvailabilityInput keeps an explicitly empty weekday", () => {
  // An explicitly non-working Sunday is a choice someone made. It is not the same as the weekday
  // being absent from an unrecorded schedule, and the write path must be able to express it.
  const ok = validateWorkingAvailabilityInput({
    technicianId: "tech-1",
    timeZone: ZONE,
    weeklyHours: { 0: [], 4: [{ start: "07:00", end: "16:00" }] },
  });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.value.weeklyHours["0"], []);
  assert.equal(ok.value.weeklyHours["4"].length, 1);
});

test("validateWorkingAvailabilityInput refuses a bad weekday key and a bad zone", () => {
  assert.equal(
    validateWorkingAvailabilityInput({ technicianId: "t", timeZone: ZONE, weeklyHours: { 7: [] } }).valid,
    false,
  );
  assert.equal(
    validateWorkingAvailabilityInput({ technicianId: "t", timeZone: "Not/AZone", weeklyHours: {} }).valid,
    false,
  );
  assert.equal(
    validateWorkingAvailabilityInput({ technicianId: "t", timeZone: ZONE, weeklyHours: [] }).valid,
    false,
    "an array is not a weekday map",
  );
});

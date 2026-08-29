/**
 * Sandbox Dispatch representative fixtures — the pure part.
 *
 * WHY THIS IS A SEPARATE MODULE. `seedSandboxTransactional.js` calls `main()` at import time and
 * needs a live project, so nothing in it can be unit-tested. These two facts decide what the Dispatch
 * board is able to draw, and getting either subtly wrong is invisible until someone opens the board
 * against a live estate — exactly how the previous defect survived. So they live here, importable,
 * and the seeder becomes the thin caller.
 *
 * No Firestore, no clock of its own, no `Timestamp` — the caller supplies the instant and wraps the
 * result. That is what makes the window arithmetic assertable.
 */
"use strict";

/**
 * The zone the sandbox's recorded shift is expressed in.
 *
 * Phoenix does not observe daylight saving, so a seeded 07:00–16:00 shift means the same thing in
 * March and in November. A fixture whose hours shifted twice a year would make every window
 * assertion seasonal, and the failure would look like a scheduling bug rather than a fixture one.
 */
const SANDBOX_TIMEZONE = "America/Phoenix";

/** Phoenix is UTC-7 year round. Stated once, because the whole point of the zone choice is that it never varies. */
const PHOENIX_UTC_OFFSET_HOURS = 7;

/** The recorded shift, as local wall-clock. Matches what a dispatcher would actually enter. */
const SANDBOX_SHIFT = Object.freeze({ start: "07:00", end: "16:00" });

/** Where the first placed Work Order sits inside that shift. Mid-morning, comfortably inside 07:00–16:00. */
const SCHEDULED_START_HOUR_LOCAL = 9;
const SCHEDULED_DURATION_HOURS = 2;

/**
 * A SECOND placement, on a different technician, at a different hour of the same day.
 *
 * ONE CHIP CANNOT PROVE THE BOARD DRAWS TIME. The Dispatch Quick Gate asserts that chip geometry
 * comes from the committed window rather than from row order, and the only observable difference is
 * that two chips sit at DIFFERENT left offsets — a single chip is consistent with a board that
 * places everything at 0%. So a representative day needs two placements, not one.
 *
 * Deliberately on the technician with NO recorded availability: it gives the board a placed job on an
 * unrecorded lane, which is a real combination a dispatcher sees and is different from the first
 * placement rather than a duplicate of it.
 */
const SECOND_START_HOUR_LOCAL = 13;
const SECOND_DURATION_HOURS = 1.5;

/** The calendar date `instantMillis` falls on, in `timeZone`. */
function localDateParts(instantMillis, timeZone = SANDBOX_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instantMillis));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The scheduled window for the representative Work Order: TOMORROW, 09:00–11:00 Phoenix time.
 *
 * Anchored to the run instant rather than pinned to a literal date, deliberately. A fixed calendar
 * date would drift into the past and the board would open on an empty day — the fixture would decay
 * into exactly the "nothing to draw" state it exists to prevent. `seedSandboxTransactional.js`
 * already takes this approach with `Timestamp.now()`; its determinism is in the ids and the
 * structure, not the clock.
 *
 * Returned as epoch millis so the caller wraps them in whatever Timestamp type it uses, and so this
 * function stays assertable without Firestore.
 */
/**
 * Day placements land on TOMORROW, not today.
 *
 * A 09:00 window seeded at three in the afternoon is already over before anyone opens the board —
 * the fixture would be "representative" of finished work on its first day of life. Tomorrow is
 * always ahead of the seed instant whatever hour it runs at, and the board navigates to the day of
 * the earliest scheduled work anyway, so nothing is lost by moving off today.
 *
 * Caught by the "no fixture is already in the past at seed time" assertion, which failed on the very
 * first run against a late-afternoon clock.
 */
const DAY_PLACEMENT_OFFSET_DAYS = 1;

function buildScheduledWindow(
  instantMillis,
  {
    startHourLocal = SCHEDULED_START_HOUR_LOCAL,
    durationHours = SCHEDULED_DURATION_HOURS,
    dayOffset = DAY_PLACEMENT_OFFSET_DAYS,
  } = {},
) {
  const parts = localDateParts(instantMillis);
  const { year, month } = parts;
  const day = parts.day + dayOffset;
  // Split into whole hours and minutes. `Date.UTC` coerces its hour argument to an integer, so
  // passing 18.5 silently yields 18:00 -- a half hour quietly lost, and one that no "is it outside
  // the band" assertion would ever notice. Caught while proving the outside-band fixture.
  const totalMinutes = Math.round((startHourLocal + PHOENIX_UTC_OFFSET_HOURS) * 60);
  const startMillis = Date.UTC(year, month - 1, day, 0, totalMinutes, 0, 0);
  return { startMillis, endMillis: startMillis + Math.round(durationHours * 3600_000) };
}

/** The second placement's window — same day, a different hour, so the two chips cannot coincide. */
function buildSecondScheduledWindow(instantMillis) {
  return buildScheduledWindow(instantMillis, {
    startHourLocal: SECOND_START_HOUR_LOCAL,
    durationHours: SECOND_DURATION_HOURS,
  });
}

/**
 * A placement OUTSIDE the board's default display band (07:00–17:00, dispatchBoardGeometry.js).
 *
 * 18:30–19:30 local. The board's band WIDENS to contain a placement that falls outside it rather
 * than clipping the chip away — that widening is the behaviour this fixture exists to make visible,
 * and it cannot be seen on an estate where every placement sits politely inside 07:00–17:00.
 *
 * It is also outside the seeded 07:00–16:00 recorded shift, so it is the ND-20 warning case standing
 * up as a real record: governed placement WARNS and ALLOWS. A dispatcher looking at the board should
 * see a legitimately placed evening job, not an error.
 *
 * ONE HONEST CAVEAT. The board computes its band with `new Date(...).getHours()` — the VIEWER's local
 * zone, not the fixture's. These windows are anchored in Phoenix, so "outside the band" is exact for
 * a viewer in Arizona and approximate for one several zones away. 18:30 is chosen over the 06:00
 * alternative partly for that reason: it has more margin before it slides back inside 07:00–17:00.
 */
const OUTSIDE_BAND_START_HOUR_LOCAL = 18.5;
const OUTSIDE_BAND_DURATION_HOURS = 1;

function buildOutsideBandWindow(instantMillis) {
  return buildScheduledWindow(instantMillis, {
    startHourLocal: OUTSIDE_BAND_START_HOUR_LOCAL,
    durationHours: OUTSIDE_BAND_DURATION_HOURS,
  });
}

/** 0 = Sunday … 6 = Saturday, matching Date.getDay() and the weeklyHours keys. */
const SATURDAY = 6;

/**
 * The first Saturday STRICTLY AFTER the run's local date.
 *
 * Deterministic from the supplied instant and independent of which weekday the seeder happens to run
 * on — seed it on a Monday and it lands on the coming Saturday; seed it on a Saturday and it lands on
 * the NEXT one, never today. That "strictly after" is what keeps the weekend fixture on its own day
 * instead of colliding with the weekday placements whenever the seeder is run at a weekend.
 *
 * Weekend work must prove the weekend cell appears at all. A board whose geometry quietly assumes
 * Monday–Friday would swallow a Saturday job, and no weekday-only fixture set can reveal that.
 */
const WEEKEND_START_HOUR_LOCAL = 9;
const WEEKEND_DURATION_HOURS = 1;

function buildWeekendWindow(instantMillis) {
  const { year, month, day } = localDateParts(instantMillis);
  // Weekday of the run's LOCAL date, computed in UTC on that date so no zone shifts the day.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  let daysAhead = (SATURDAY - weekday + 7) % 7;
  // Strictly after the DAY-PLACEMENT date (tomorrow), so the weekend fixture can never share a day
  // with the weekday placements no matter which weekday the seed runs on.
  while (daysAhead <= DAY_PLACEMENT_OFFSET_DAYS) daysAhead += 7;
  const startUtcHour = WEEKEND_START_HOUR_LOCAL + PHOENIX_UTC_OFFSET_HOURS;
  const startMillis = Date.UTC(year, month - 1, day + daysAhead, startUtcHour, 0, 0, 0);
  return { startMillis, endMillis: startMillis + WEEKEND_DURATION_HOURS * 3600_000 };
}

/**
 * The recurring working-availability record, in the canonical governed shape
 * (`functions/src/scheduling/types.ts`'s TechnicianWorkingAvailability): document id IS the
 * technicianId, weekday keys are the STRING form of 0–6, and hours are local wall-clock strings.
 *
 * All seven weekdays carry the shift so the board draws a real one whichever day it opens on.
 * Weekends are included for the same reason the weekly board renders them: work placed on a Saturday
 * must never become silently unrepresentable.
 *
 * `updatedAt` is deliberately NOT set here — it is a server Timestamp and belongs to the caller.
 */
function buildTechnicianAvailability({ technicianId, updatedByUid, scenarioId }) {
  return {
    technicianId,
    timeZone: SANDBOX_TIMEZONE,
    weeklyHours: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ start: SANDBOX_SHIFT.start, end: SANDBOX_SHIFT.end }]]),
    ),
    updatedByUid,
    scenarioId,
  };
}

module.exports = {
  SANDBOX_TIMEZONE,
  SANDBOX_SHIFT,
  SCHEDULED_START_HOUR_LOCAL,
  SCHEDULED_DURATION_HOURS,
  SECOND_START_HOUR_LOCAL,
  SECOND_DURATION_HOURS,
  OUTSIDE_BAND_START_HOUR_LOCAL,
  OUTSIDE_BAND_DURATION_HOURS,
  WEEKEND_START_HOUR_LOCAL,
  WEEKEND_DURATION_HOURS,
  SATURDAY,
  DAY_PLACEMENT_OFFSET_DAYS,
  PHOENIX_UTC_OFFSET_HOURS,
  localDateParts,
  buildScheduledWindow,
  buildSecondScheduledWindow,
  buildOutsideBandWindow,
  buildWeekendWindow,
  buildTechnicianAvailability,
};

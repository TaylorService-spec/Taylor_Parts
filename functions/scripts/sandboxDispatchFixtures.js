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

/** Where the placed Work Order sits inside that shift. Mid-morning, comfortably inside 07:00–16:00. */
const SCHEDULED_START_HOUR_LOCAL = 9;
const SCHEDULED_DURATION_HOURS = 2;

/** The calendar date `instantMillis` falls on, in `timeZone`. */
function localDateParts(instantMillis, timeZone = SANDBOX_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instantMillis));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The scheduled window for the representative Work Order: TODAY, 09:00–11:00 Phoenix time.
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
function buildScheduledWindow(instantMillis) {
  const { year, month, day } = localDateParts(instantMillis);
  const startUtcHour = SCHEDULED_START_HOUR_LOCAL + PHOENIX_UTC_OFFSET_HOURS;
  const startMillis = Date.UTC(year, month - 1, day, startUtcHour, 0, 0, 0);
  return { startMillis, endMillis: startMillis + SCHEDULED_DURATION_HOURS * 3600_000 };
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
  PHOENIX_UTC_OFFSET_HOURS,
  localDateParts,
  buildScheduledWindow,
  buildTechnicianAvailability,
};

// Dispatch & Scheduler -- the pure availability model. No Firestore, no clock, no throwing.
// Everything here is a function of its arguments, so the whole of ND-20's collision policy is
// unit-testable without an emulator.
//
// The one rule this file exists to keep: THE SAME RECORDS THAT DRAW A TECHNICIAN'S LANE MUST DECIDE
// WHETHER A SCHEDULE IS VALID. The Dispatch board and the scheduling commands both call these
// functions, over the same documents, so visual availability and enforced availability cannot
// disagree. A board that shaded time the server would happily book is the exact failure the build
// handoff names.

import type {
  SchedulingAssessment,
  SchedulingWarning,
  TechnicianBlockedTime,
  TechnicianWorkingAvailability,
  Weekday,
  WorkingInterval,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Wall-clock arithmetic
// ---------------------------------------------------------------------------------------------

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" -> minutes past local midnight, or null if it is not a valid 24-hour time. */
export function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_OF_DAY.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface LocalWallClock {
  weekday: Weekday;
  /** Minutes past local midnight. */
  minutes: number;
  /** "YYYY-MM-DD" in the target zone -- the identity of the local day this instant falls in. */
  dateKey: string;
}

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Where an absolute instant lands on a wall clock in `timeZone`.
 *
 * Uses Intl rather than a fixed UTC offset deliberately: a stored offset is correct for half the
 * year and silently wrong for the other half, which would shift every technician's working day by an
 * hour each March and November without anyone editing a record. Intl is in the Node runtime already,
 * so this costs no dependency.
 *
 * Returns null for an unusable zone rather than throwing -- an unparseable stored `timeZone` is a
 * data problem the caller reports as a warning, not a crash in the middle of a transaction.
 */
export function localWallClock(millis: number, timeZone: string): LocalWallClock | null {
  if (!Number.isFinite(millis)) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(millis));
  } catch {
    return null; // an invalid IANA zone
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[get("weekday")];
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (weekday === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    weekday,
    minutes: hour * 60 + minute,
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------------------------

interface MinuteInterval {
  start: number;
  end: number;
}

/** Valid intervals only, sorted and merged, so coverage below is a single forward walk. */
export function normalizeIntervals(intervals: readonly WorkingInterval[] | undefined): MinuteInterval[] {
  if (!Array.isArray(intervals)) return [];
  const parsed: MinuteInterval[] = [];
  for (const interval of intervals) {
    const start = parseTimeOfDay(interval?.start);
    const end = parseTimeOfDay(interval?.end);
    if (start === null || end === null || end <= start) continue; // a malformed interval is not working time
    parsed.push({ start, end });
  }
  parsed.sort((a, b) => a.start - b.start);

  const merged: MinuteInterval[] = [];
  for (const interval of parsed) {
    const last = merged[merged.length - 1];
    // Touching intervals (16:00 ends, 16:00 starts) merge: there is no gap between them, so a job
    // spanning the seam is not outside working hours.
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** The working intervals recorded for one weekday, normalized. */
export function workingIntervalsFor(
  availability: TechnicianWorkingAvailability | null | undefined,
  weekday: Weekday,
): MinuteInterval[] {
  if (!availability) return [];
  return normalizeIntervals(availability.weeklyHours?.[`${weekday}`]);
}

/**
 * How many minutes of [startMillis, endMillis) fall OUTSIDE the technician's recorded working hours.
 *
 * Walks the proposed window in local-day slices, so a window crossing local midnight is measured
 * against each day's own intervals rather than the first day's, and a DST transition inside the
 * window is handled by Intl rather than by arithmetic here. Returns null when the zone is unusable.
 *
 * Zero means fully inside. Anything above zero is a WARNING under ND-20, never a refusal.
 */
export function minutesOutsideWorkingHours(
  availability: TechnicianWorkingAvailability,
  startMillis: number,
  endMillis: number,
): number | null {
  if (!(endMillis > startMillis)) return 0;
  const zone = availability.timeZone;
  let outside = 0;

  // One minute at a time would be exact but wasteful; we instead step minute-by-minute over the
  // window in whole minutes, which for any realistic service call (hours, not weeks) is a handful of
  // hundred iterations. Bounded below so a nonsense window cannot spin.
  const totalMinutes = Math.ceil((endMillis - startMillis) / 60_000);
  if (totalMinutes > MAX_ASSESSABLE_MINUTES) return null; // too long to assess honestly; caller warns

  for (let i = 0; i < totalMinutes; i += 1) {
    const at = startMillis + i * 60_000;
    const local = localWallClock(at, zone);
    if (!local) return null;
    const intervals = workingIntervalsFor(availability, local.weekday);
    const covered = intervals.some((iv) => local.minutes >= iv.start && local.minutes < iv.end);
    if (!covered) outside += 1;
  }
  return outside;
}

// A month. Past this the minute walk stops being a sensible way to answer the question, and a window
// that long is not a service call anyway -- validation.ts refuses it before we get here. Kept as a
// second floor so this pure function can never be made to loop unboundedly by a malformed record.
export const MAX_ASSESSABLE_MINUTES = 60 * 24 * 31;

// ---------------------------------------------------------------------------------------------
// Blocked time
// ---------------------------------------------------------------------------------------------

/**
 * The first blocked-time record overlapping the proposed window, or null.
 *
 * Half-open overlap (`start < otherEnd && otherStart < end`) -- the same test
 * `workOrderAvailability.findScheduleConflict` already uses for Work Order windows, so back-to-back
 * placements never collide with each other on either authority.
 *
 * ONE CALLER, ONE QUESTION: does a proposed WORK window land in time a technician is unavailable?
 * `checkPlacement` asks it, and the answer refuses the placement.
 *
 * IT IS NOT A BLOCK-VS-BLOCK EXCLUSION RULE, and the Owner ruling of 2026-09-12 says so in terms:
 * OVERLAPPING BLOCKED-TIME FACTS ARE LEGITIMATE. A COMPANY_CLOSURE may cover a recurring LUNCH; PTO
 * may sit inside a closure; a training block may sit inside a broader closure. Each of those is a
 * real, separately-recorded fact about why the technician is away, and refusing the second one
 * (ND-25, now superseded) destroyed a fact the business actually holds.
 *
 * UNAVAILABLE TIME = UNION OF BLOCKED INTERVALS. Not the sum of their durations, and not "no two may
 * overlap". `mergeBlockedIntervals` below is that union, and every duration reader in this domain --
 * server and board alike -- goes through it.
 */
export function findBlockedTimeConflict(
  blocks: readonly TechnicianBlockedTime[],
  startMillis: number,
  endMillis: number,
): TechnicianBlockedTime | null {
  for (const block of blocks) {
    if (!block) continue;
    const { startMillis: blockStart, endMillis: blockEnd } = block;
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockEnd <= blockStart) continue;
    if (startMillis < blockEnd && blockStart < endMillis) return block;
  }
  return null;
}

/** An absolute-millis half-open interval. The shape the union below works in. */
export interface BlockedInterval {
  startMillis: number;
  endMillis: number;
}

/**
 * The UNION of a technician's blocked-time records, as disjoint half-open intervals in ascending
 * order. Malformed records (non-finite, or end <= start) are dropped rather than thrown on -- a bad
 * stored record is a data problem the caller reports, never a crash mid-transaction.
 *
 * THIS IS THE AVAILABILITY MODEL'S ONE DEFINITION OF "BLOCKED". The Owner ruling of 2026-09-12
 * fixed the semantics at the READER rather than at the write path: overlapping facts are legitimate,
 * so the arithmetic must stop double-counting them instead of the store refusing to hold them.
 *
 * Touching intervals MERGE (12:00 ends, 12:00 starts) -- there is no minute between them, so the
 * union is one interval. That is the same half-open convention `findBlockedTimeConflict` uses, which
 * is why back-to-back placements still do not collide: merging two ADJACENT absences into one span
 * of unavailable time changes no minute's answer to "is the technician available at t?".
 */
export function mergeBlockedIntervals(
  blocks: readonly (TechnicianBlockedTime | BlockedInterval | null | undefined)[] | undefined,
): BlockedInterval[] {
  if (!Array.isArray(blocks)) return [];
  const parsed: BlockedInterval[] = [];
  for (const block of blocks) {
    if (!block) continue;
    const { startMillis, endMillis } = block;
    if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis) || endMillis <= startMillis) continue;
    parsed.push({ startMillis, endMillis });
  }
  parsed.sort((a, b) => a.startMillis - b.startMillis);

  const merged: BlockedInterval[] = [];
  for (const interval of parsed) {
    const last = merged[merged.length - 1];
    if (last && interval.startMillis <= last.endMillis) {
      last.endMillis = Math.max(last.endMillis, interval.endMillis);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Blocked minutes inside [startMillis, endMillis), counted ONCE per minute however many records
 * cover it. The CALENDAR union -- no working-hours filter, because the board draws a lane's blocked
 * span whether or not the technician was rostered for it.
 *
 * `blockedMinutesInWindow` below is the CAPACITY union: the same union intersected with recorded
 * working hours, because a 03:00 closure takes no capacity from someone who does not work at 03:00.
 * Two questions, one union; the difference between them is the working-hours mask and nothing else.
 */
export function unionBlockedMinutesInRange(
  blocks: readonly (TechnicianBlockedTime | BlockedInterval | null | undefined)[] | undefined,
  range: { startMillis: number; endMillis: number },
): number {
  const { startMillis, endMillis } = range;
  if (!(endMillis > startMillis)) return 0;
  let total = 0;
  for (const interval of mergeBlockedIntervals(blocks)) {
    const from = Math.max(interval.startMillis, startMillis);
    const to = Math.min(interval.endMillis, endMillis);
    if (to > from) total += (to - from) / 60_000;
  }
  return Math.round(total);
}

/** Is `atMillis` covered by any blocked-time record? The union asked one minute at a time. */
export function isBlockedAt(
  merged: readonly BlockedInterval[],
  atMillis: number,
): boolean {
  for (const interval of merged) {
    if (atMillis >= interval.startMillis && atMillis < interval.endMillis) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The assessment
// ---------------------------------------------------------------------------------------------

/**
 * The WARNING half of ND-20. Refusals (blocked time, a past start, an ineligible technician, an
 * overlapping Work Order) are decided in the command, where the transactional reads live; this
 * function decides only what rides along with a successful schedule.
 *
 * `availability` being null means UNRECORDED, not empty -- it produces
 * `NO_WORKING_AVAILABILITY_RECORDED`, never `OUTSIDE_WORKING_HOURS`. The distinction matters: the
 * first says we do not know, the second says we know and this is outside. Collapsing them would
 * make every technician look permanently off-shift the day this collection ships and nobody has
 * filled it in yet.
 */
export function assessWorkingHours(
  availability: TechnicianWorkingAvailability | null | undefined,
  startMillis: number,
  endMillis: number,
): SchedulingAssessment {
  const warnings: SchedulingWarning[] = [];

  if (!availability) {
    warnings.push({
      code: "NO_WORKING_AVAILABILITY_RECORDED",
      detail: "No working schedule is recorded for this technician, so the placement could not be checked against one.",
    });
    return { warnings };
  }

  const outside = minutesOutsideWorkingHours(availability, startMillis, endMillis);
  if (outside === null) {
    warnings.push({
      code: "NO_WORKING_AVAILABILITY_RECORDED",
      detail: "This technician's working schedule could not be read, so the placement was not checked against it.",
    });
    return { warnings };
  }
  if (outside > 0) {
    warnings.push({
      code: "OUTSIDE_WORKING_HOURS",
      detail: `${outside} minute${outside === 1 ? "" : "s"} of this placement fall outside the technician's working hours.`,
    });
  }
  return { warnings };
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

export interface CapacityWindow {
  startMillis: number;
  endMillis: number;
}

/**
 * Total recorded working minutes in a window -- the DENOMINATOR of "percent booked", which did not
 * exist before this collection did.
 *
 * Returns null when the schedule is unrecorded. A caller must render that as "no working schedule
 * recorded" rather than 0%: dividing by an unknown is not the same as dividing by zero, and showing
 * a technician as 0% booked when nobody has entered their hours is a lie the board would tell every
 * day until someone did.
 */
export function availableMinutesInWindow(
  availability: TechnicianWorkingAvailability | null | undefined,
  window: CapacityWindow,
): number | null {
  if (!availability) return null;
  const { startMillis, endMillis } = window;
  if (!(endMillis > startMillis)) return 0;
  const totalMinutes = Math.ceil((endMillis - startMillis) / 60_000);
  if (totalMinutes > MAX_ASSESSABLE_MINUTES) return null;

  let available = 0;
  for (let i = 0; i < totalMinutes; i += 1) {
    const local = localWallClock(startMillis + i * 60_000, availability.timeZone);
    if (!local) return null;
    const intervals = workingIntervalsFor(availability, local.weekday);
    if (intervals.some((iv) => local.minutes >= iv.start && local.minutes < iv.end)) available += 1;
  }
  return available;
}

/**
 * Working minutes in a window that blocked time has already taken. Subtracting these is what makes
 * "available" mean genuinely available rather than merely rostered.
 *
 * THE UNION, INTERSECTED WITH RECORDED WORKING HOURS. A minute covered by a COMPANY_CLOSURE and a
 * LUNCH at once is one blocked minute, not two -- so two identical PTO records take the same eight
 * hours a single one does, and a closure straddling a lunch takes the closure's span, not the
 * closure plus the lunch. Runs through `mergeBlockedIntervals` so that is true by construction
 * rather than by the minute walk happening to be idempotent.
 */
export function blockedMinutesInWindow(
  availability: TechnicianWorkingAvailability | null | undefined,
  blocks: readonly TechnicianBlockedTime[],
  window: CapacityWindow,
): number | null {
  if (!availability) return null;
  const { startMillis, endMillis } = window;
  if (!(endMillis > startMillis)) return 0;
  const totalMinutes = Math.ceil((endMillis - startMillis) / 60_000);
  if (totalMinutes > MAX_ASSESSABLE_MINUTES) return null;

  const merged = mergeBlockedIntervals(blocks);
  let blocked = 0;
  for (let i = 0; i < totalMinutes; i += 1) {
    const at = startMillis + i * 60_000;
    const local = localWallClock(at, availability.timeZone);
    if (!local) return null;
    const intervals = workingIntervalsFor(availability, local.weekday);
    if (!intervals.some((iv) => local.minutes >= iv.start && local.minutes < iv.end)) continue;
    if (isBlockedAt(merged, at)) blocked += 1;
  }
  return blocked;
}

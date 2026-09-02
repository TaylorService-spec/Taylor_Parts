// REPORTING PERIOD RESOLVER -- the ONE place EOS decides what MTD, QTD, YTD and T12M mean, where a
// period begins and ends, and what a partial period is fairly compared against.
//
// G-05, Owner ruling 2026-09-02. This is a SHARED DOMAIN AUTHORITY. Dashboards, performance goals
// and reports all compose it. It is not dashboard helper logic, not goal-only logic, and not
// financial logic -- if it were any of those, the other two would grow their own copy, which is
// precisely the state this file replaces.
//
// ============================ THE THREE THINGS IT OWNS ============================
//
//   WHEN a period starts and ends, in the company's governed reporting timezone.
//   WHAT the honest comparison for an INCOMPLETE period is.
//   WHETHER a comparison is possible at all.
//
// It owns nothing else. In particular it does NOT decide what is being measured: G-05 defines WHEN,
// never WHAT. A metric with no governed definition stays blocked after this file exists, and a
// metric with no governed EVENT TIMESTAMP stays blocked too -- see `classifyEventTime`, which
// refuses rather than reaching for `createdAt`.
//
// ============================ BOUNDARIES: HALF-OPEN, AND WHY BOTH SHAPES ARE RETURNED ============================
//
// The Owner ruled start-INCLUSIVE, end-EXCLUSIVE: `start <= eventTime < end`. No 23:59:59.999
// arithmetic. That is the authority, and `startMillis`/`endExclusiveMillis` are it.
//
// But TWO shipped, tested contracts in this repository compare INCLUSIVELY, and neither is wrong:
//   * `finance/planVsActual.ts` compares ISO date STRINGS, `f.eventDate > window.periodEnd` excludes
//     -- so its periodEnd is the last day, inclusive.
//   * `finance/financialReportingRead.ts` compares millis, `eventMillis > periodEndMillis` excludes.
//
// Rewriting both to be exclusive would be a large, risky change to authorities the Owner did not
// ask to touch, in service of a boundary convention rather than a behaviour. So this resolver
// DERIVES the two inclusive shapes those consumers need from the ONE exclusive boundary it owns:
//
//     endExclusiveMillis        the authority
//     endInclusiveMillis        endExclusiveMillis - 1, for financialReportingRead
//     lastDayInclusiveIso       the reporting-local calendar day of endInclusiveMillis, for FIN-003
//
// There is still exactly one calculation. What there is not is three implementations of it, and a
// consumer that reaches for the shape it needs cannot silently disagree with one that reaches for
// another.
//
// ============================ TIMEZONE: Intl, NOT AN OFFSET ============================
//
// Boundaries are evaluated in the company's IANA reporting timezone via Intl, matching the pattern
// `scheduling/availabilityModel.ts` already proved: a STORED offset is right for half the year and
// silently wrong for the other half. Phoenix does not observe daylight saving, so today every
// boundary here would also be correct with a fixed -07:00 -- which is exactly why it is not written
// that way. The first operating company in a DST zone would otherwise shift every month boundary by
// an hour twice a year, and nobody would have edited anything.
//
// Storage stays UTC. Only the BOUNDARY is evaluated in the reporting zone.
//
// PURE. No Firestore, no ambient clock -- `asOfMillis` is always supplied by the caller.
import type { ReportingCalendar } from "./reportingCalendar";

export const PERIOD_TYPES = Object.freeze(["DAY", "MTD", "QTD", "YTD", "T12M"] as const);
export type PeriodType = (typeof PERIOD_TYPES)[number];

/**
 * PRIOR_FULL       -- the immediately preceding COMPLETE period of the same type.
 * PRIOR_COMPARABLE -- the equivalent ELAPSED portion of the preceding period. The default, because
 *                     an incomplete current period compared against a whole prior one is the single
 *                     most common way a dashboard lies about a trend.
 * NONE             -- no comparison requested.
 */
export const COMPARISON_MODES = Object.freeze(["NONE", "PRIOR_FULL", "PRIOR_COMPARABLE"] as const);
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

export class ReportingPeriodError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReportingPeriodError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Timezone primitives
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Where an absolute instant lands on the wall clock in `timeZone`. Throws only on an unusable zone. */
function zonedParts(millis: number, timeZone: string): ZonedParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(millis));
  } catch {
    throw new ReportingPeriodError("TIMEZONE_INVALID", `"${timeZone}" is not an IANA timezone this runtime knows`);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's UTC offset, in millis, AT a given instant. Positive east of Greenwich. */
function offsetMillisAt(millis: number, timeZone: string): number {
  const p = zonedParts(millis, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - millis;
}

/**
 * The absolute instant at which the given LOCAL calendar day begins in `timeZone`.
 *
 * Two passes, and the second is not defensive padding: the offset must be sampled at the instant
 * being converted, but that instant is what we are solving for. Guessing with UTC midnight's offset
 * and re-sampling at the candidate converges for every real zone, because a DST shift moves a
 * boundary by an hour, not by a day.
 *
 * Midnight is the one wall-clock time no IANA zone currently skips on a spring-forward (transitions
 * are at 01:00-03:00), so a nonexistent local midnight is not a case this has to resolve. If a zone
 * ever did skip it, this returns the instant just after the gap rather than a time that never
 * happened -- which is the safe direction: a period would start slightly late, never twice.
 */
function startOfLocalDayMillis(year: number, month: number, day: number, timeZone: string): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstGuess = wallAsUtc - offsetMillisAt(wallAsUtc, timeZone);
  const refined = wallAsUtc - offsetMillisAt(firstGuess, timeZone);
  return refined;
}

/**
 * The instant the day AFTER the given local day begins.
 *
 * Date.UTC normalises the roll-over itself -- 31 January + 1 is 1 February, 28 February + 1 in a
 * leap year is the 29th -- so month lengths and leap years are handled by the platform's own
 * calendar rather than by rules written here, which is the only way they stay right.
 */
function startOfNextLocalDayMillis(year: number, month: number, day: number, timeZone: string): number {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return startOfLocalDayMillis(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
}

/** Days in a Gregorian month. Leap years fall out of Date's own arithmetic rather than a rule here. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add months to a (year, month) pair, normalising across year boundaries. */
function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

/** `YYYY-MM-DD` for an instant, in the reporting zone. The shape FIN-003 compares. */
function localIsoDate(millis: number, timeZone: string): string {
  const p = zonedParts(millis, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

/**
 * Which reporting year and quarter a local calendar month falls in.
 *
 * Measured FROM the calendar's own start month, so a July-start company's July is reporting-month 1
 * of reporting-year N, and its January is reporting-month 7 of the SAME reporting year. No metric
 * has to know this; that is the point of the calendar being configuration.
 */
function reportingPosition(year: number, month: number, calendar: ReportingCalendar) {
  const offset = (month - calendar.reportingYearStartMonth + 12) % 12;
  const reportingYear = month >= calendar.reportingYearStartMonth ? year : year - 1;
  return { reportingYear, monthIndex: offset, quarterIndex: Math.floor(offset / 3) };
}

/** The first calendar month of the reporting year containing (year, month). */
function reportingYearStart(year: number, month: number, calendar: ReportingCalendar) {
  const { reportingYear } = reportingPosition(year, month, calendar);
  return { year: reportingYear, month: calendar.reportingYearStartMonth };
}

/** The first calendar month of the reporting quarter containing (year, month). */
function reportingQuarterStart(year: number, month: number, calendar: ReportingCalendar) {
  const { quarterIndex } = reportingPosition(year, month, calendar);
  const ys = reportingYearStart(year, month, calendar);
  return addMonths(ys.year, ys.month, quarterIndex * 3);
}

// ---------------------------------------------------------------------------
// The resolved window
// ---------------------------------------------------------------------------

export interface ReportingWindow {
  /** Inclusive. The authority. */
  readonly startMillis: number;
  /** EXCLUSIVE. The authority: `start <= eventTime < end`. */
  readonly endExclusiveMillis: number;
  /** DERIVED for `financialReportingRead`, which compares `eventMillis > periodEndMillis`. */
  readonly endInclusiveMillis: number;
  /** DERIVED for FIN-003 `planVsActual`, which compares ISO date strings inclusively. */
  readonly firstDayIso: string;
  readonly lastDayInclusiveIso: string;
}

export interface ReportingPeriodResolution {
  readonly current: ReportingWindow;
  /** Null when no comparison was requested, or when none is honestly possible. */
  readonly comparison: ReportingWindow | null;
  readonly metadata: {
    readonly periodType: PeriodType;
    readonly comparisonMode: ComparisonMode;
    /** True when the current period has not finished at `asOf`. */
    readonly isPartial: boolean;
    /** False when a comparison was asked for and could not be honestly formed. */
    readonly comparable: boolean;
    /** Present when `comparable` is false. Rendered verbatim; never turned into a zero. */
    readonly notComparableReason: string | null;
    readonly reportingTimeZone: string;
    readonly reportingYear: number;
    readonly reportingQuarter: number;
    /** Calendar days elapsed in the current period at `asOf`, inclusive of the current day. */
    readonly elapsedDays: number;
    /** Calendar days in the whole current period. Null for T12M, which is not a calendar period. */
    readonly totalDays: number | null;
    readonly asOfMillis: number;
  };
}

export interface ResolveReportingPeriodInput {
  calendar: ReportingCalendar;
  periodType: PeriodType;
  /** The instant the report is "as of". ALWAYS supplied -- this module owns no clock. */
  asOfMillis: number;
  comparisonMode?: ComparisonMode;
}

function windowFrom(startMillis: number, endExclusiveMillis: number, timeZone: string): ReportingWindow {
  return Object.freeze({
    startMillis,
    endExclusiveMillis,
    endInclusiveMillis: endExclusiveMillis - 1,
    firstDayIso: localIsoDate(startMillis, timeZone),
    lastDayInclusiveIso: localIsoDate(endExclusiveMillis - 1, timeZone),
  });
}

const MS_PER_DAY = 86_400_000;

/**
 * Calendar days from one local day to another, counted by CALENDAR DATE rather than by dividing
 * elapsed milliseconds.
 *
 * The division would be wrong by a day twice a year in any DST zone, because a 23- or 25-hour day
 * is still one day. Phoenix would never expose that; the next company would.
 */
function localDayNumber(millis: number, timeZone: string): number {
  const p = zonedParts(millis, timeZone);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY);
}

/**
 * THE resolver.
 *
 * @throws ReportingPeriodError on a malformed calendar, unknown period type, or non-finite asOf.
 *         A refusal, never a default: a period silently resolved from a bad calendar is a wrong
 *         number wearing a right label.
 */
export function resolveReportingPeriod(input: ResolveReportingPeriodInput): ReportingPeriodResolution {
  const calendar = input?.calendar;
  if (!calendar || typeof calendar.reportingTimeZone !== "string" || calendar.reportingTimeZone.length === 0) {
    throw new ReportingPeriodError("CALENDAR_REQUIRED", "a reporting calendar with an IANA timezone is required");
  }
  const startMonth = calendar.reportingYearStartMonth;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new ReportingPeriodError("CALENDAR_INVALID", "reportingYearStartMonth must be an integer 1-12");
  }
  if (!(PERIOD_TYPES as readonly string[]).includes(input.periodType)) {
    throw new ReportingPeriodError("PERIOD_TYPE_INVALID", `periodType must be one of ${PERIOD_TYPES.join("/")}`);
  }
  if (typeof input.asOfMillis !== "number" || !Number.isFinite(input.asOfMillis)) {
    throw new ReportingPeriodError("AS_OF_REQUIRED", "asOfMillis must be supplied as a finite instant -- this resolver owns no clock");
  }

  const tz = calendar.reportingTimeZone;
  const asOf = input.asOfMillis;
  const comparisonMode: ComparisonMode = (COMPARISON_MODES as readonly string[]).includes(input.comparisonMode ?? "NONE")
    ? ((input.comparisonMode ?? "NONE") as ComparisonMode)
    : "NONE";

  const at = zonedParts(asOf, tz);
  const pos = reportingPosition(at.year, at.month, calendar);

  // --- the current window -------------------------------------------------
  // Every period ends at the START OF THE DAY AFTER the as-of day, not at asOf itself. A window
  // that stopped mid-day would make two reads minutes apart return different totals for "today",
  // and a dashboard refreshed twice would show a figure moving with no event behind it.
  const endExclusive = startOfNextLocalDayMillis(at.year, at.month, at.day, tz);

  let periodStart: number;
  let totalDays: number | null;

  if (input.periodType === "DAY") {
    periodStart = startOfLocalDayMillis(at.year, at.month, at.day, tz);
    totalDays = 1;
  } else if (input.periodType === "MTD") {
    periodStart = startOfLocalDayMillis(at.year, at.month, 1, tz);
    totalDays = daysInMonth(at.year, at.month);
  } else if (input.periodType === "QTD") {
    const qs = reportingQuarterStart(at.year, at.month, calendar);
    periodStart = startOfLocalDayMillis(qs.year, qs.month, 1, tz);
    const qEnd = addMonths(qs.year, qs.month, 3);
    totalDays = Math.round((startOfLocalDayMillis(qEnd.year, qEnd.month, 1, tz) - periodStart) / MS_PER_DAY);
  } else if (input.periodType === "YTD") {
    const ys = reportingYearStart(at.year, at.month, calendar);
    periodStart = startOfLocalDayMillis(ys.year, ys.month, 1, tz);
    const yEnd = addMonths(ys.year, ys.month, 12);
    totalDays = Math.round((startOfLocalDayMillis(yEnd.year, yEnd.month, 1, tz) - periodStart) / MS_PER_DAY);
  } else {
    // T12M -- a ROLLING period, and deliberately not fiscal YTD. The twelve calendar months ending
    // at asOf: it starts on the same day-of-month twelve months back, so it always covers twelve
    // months regardless of where the reporting year begins. Clamped where the start month is short
    // (29 Feb twelve months back from a non-leap year lands on 28 Feb, not 1 March).
    const back = addMonths(at.year, at.month, -12);
    const clampedDay = Math.min(at.day, daysInMonth(back.year, back.month));
    periodStart = startOfLocalDayMillis(back.year, back.month, clampedDay, tz);
    totalDays = null; // not a calendar period; it has no "whole" to be a portion of
  }

  const current = windowFrom(periodStart, endExclusive, tz);
  const elapsedDays = localDayNumber(asOf, tz) - localDayNumber(periodStart, tz) + 1;
  const isPartial = totalDays === null ? false : elapsedDays < totalDays;

  // --- the comparison -----------------------------------------------------
  let comparison: ReportingWindow | null = null;
  let comparable = comparisonMode === "NONE";
  let notComparableReason: string | null = null;

  if (comparisonMode !== "NONE") {
    const prior = resolvePriorWindow(input.periodType, calendar, at, elapsedDays, comparisonMode, tz);
    if (prior.window) {
      comparison = prior.window;
      comparable = true;
    } else {
      comparable = false;
      notComparableReason = prior.reason;
    }
  }

  return Object.freeze({
    current,
    comparison,
    metadata: Object.freeze({
      periodType: input.periodType,
      comparisonMode,
      isPartial,
      comparable,
      notComparableReason,
      reportingTimeZone: tz,
      reportingYear: pos.reportingYear,
      reportingQuarter: pos.quarterIndex + 1,
      elapsedDays,
      totalDays,
      asOfMillis: asOf,
    }),
  });
}

/**
 * The preceding period to compare against.
 *
 * PRIOR_COMPARABLE is the rule that matters, and it is the Owner's: an INCOMPLETE current period is
 * compared only against the equivalent ELAPSED portion of the preceding one. Sep 1-22 against
 * Aug 1-22, never Sep 1-22 against the whole of August. Comparing 22 days of activity against 31
 * would report a collapse every month, in every business, forever.
 *
 * The elapsed portion is measured in CALENDAR DAYS from the prior period's own start, which is what
 * makes month-length differences fall out rather than needing a rule: day 22 of February is 22 days
 * from 1 February, exactly as day 22 of March is 22 days from 1 March.
 *
 * CLAMPING is the one place a judgement is made. Asking for day 31 of a 30-day prior month has no
 * equivalent date, so the prior window is clamped to the end of that month rather than spilling into
 * the next one. That is a shorter comparison window, which is stated (`isPartial` on the current
 * side, and the caller can see both spans) rather than hidden -- spilling would silently include a
 * day that belongs to a different month.
 */
function resolvePriorWindow(
  periodType: PeriodType,
  calendar: ReportingCalendar,
  at: ZonedParts,
  elapsedDays: number,
  mode: ComparisonMode,
  tz: string,
): { window: ReportingWindow | null; reason: string | null } {
  if (periodType === "T12M") {
    // A rolling twelve months has no "preceding period" that is not simply the twelve months before
    // it -- which overlaps nothing and is a different question. Refused rather than invented.
    return {
      window: null,
      reason: "A rolling twelve-month window has no preceding period of the same kind to compare against.",
    };
  }

  let priorStartY: number;
  let priorStartM: number;
  let priorStartD = 1;
  let priorTotalDays: number;

  if (periodType === "DAY") {
    const prev = new Date(Date.UTC(at.year, at.month - 1, at.day - 1));
    priorStartY = prev.getUTCFullYear();
    priorStartM = prev.getUTCMonth() + 1;
    priorStartD = prev.getUTCDate();
    priorTotalDays = 1;
  } else if (periodType === "MTD") {
    const prev = addMonths(at.year, at.month, -1);
    priorStartY = prev.year;
    priorStartM = prev.month;
    priorTotalDays = daysInMonth(prev.year, prev.month);
  } else if (periodType === "QTD") {
    const qs = reportingQuarterStart(at.year, at.month, calendar);
    const prev = addMonths(qs.year, qs.month, -3);
    priorStartY = prev.year;
    priorStartM = prev.month;
    const prevEnd = addMonths(prev.year, prev.month, 3);
    priorTotalDays = Math.round(
      (startOfLocalDayMillis(prevEnd.year, prevEnd.month, 1, tz) - startOfLocalDayMillis(prev.year, prev.month, 1, tz)) / MS_PER_DAY,
    );
  } else {
    const ys = reportingYearStart(at.year, at.month, calendar);
    const prev = addMonths(ys.year, ys.month, -12);
    priorStartY = prev.year;
    priorStartM = prev.month;
    const prevEnd = addMonths(prev.year, prev.month, 12);
    priorTotalDays = Math.round(
      (startOfLocalDayMillis(prevEnd.year, prevEnd.month, 1, tz) - startOfLocalDayMillis(prev.year, prev.month, 1, tz)) / MS_PER_DAY,
    );
  }

  const priorStart = startOfLocalDayMillis(priorStartY, priorStartM, priorStartD, tz);
  const spanDays = mode === "PRIOR_FULL" ? priorTotalDays : Math.min(elapsedDays, priorTotalDays);
  if (spanDays <= 0) {
    return { window: null, reason: "The preceding period supplies no comparable interval." };
  }

  // End = the start of the day AFTER the last day in the span, keeping the same half-open shape.
  const endDay = new Date(Date.UTC(priorStartY, priorStartM - 1, priorStartD + spanDays));
  const priorEndExclusive = startOfLocalDayMillis(
    endDay.getUTCFullYear(),
    endDay.getUTCMonth() + 1,
    endDay.getUTCDate(),
    tz,
  );

  return { window: windowFrom(priorStart, priorEndExclusive, tz), reason: null };
}

// ---------------------------------------------------------------------------
// Event-time attribution
// ---------------------------------------------------------------------------

/**
 * Does this fact carry a GOVERNED business event time for period attribution?
 *
 * G-05 §14, and the reason this function refuses instead of falling back: `createdAt` and
 * `updatedAt` exist on nearly every record, so a resolver that reached for one would make every
 * metric appear period-attributable while silently attributing invoices to the day someone opened a
 * form. The caller supplies the governed timestamp for the fact being measured -- `bookedAtMillis`
 * for booked, `eventAtMillis` for billed, `recordedAtMillis` for collected, `completedAt` for a
 * finished Work Order -- or the metric stays unavailable.
 *
 * G-05 does not manufacture a metric's event authority. It only refuses to pretend one exists.
 */
export function classifyEventTime(eventMillis: unknown): { usable: boolean; reason: string | null } {
  if (typeof eventMillis === "number" && Number.isFinite(eventMillis)) {
    return { usable: true, reason: null };
  }
  return {
    usable: false,
    reason:
      "This fact carries no governed business event time, so it cannot be attributed to a reporting period. A creation or update timestamp is not a substitute.",
  };
}

/** Is an instant inside a window? The half-open comparison, expressed once. */
export function windowContains(window: ReportingWindow, eventMillis: number): boolean {
  return eventMillis >= window.startMillis && eventMillis < window.endExclusiveMillis;
}

/**
 * Goal pacing: how far through the period we are, in CALENDAR days -- G-05 §13.
 *
 * "Day 22 of 31". A metric may NOT silently switch this to weekdays, working days or scheduled
 * employee days: each of those is a different denominator requiring its own governed authority, and
 * none exists. A metric that needs business-day pacing must declare it, not assume it.
 *
 * Returns null for a period with no calendar whole (T12M), where "how far through" has no meaning.
 */
export function pacing(resolution: ReportingPeriodResolution): { elapsedDays: number; totalDays: number; fraction: number } | null {
  const { elapsedDays, totalDays } = resolution.metadata;
  if (totalDays === null || totalDays <= 0) return null;
  return { elapsedDays, totalDays, fraction: Math.min(1, elapsedDays / totalDays) };
}

// REPORTING PERIOD AUTHORITY — the client mirror of functions/src/reportingPeriod/* (G-05,
// Decision #163).
//
// TWO FILES, ONE BEHAVIOUR. There is no shared-module tooling in this repository, so the trusted
// port (TypeScript, compiled to functions/lib) and this one are different files. They are NOT
// claimed to be byte-identical; they are held to identical observable results by
// functions/test/reportingPeriodParity.test.mjs over a fixture corpus, which is the same discipline
// equipmentCompatibilityDomainParity already applies to the D1/D2 contract.
//
// WHY THE CLIENT NEEDS IT AT ALL. Decision #161 says a dashboard composes existing domain authority
// and never invents its own. A reporting boundary computed from the browser's timezone IS an
// invented authority: it would put a Phoenix invoice dated the 1st outside "this month" for a user
// in Auckland, with no record of the disagreement anywhere. The alternative — a callable round trip
// for pure arithmetic on every render — buys nothing and costs a network hop per tile.
//
// WHAT THIS REPLACES. `financialsPeriod.js` computed MTD/QTD/YTD/T12M in browser-local time across
// six live Financials screens. It keeps its preset vocabulary and its UI; the arithmetic moves here.
//
// PURE. No clock of its own — every caller supplies `asOfMillis`.

export const REPORTING_PERIOD_TYPES = Object.freeze(["DAY", "MTD", "QTD", "YTD", "T12M"]);
export const REPORTING_COMPARISON_MODES = Object.freeze(["NONE", "PRIOR_FULL", "PRIOR_COMPARABLE"]);

/** The Taylor / Ventana reporting basis. Owner ruling G-05; mirrors the trusted calendar authority. */
export const TAYLOR_VENTANA_REPORTING_CALENDAR = Object.freeze({
  reportingTimeZone: "America/Phoenix",
  reportingYearStartMonth: 1,
});

export class ReportingPeriodError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReportingPeriodError";
    this.code = code;
  }
}

// --- timezone primitives ---------------------------------------------------

function zonedParts(millis, timeZone) {
  let parts;
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
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function offsetMillisAt(millis, timeZone) {
  const p = zonedParts(millis, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - millis;
}

/** The instant a local calendar day begins. Two passes: the offset must be sampled at the instant
 *  being solved for, and a DST shift moves a boundary by an hour rather than by a day. */
function startOfLocalDayMillis(year, month, day, timeZone) {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstGuess = wallAsUtc - offsetMillisAt(wallAsUtc, timeZone);
  return wallAsUtc - offsetMillisAt(firstGuess, timeZone);
}

function startOfNextLocalDayMillis(year, month, day, timeZone) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return startOfLocalDayMillis(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
}

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function addMonths(year, month, delta) {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

function localIsoDate(millis, timeZone) {
  const p = zonedParts(millis, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

const MS_PER_DAY = 86_400_000;
function localDayNumber(millis, timeZone) {
  const p = zonedParts(millis, timeZone);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY);
}

// --- calendar arithmetic ---------------------------------------------------

function reportingPosition(year, month, calendar) {
  const offset = (month - calendar.reportingYearStartMonth + 12) % 12;
  const reportingYear = month >= calendar.reportingYearStartMonth ? year : year - 1;
  return { reportingYear, monthIndex: offset, quarterIndex: Math.floor(offset / 3) };
}

function reportingYearStart(year, month, calendar) {
  const { reportingYear } = reportingPosition(year, month, calendar);
  return { year: reportingYear, month: calendar.reportingYearStartMonth };
}

function reportingQuarterStart(year, month, calendar) {
  const { quarterIndex } = reportingPosition(year, month, calendar);
  const ys = reportingYearStart(year, month, calendar);
  return addMonths(ys.year, ys.month, quarterIndex * 3);
}

function windowFrom(startMillis, endExclusiveMillis, timeZone) {
  return Object.freeze({
    startMillis,
    endExclusiveMillis,
    endInclusiveMillis: endExclusiveMillis - 1,
    firstDayIso: localIsoDate(startMillis, timeZone),
    lastDayInclusiveIso: localIsoDate(endExclusiveMillis - 1, timeZone),
  });
}

function resolvePriorWindow(periodType, calendar, at, elapsedDays, mode, tz) {
  if (periodType === "T12M") {
    return { window: null, reason: "A rolling twelve-month window has no preceding period of the same kind to compare against." };
  }
  let priorStartY;
  let priorStartM;
  let priorStartD = 1;
  let priorTotalDays;

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
    priorTotalDays = Math.round((startOfLocalDayMillis(prevEnd.year, prevEnd.month, 1, tz) - startOfLocalDayMillis(prev.year, prev.month, 1, tz)) / MS_PER_DAY);
  } else {
    const ys = reportingYearStart(at.year, at.month, calendar);
    const prev = addMonths(ys.year, ys.month, -12);
    priorStartY = prev.year;
    priorStartM = prev.month;
    const prevEnd = addMonths(prev.year, prev.month, 12);
    priorTotalDays = Math.round((startOfLocalDayMillis(prevEnd.year, prevEnd.month, 1, tz) - startOfLocalDayMillis(prev.year, prev.month, 1, tz)) / MS_PER_DAY);
  }

  const priorStart = startOfLocalDayMillis(priorStartY, priorStartM, priorStartD, tz);
  const spanDays = mode === "PRIOR_FULL" ? priorTotalDays : Math.min(elapsedDays, priorTotalDays);
  if (spanDays <= 0) return { window: null, reason: "The preceding period supplies no comparable interval." };

  const endDay = new Date(Date.UTC(priorStartY, priorStartM - 1, priorStartD + spanDays));
  const priorEndExclusive = startOfLocalDayMillis(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), tz);
  return { window: windowFrom(priorStart, priorEndExclusive, tz), reason: null };
}

/**
 * THE resolver — mirror of the trusted one. See that file's header for the reasoning behind
 * half-open boundaries, the two derived inclusive shapes, and the partial-period comparison rule.
 */
export function resolveReportingPeriod(input) {
  const calendar = input?.calendar;
  if (!calendar || typeof calendar.reportingTimeZone !== "string" || calendar.reportingTimeZone.length === 0) {
    throw new ReportingPeriodError("CALENDAR_REQUIRED", "a reporting calendar with an IANA timezone is required");
  }
  const startMonth = calendar.reportingYearStartMonth;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new ReportingPeriodError("CALENDAR_INVALID", "reportingYearStartMonth must be an integer 1-12");
  }
  if (!REPORTING_PERIOD_TYPES.includes(input.periodType)) {
    throw new ReportingPeriodError("PERIOD_TYPE_INVALID", `periodType must be one of ${REPORTING_PERIOD_TYPES.join("/")}`);
  }
  if (typeof input.asOfMillis !== "number" || !Number.isFinite(input.asOfMillis)) {
    throw new ReportingPeriodError("AS_OF_REQUIRED", "asOfMillis must be supplied as a finite instant -- this resolver owns no clock");
  }

  const tz = calendar.reportingTimeZone;
  const asOf = input.asOfMillis;
  const comparisonMode = REPORTING_COMPARISON_MODES.includes(input.comparisonMode ?? "NONE") ? (input.comparisonMode ?? "NONE") : "NONE";

  const at = zonedParts(asOf, tz);
  const pos = reportingPosition(at.year, at.month, calendar);
  const endExclusive = startOfNextLocalDayMillis(at.year, at.month, at.day, tz);

  let periodStart;
  let totalDays;

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
    const back = addMonths(at.year, at.month, -12);
    const clampedDay = Math.min(at.day, daysInMonth(back.year, back.month));
    periodStart = startOfLocalDayMillis(back.year, back.month, clampedDay, tz);
    totalDays = null;
  }

  const current = windowFrom(periodStart, endExclusive, tz);
  // The whole period, derived from the SAME start and day count as the current window.
  let fullPeriod = null;
  if (totalDays !== null) {
    const probe = zonedParts(periodStart + totalDays * MS_PER_DAY + 12 * 3_600_000, tz);
    fullPeriod = windowFrom(periodStart, startOfLocalDayMillis(probe.year, probe.month, probe.day, tz), tz);
  }
  const elapsedDays = localDayNumber(asOf, tz) - localDayNumber(periodStart, tz) + 1;
  const isPartial = totalDays === null ? false : elapsedDays < totalDays;

  let comparison = null;
  let comparable = comparisonMode === "NONE";
  let notComparableReason = null;
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
    fullPeriod,
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

/** Is an instant inside a window? The half-open comparison, expressed once. */
export function windowContains(window, eventMillis) {
  return eventMillis >= window.startMillis && eventMillis < window.endExclusiveMillis;
}

/** Goal pacing: calendar days, never weekdays. Null where the period has no calendar whole. */
export function pacing(resolution) {
  const { elapsedDays, totalDays } = resolution.metadata;
  if (totalDays === null || totalDays <= 0) return null;
  return { elapsedDays, totalDays, fraction: Math.min(1, elapsedDays / totalDays) };
}

/**
 * The reporting-local calendar day of an instant — the ONE way a surface asks "what day is it for
 * the business", replacing `new Date().toISOString().slice(0,10)` and `setHours(0,0,0,0)`.
 */
export function reportingDayIso(asOfMillis, calendar = TAYLOR_VENTANA_REPORTING_CALENDAR) {
  return localIsoDate(asOfMillis, calendar.reportingTimeZone);
}

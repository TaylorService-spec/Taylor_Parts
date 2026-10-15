"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportingPeriodError = exports.COMPARISON_MODES = exports.PERIOD_TYPES = void 0;
exports.resolveReportingPeriod = resolveReportingPeriod;
exports.classifyEventTime = classifyEventTime;
exports.windowContains = windowContains;
exports.pacing = pacing;
exports.PERIOD_TYPES = Object.freeze(["DAY", "MTD", "QTD", "YTD", "T12M"]);
/**
 * PRIOR_FULL       -- the immediately preceding COMPLETE period of the same type.
 * PRIOR_COMPARABLE -- the equivalent ELAPSED portion of the preceding period. The default, because
 *                     an incomplete current period compared against a whole prior one is the single
 *                     most common way a dashboard lies about a trend.
 * NONE             -- no comparison requested.
 */
exports.COMPARISON_MODES = Object.freeze(["NONE", "PRIOR_FULL", "PRIOR_COMPARABLE"]);
class ReportingPeriodError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "ReportingPeriodError";
        this.code = code;
    }
}
exports.ReportingPeriodError = ReportingPeriodError;
/** Where an absolute instant lands on the wall clock in `timeZone`. Throws only on an unusable zone. */
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
    }
    catch {
        throw new ReportingPeriodError("TIMEZONE_INVALID", `"${timeZone}" is not an IANA timezone this runtime knows`);
    }
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
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
function offsetMillisAt(millis, timeZone) {
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
function startOfLocalDayMillis(year, month, day, timeZone) {
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
function startOfNextLocalDayMillis(year, month, day, timeZone) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return startOfLocalDayMillis(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
}
/** Days in a Gregorian month. Leap years fall out of Date's own arithmetic rather than a rule here. */
function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** Add months to a (year, month) pair, normalising across year boundaries. */
function addMonths(year, month, delta) {
    const zero = year * 12 + (month - 1) + delta;
    return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}
/** `YYYY-MM-DD` for an instant, in the reporting zone. The shape FIN-003 compares. */
function localIsoDate(millis, timeZone) {
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
function reportingPosition(year, month, calendar) {
    const offset = (month - calendar.reportingYearStartMonth + 12) % 12;
    const reportingYear = month >= calendar.reportingYearStartMonth ? year : year - 1;
    return { reportingYear, monthIndex: offset, quarterIndex: Math.floor(offset / 3) };
}
/** The first calendar month of the reporting year containing (year, month). */
function reportingYearStart(year, month, calendar) {
    const { reportingYear } = reportingPosition(year, month, calendar);
    return { year: reportingYear, month: calendar.reportingYearStartMonth };
}
/** The first calendar month of the reporting quarter containing (year, month). */
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
const MS_PER_DAY = 86_400_000;
/**
 * Calendar days from one local day to another, counted by CALENDAR DATE rather than by dividing
 * elapsed milliseconds.
 *
 * The division would be wrong by a day twice a year in any DST zone, because a 23- or 25-hour day
 * is still one day. Phoenix would never expose that; the next company would.
 */
function localDayNumber(millis, timeZone) {
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
function resolveReportingPeriod(input) {
    const calendar = input?.calendar;
    if (!calendar || typeof calendar.reportingTimeZone !== "string" || calendar.reportingTimeZone.length === 0) {
        throw new ReportingPeriodError("CALENDAR_REQUIRED", "a reporting calendar with an IANA timezone is required");
    }
    const startMonth = calendar.reportingYearStartMonth;
    if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
        throw new ReportingPeriodError("CALENDAR_INVALID", "reportingYearStartMonth must be an integer 1-12");
    }
    if (!exports.PERIOD_TYPES.includes(input.periodType)) {
        throw new ReportingPeriodError("PERIOD_TYPE_INVALID", `periodType must be one of ${exports.PERIOD_TYPES.join("/")}`);
    }
    if (typeof input.asOfMillis !== "number" || !Number.isFinite(input.asOfMillis)) {
        throw new ReportingPeriodError("AS_OF_REQUIRED", "asOfMillis must be supplied as a finite instant -- this resolver owns no clock");
    }
    const tz = calendar.reportingTimeZone;
    const asOf = input.asOfMillis;
    const comparisonMode = exports.COMPARISON_MODES.includes(input.comparisonMode ?? "NONE")
        ? (input.comparisonMode ?? "NONE")
        : "NONE";
    const at = zonedParts(asOf, tz);
    const pos = reportingPosition(at.year, at.month, calendar);
    // --- the current window -------------------------------------------------
    // Every period ends at the START OF THE DAY AFTER the as-of day, not at asOf itself. A window
    // that stopped mid-day would make two reads minutes apart return different totals for "today",
    // and a dashboard refreshed twice would show a figure moving with no event behind it.
    const endExclusive = startOfNextLocalDayMillis(at.year, at.month, at.day, tz);
    let periodStart;
    let totalDays;
    if (input.periodType === "DAY") {
        periodStart = startOfLocalDayMillis(at.year, at.month, at.day, tz);
        totalDays = 1;
    }
    else if (input.periodType === "MTD") {
        periodStart = startOfLocalDayMillis(at.year, at.month, 1, tz);
        totalDays = daysInMonth(at.year, at.month);
    }
    else if (input.periodType === "QTD") {
        const qs = reportingQuarterStart(at.year, at.month, calendar);
        periodStart = startOfLocalDayMillis(qs.year, qs.month, 1, tz);
        const qEnd = addMonths(qs.year, qs.month, 3);
        totalDays = Math.round((startOfLocalDayMillis(qEnd.year, qEnd.month, 1, tz) - periodStart) / MS_PER_DAY);
    }
    else if (input.periodType === "YTD") {
        const ys = reportingYearStart(at.year, at.month, calendar);
        periodStart = startOfLocalDayMillis(ys.year, ys.month, 1, tz);
        const yEnd = addMonths(ys.year, ys.month, 12);
        totalDays = Math.round((startOfLocalDayMillis(yEnd.year, yEnd.month, 1, tz) - periodStart) / MS_PER_DAY);
    }
    else {
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
    // The whole period, derived from the SAME start and the SAME day count the current window used --
    // so a full-period window and a to-date window can never disagree about where the period begins.
    const fullPeriod = totalDays === null
        ? null
        : windowFrom(periodStart, startOfLocalDayMillis(...((() => {
            const d = new Date(periodStart + totalDays * MS_PER_DAY + 12 * 3_600_000);
            const p = zonedParts(d.getTime(), tz);
            return [p.year, p.month, p.day];
        })()), tz), tz);
    const elapsedDays = localDayNumber(asOf, tz) - localDayNumber(periodStart, tz) + 1;
    const isPartial = totalDays === null ? false : elapsedDays < totalDays;
    // --- the comparison -----------------------------------------------------
    let comparison = null;
    let comparable = comparisonMode === "NONE";
    let notComparableReason = null;
    if (comparisonMode !== "NONE") {
        const prior = resolvePriorWindow(input.periodType, calendar, at, elapsedDays, comparisonMode, tz);
        if (prior.window) {
            comparison = prior.window;
            comparable = true;
        }
        else {
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
function resolvePriorWindow(periodType, calendar, at, elapsedDays, mode, tz) {
    if (periodType === "T12M") {
        // A rolling twelve months has no "preceding period" that is not simply the twelve months before
        // it -- which overlaps nothing and is a different question. Refused rather than invented.
        return {
            window: null,
            reason: "A rolling twelve-month window has no preceding period of the same kind to compare against.",
        };
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
    }
    else if (periodType === "MTD") {
        const prev = addMonths(at.year, at.month, -1);
        priorStartY = prev.year;
        priorStartM = prev.month;
        priorTotalDays = daysInMonth(prev.year, prev.month);
    }
    else if (periodType === "QTD") {
        const qs = reportingQuarterStart(at.year, at.month, calendar);
        const prev = addMonths(qs.year, qs.month, -3);
        priorStartY = prev.year;
        priorStartM = prev.month;
        const prevEnd = addMonths(prev.year, prev.month, 3);
        priorTotalDays = Math.round((startOfLocalDayMillis(prevEnd.year, prevEnd.month, 1, tz) - startOfLocalDayMillis(prev.year, prev.month, 1, tz)) / MS_PER_DAY);
    }
    else {
        const ys = reportingYearStart(at.year, at.month, calendar);
        const prev = addMonths(ys.year, ys.month, -12);
        priorStartY = prev.year;
        priorStartM = prev.month;
        const prevEnd = addMonths(prev.year, prev.month, 12);
        priorTotalDays = Math.round((startOfLocalDayMillis(prevEnd.year, prevEnd.month, 1, tz) - startOfLocalDayMillis(prev.year, prev.month, 1, tz)) / MS_PER_DAY);
    }
    const priorStart = startOfLocalDayMillis(priorStartY, priorStartM, priorStartD, tz);
    const spanDays = mode === "PRIOR_FULL" ? priorTotalDays : Math.min(elapsedDays, priorTotalDays);
    if (spanDays <= 0) {
        return { window: null, reason: "The preceding period supplies no comparable interval." };
    }
    // End = the start of the day AFTER the last day in the span, keeping the same half-open shape.
    const endDay = new Date(Date.UTC(priorStartY, priorStartM - 1, priorStartD + spanDays));
    const priorEndExclusive = startOfLocalDayMillis(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), tz);
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
function classifyEventTime(eventMillis) {
    if (typeof eventMillis === "number" && Number.isFinite(eventMillis)) {
        return { usable: true, reason: null };
    }
    return {
        usable: false,
        reason: "This fact carries no governed business event time, so it cannot be attributed to a reporting period. A creation or update timestamp is not a substitute.",
    };
}
/** Is an instant inside a window? The half-open comparison, expressed once. */
function windowContains(window, eventMillis) {
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
function pacing(resolution) {
    const { elapsedDays, totalDays } = resolution.metadata;
    if (totalDays === null || totalDays <= 0)
        return null;
    return { elapsedDays, totalDays, fraction: Math.min(1, elapsedDays / totalDays) };
}
//# sourceMappingURL=reportingPeriod.js.map
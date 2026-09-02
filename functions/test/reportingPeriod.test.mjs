// REPORTING PERIOD AUTHORITY (G-05) -- exact boundaries, not snapshots.
//
// Pure (no emulator, no network, no ambient clock). Prerequisite: npm run build.
//   node --test test/reportingPeriod.test.mjs
//
// Every assertion below names an exact instant or an exact ISO date. A snapshot test here would
// pass while the boundary was an hour wrong, which is precisely the failure this authority exists
// to make impossible.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveReportingPeriod,
  classifyEventTime,
  windowContains,
  pacing,
  PERIOD_TYPES,
  ReportingPeriodError,
} from "../lib/reportingPeriod/reportingPeriod.js";
import {
  TAYLOR_VENTANA_REPORTING_CALENDAR,
  resolveReportingCalendar,
  resolveSharedReportingCalendar,
} from "../lib/reportingPeriod/reportingCalendar.js";

const PHX = TAYLOR_VENTANA_REPORTING_CALENDAR; // America/Phoenix, reporting year starts January
const DST = Object.freeze({ reportingTimeZone: "America/Denver", reportingYearStartMonth: 1 });
const JULY = Object.freeze({ reportingTimeZone: "America/Phoenix", reportingYearStartMonth: 7 });

/** An instant, expressed as a Phoenix wall-clock time. Phoenix is UTC-7 all year (no DST). */
const phx = (iso) => Date.parse(`${iso}-07:00`);

const resolve = (over = {}) =>
  resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: phx("2026-09-22T14:30:00"), ...over });

// ===========================================================================
// TIMEZONE — boundaries are the reporting zone's, not the machine's
// ===========================================================================

test("a period begins at local midnight in the REPORTING zone, not UTC and not the host", () => {
  const r = resolve({ periodType: "MTD" });
  // 1 September 2026, 00:00:00 in Phoenix == 07:00 UTC.
  assert.equal(r.current.startMillis, Date.parse("2026-09-01T07:00:00Z"));
  assert.equal(r.current.firstDayIso, "2026-09-01");
  assert.equal(r.metadata.reportingTimeZone, "America/Phoenix");
});

test("an instant late on the last local day is INSIDE the period; the next local midnight is OUT", () => {
  const r = resolve({ periodType: "MTD" });
  assert.equal(windowContains(r.current, phx("2026-09-22T23:59:59.999")), true);
  assert.equal(windowContains(r.current, phx("2026-09-23T00:00:00.000")), false);
  // The exclusive end IS the next local midnight -- 23 Sep 00:00 Phoenix == 07:00 UTC.
  assert.equal(r.current.endExclusiveMillis, Date.parse("2026-09-23T07:00:00Z"));
});

test("a DST zone's day boundary moves with the offset -- proof this is not a fixed offset", () => {
  // Denver is UTC-7 in winter and UTC-6 in summer. Phoenix would never expose the difference, which
  // is exactly why the assertion uses a zone that does: a fixed-offset implementation passes every
  // Phoenix test in this file and fails both of these.
  const winter = resolveReportingPeriod({ calendar: DST, periodType: "DAY", asOfMillis: Date.parse("2026-01-15T19:00:00Z") });
  assert.equal(winter.current.startMillis, Date.parse("2026-01-15T07:00:00Z"), "MST, UTC-7");

  const summer = resolveReportingPeriod({ calendar: DST, periodType: "DAY", asOfMillis: Date.parse("2026-07-15T19:00:00Z") });
  assert.equal(summer.current.startMillis, Date.parse("2026-07-15T06:00:00Z"), "MDT, UTC-6");
});

test("a spring-forward day is 23 hours long and still counts as ONE day", () => {
  // 8 March 2026, Denver springs forward at 02:00. The day is 23 hours. A resolver dividing elapsed
  // milliseconds by 86,400,000 would report the month one day short from here to the end of March.
  const r = resolveReportingPeriod({ calendar: DST, periodType: "MTD", asOfMillis: Date.parse("2026-03-09T18:00:00Z") });
  assert.equal(r.metadata.elapsedDays, 9, "1-9 March inclusive is nine calendar days, not 8.96");
  const day = resolveReportingPeriod({ calendar: DST, periodType: "DAY", asOfMillis: Date.parse("2026-03-08T18:00:00Z") });
  assert.equal(day.current.endExclusiveMillis - day.current.startMillis, 23 * 3_600_000);
});

test("an unusable timezone is refused, never defaulted", () => {
  assert.throws(
    () => resolveReportingPeriod({ calendar: { reportingTimeZone: "Mars/Olympus", reportingYearStartMonth: 1 }, periodType: "MTD", asOfMillis: Date.now() }),
    (e) => { assert.equal(e.code, "TIMEZONE_INVALID"); return true; },
  );
});

// ===========================================================================
// PERIOD DEFINITIONS
// ===========================================================================

test("MTD runs from the first of the reporting month to the end of the as-of day", () => {
  const r = resolve({ periodType: "MTD" });
  assert.equal(r.current.firstDayIso, "2026-09-01");
  assert.equal(r.current.lastDayInclusiveIso, "2026-09-22");
  assert.equal(r.metadata.elapsedDays, 22);
  assert.equal(r.metadata.totalDays, 30, "September");
  assert.equal(r.metadata.isPartial, true);
});

test("QTD runs from the first day of the reporting quarter", () => {
  const r = resolve({ periodType: "QTD" });
  assert.equal(r.current.firstDayIso, "2026-07-01", "September is in Q3 of a January-start year");
  assert.equal(r.current.lastDayInclusiveIso, "2026-09-22");
  assert.equal(r.metadata.reportingQuarter, 3);
  assert.equal(r.metadata.totalDays, 92, "Jul 31 + Aug 31 + Sep 30");
});

test("YTD runs from the first day of the reporting year", () => {
  const r = resolve({ periodType: "YTD" });
  assert.equal(r.current.firstDayIso, "2026-01-01");
  assert.equal(r.current.lastDayInclusiveIso, "2026-09-22");
  assert.equal(r.metadata.reportingYear, 2026);
  assert.equal(r.metadata.totalDays, 365, "2026 is not a leap year");
});

test("T12M is ROLLING, and is not fiscal YTD", () => {
  const r = resolve({ periodType: "T12M" });
  assert.equal(r.current.firstDayIso, "2025-09-22", "twelve calendar months back from the as-of day");
  assert.equal(r.current.lastDayInclusiveIso, "2026-09-22");
  assert.notEqual(r.current.firstDayIso, "2026-01-01", "if these were equal, T12M would have become YTD");
  assert.equal(r.metadata.totalDays, null, "a rolling window is not a portion of a calendar whole");
  assert.equal(r.metadata.isPartial, false);
  assert.equal(pacing(r), null, "there is no 'how far through' a rolling window");
});

test("DAY is one local day", () => {
  const r = resolve({ periodType: "DAY" });
  assert.equal(r.current.firstDayIso, "2026-09-22");
  assert.equal(r.current.lastDayInclusiveIso, "2026-09-22");
  assert.equal(r.metadata.totalDays, 1);
  assert.equal(r.current.endExclusiveMillis - r.current.startMillis, 86_400_000, "Phoenix has no DST");
});

test("a non-January reporting year shifts the year and quarter without any metric knowing", () => {
  // A July-start company: September is reporting-month 3, i.e. Q1 of reporting year 2026.
  const r = resolveReportingPeriod({ calendar: JULY, periodType: "QTD", asOfMillis: phx("2026-09-22T14:30:00") });
  assert.equal(r.current.firstDayIso, "2026-07-01");
  assert.equal(r.metadata.reportingQuarter, 1);
  assert.equal(r.metadata.reportingYear, 2026);

  // And its January belongs to the SAME reporting year, not the next one.
  const jan = resolveReportingPeriod({ calendar: JULY, periodType: "YTD", asOfMillis: phx("2027-01-15T12:00:00") });
  assert.equal(jan.current.firstDayIso, "2026-07-01");
  assert.equal(jan.metadata.reportingYear, 2026);
});

// ===========================================================================
// BOUNDARIES — half-open, and the two derived shapes existing authorities need
// ===========================================================================

test("the authority is half-open, and the inclusive shapes are DERIVED from it", () => {
  const r = resolve({ periodType: "MTD" });
  assert.equal(r.current.endInclusiveMillis, r.current.endExclusiveMillis - 1);
  // The inclusive millis is the last millisecond of the last local day -- the exact value
  // financialReportingRead's `eventMillis > periodEndMillis` needs to keep that day's records.
  assert.equal(r.current.endInclusiveMillis, phx("2026-09-22T23:59:59.999"));
  // And the ISO date is the shape FIN-003 compares as a string.
  assert.equal(r.current.lastDayInclusiveIso, "2026-09-22");
});

test("no period boundary is ever 23:59:59.999 arithmetic -- it is derived, once", () => {
  for (const periodType of PERIOD_TYPES) {
    const r = resolve({ periodType });
    assert.equal(r.current.endExclusiveMillis % 1000, 0, `${periodType} end must be a clean local midnight`);
    assert.equal(r.current.endInclusiveMillis % 1000, 999, `${periodType} inclusive end is exclusive minus one`);
  }
});

// ===========================================================================
// COMPARISON — the partial-period rule
// ===========================================================================

test("Sep 1-22 compares against Aug 1-22, NOT against all of August", () => {
  // The Owner's worked example, and the single most common way a dashboard lies about a trend:
  // 22 days of activity against 31 reports a collapse every month, in every business, forever.
  const r = resolve({ periodType: "MTD", comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(r.comparison.firstDayIso, "2026-08-01");
  assert.equal(r.comparison.lastDayInclusiveIso, "2026-08-22");
  assert.equal(r.metadata.comparable, true);
  assert.equal(r.metadata.isPartial, true);
});

test("PRIOR_FULL compares against the whole preceding period, when that is what was asked for", () => {
  const r = resolve({ periodType: "MTD", comparisonMode: "PRIOR_FULL" });
  assert.equal(r.comparison.firstDayIso, "2026-08-01");
  assert.equal(r.comparison.lastDayInclusiveIso, "2026-08-31");
});

test("a COMPLETE period compares against the whole preceding one under either mode", () => {
  // 30 September: the month is over, so the elapsed portion IS the whole month.
  const r = resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: phx("2026-09-30T23:00:00"), comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(r.metadata.isPartial, false);
  assert.equal(r.metadata.elapsedDays, 30);
  assert.equal(r.comparison.firstDayIso, "2026-08-01");
  assert.equal(r.comparison.lastDayInclusiveIso, "2026-08-30", "30 elapsed days of August, matching September's 30");
});

test("month-length differences need no rule -- day N is N days from the first, both sides", () => {
  // 31 March against February: the prior month has only 28 days, so the comparison CLAMPS to
  // 28 February rather than spilling into March, which would include a day from a different month.
  const r = resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: phx("2026-03-31T12:00:00"), comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(r.metadata.elapsedDays, 31);
  assert.equal(r.comparison.firstDayIso, "2026-02-01");
  assert.equal(r.comparison.lastDayInclusiveIso, "2026-02-28", "clamped to the end of February, never 1-3 March");
});

test("a leap day is a real day on both sides", () => {
  // 2024 was a leap year. 29 February exists, and MTD on it is 29 elapsed days.
  const leap = resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: phx("2024-02-29T12:00:00"), comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(leap.metadata.elapsedDays, 29);
  assert.equal(leap.metadata.totalDays, 29, "February 2024");
  assert.equal(leap.metadata.isPartial, false);
  assert.equal(leap.comparison.firstDayIso, "2024-01-01");
  assert.equal(leap.comparison.lastDayInclusiveIso, "2024-01-29");

  // And T12M from 29 February clamps twelve months back to 28 February, not 1 March.
  const rolling = resolveReportingPeriod({ calendar: PHX, periodType: "T12M", asOfMillis: phx("2024-02-29T12:00:00") });
  assert.equal(rolling.current.firstDayIso, "2023-02-28");
});

test("the first day of a period compares against the first day of the prior one", () => {
  for (const [asOf, type, priorFirst, priorLast] of [
    ["2026-09-01T09:00:00", "MTD", "2026-08-01", "2026-08-01"],
    ["2026-07-01T09:00:00", "QTD", "2026-04-01", "2026-04-01"],
    ["2026-01-01T09:00:00", "YTD", "2025-01-01", "2025-01-01"],
  ]) {
    const r = resolveReportingPeriod({ calendar: PHX, periodType: type, asOfMillis: phx(asOf), comparisonMode: "PRIOR_COMPARABLE" });
    assert.equal(r.metadata.elapsedDays, 1, `${type} on its first day is one elapsed day`);
    assert.equal(r.comparison.firstDayIso, priorFirst);
    assert.equal(r.comparison.lastDayInclusiveIso, priorLast, `${type} day 1 vs prior day 1`);
  }
});

test("a partial QUARTER compares against the equivalent elapsed portion of the prior quarter", () => {
  const r = resolve({ periodType: "QTD", comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(r.metadata.elapsedDays, 84, "1 Jul - 22 Sep");
  assert.equal(r.comparison.firstDayIso, "2026-04-01");
  assert.equal(r.comparison.lastDayInclusiveIso, "2026-06-23", "84 elapsed days of Q2");
});

test("a partial YEAR compares against the equivalent elapsed portion of the prior year", () => {
  const r = resolve({ periodType: "YTD", comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(r.metadata.elapsedDays, 265);
  assert.equal(r.comparison.firstDayIso, "2025-01-01");
  assert.equal(r.comparison.lastDayInclusiveIso, "2025-09-22");
});

test("NO COMPARABLE PERIOD is stated, never rendered as zero", () => {
  // T12M has no preceding period of the same kind. The resolution says so and supplies no window --
  // there is no number here for a caller to accidentally read as "flat".
  const r = resolve({ periodType: "T12M", comparisonMode: "PRIOR_COMPARABLE" });
  assert.equal(r.comparison, null);
  assert.equal(r.metadata.comparable, false);
  assert.match(r.metadata.notComparableReason, /no preceding period/i);
});

test("asking for NO comparison is not the same as failing to find one", () => {
  const none = resolve({ comparisonMode: "NONE" });
  assert.equal(none.comparison, null);
  assert.equal(none.metadata.comparable, true, "nothing was asked for, so nothing failed");
  assert.equal(none.metadata.notComparableReason, null);
});

// ===========================================================================
// AS-OF
// ===========================================================================

test("asOf is required and is never taken from an ambient clock", () => {
  for (const bad of [undefined, null, Number.NaN, Infinity, "2026-09-22"]) {
    assert.throws(
      () => resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: bad }),
      (e) => { assert.equal(e.code, "AS_OF_REQUIRED"); return true; },
    );
  }
});

test("the same asOf always yields the same window -- historical reporting is reproducible", () => {
  const a = resolve({ periodType: "QTD", comparisonMode: "PRIOR_COMPARABLE" });
  const b = resolve({ periodType: "QTD", comparisonMode: "PRIOR_COMPARABLE" });
  assert.deepEqual(a.current, b.current);
  assert.deepEqual(a.comparison, b.comparison);
  assert.equal(a.metadata.asOfMillis, phx("2026-09-22T14:30:00"));
});

test("the window ends at the END of the as-of day, so two reads minutes apart agree", () => {
  const morning = resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: phx("2026-09-22T08:00:00") });
  const evening = resolveReportingPeriod({ calendar: PHX, periodType: "MTD", asOfMillis: phx("2026-09-22T20:00:00") });
  assert.equal(morning.current.endExclusiveMillis, evening.current.endExclusiveMillis);
  // A window that stopped at asOf itself would make a figure move with no event behind it.
});

// ===========================================================================
// PACING
// ===========================================================================

test("pacing is CALENDAR days -- day 22 of 30, never weekdays", () => {
  const p = pacing(resolve({ periodType: "MTD" }));
  assert.deepEqual({ elapsedDays: p.elapsedDays, totalDays: p.totalDays }, { elapsedDays: 22, totalDays: 30 });
  // 22 of 30 calendar days. A weekday denominator would be ~16 of 22 and would silently rebase
  // every goal in the platform; it needs its own governed authority, which does not exist.
  assert.ok(Math.abs(p.fraction - 22 / 30) < 1e-9);
});

test("pacing never exceeds 1, even past the end of a period", () => {
  const p = pacing(resolveReportingPeriod({ calendar: PHX, periodType: "DAY", asOfMillis: phx("2026-09-22T23:59:59") }));
  assert.equal(p.fraction, 1);
});

// ===========================================================================
// EVENT ATTRIBUTION — G-05 defines WHEN, never WHAT
// ===========================================================================

test("a fact with no governed event time is refused, and createdAt is not offered as a fallback", () => {
  assert.equal(classifyEventTime(1_756_000_000_000).usable, true);
  for (const missing of [undefined, null, Number.NaN, "2026-09-22", {}]) {
    const c = classifyEventTime(missing);
    assert.equal(c.usable, false);
    assert.match(c.reason, /not a substitute/i, "the refusal must say why, and name the trap");
  }
});

test("the resolver exposes no way to supply a fallback event time", () => {
  // Structural, not behavioural: if this ever fails, someone has added the fallback G-05 forbids.
  const src = classifyEventTime.toString();
  assert.ok(!/createdAt|updatedAt/.test(src.replace(/"[^"]*"/g, "")), "no createdAt fallback in code");
});

// ===========================================================================
// CALENDAR CONFIGURATION
// ===========================================================================

test("Taylor and Ventana share America/Phoenix and a January reporting year", () => {
  for (const id of ["taylor", "ventana"]) {
    const r = resolveReportingCalendar(id);
    assert.equal(r.state, "RESOLVED");
    assert.equal(r.calendar.reportingTimeZone, "America/Phoenix");
    assert.equal(r.calendar.reportingYearStartMonth, 1);
  }
});

test("an unknown company gets no calendar -- absence is not a default", () => {
  for (const bad of ["acme", "", null, undefined, 7]) {
    const r = resolveReportingCalendar(bad);
    assert.equal(r.state, "UNKNOWN_COMPANY");
    assert.equal(r.calendar, null);
  }
});

test("a consolidated scope resolves only when its companies share a calendar", () => {
  const both = resolveSharedReportingCalendar(["taylor", "ventana"]);
  assert.equal(both.state, "RESOLVED");
  assert.equal(both.calendar.reportingTimeZone, "America/Phoenix");

  assert.equal(resolveSharedReportingCalendar([]).state, "UNKNOWN_COMPANY");
  assert.equal(resolveSharedReportingCalendar(["taylor", "acme"]).state, "UNKNOWN_COMPANY");
});

test("why incompatible calendars must refuse: the SAME months are a different quarter", () => {
  // Taylor and Ventana share a calendar today, so no live data can exercise the refusal. This
  // instead proves the HARM it prevents, which is the durable part: under a January-start calendar
  // September sits in Q3, and under a July-start calendar the identical months are Q1. Summing two
  // companies' "this quarter" across that difference is not a consolidated figure -- it is two
  // different questions added together, and nothing downstream could tell.
  const january = { reportingTimeZone: "America/Phoenix", reportingYearStartMonth: 1 };
  const july = { reportingTimeZone: "America/Phoenix", reportingYearStartMonth: 7 };
  const asOfMillis = phx("2026-09-22T12:00:00");

  const qJan = resolveReportingPeriod({ calendar: january, periodType: "QTD", asOfMillis });
  const qJul = resolveReportingPeriod({ calendar: july, periodType: "QTD", asOfMillis });

  assert.equal(qJan.metadata.reportingQuarter, 3);
  assert.equal(qJul.metadata.reportingQuarter, 1, "the same instant, a different quarter number");

  // The YEAR windows differ outright -- this is the span that would actually be summed.
  const yJan = resolveReportingPeriod({ calendar: january, periodType: "YTD", asOfMillis });
  const yJul = resolveReportingPeriod({ calendar: july, periodType: "YTD", asOfMillis });
  assert.equal(yJan.current.firstDayIso, "2026-01-01");
  assert.equal(yJul.current.firstDayIso, "2026-07-01");
  assert.notEqual(yJan.current.startMillis, yJul.current.startMillis);
});

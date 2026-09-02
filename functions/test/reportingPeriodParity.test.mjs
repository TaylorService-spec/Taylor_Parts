// REPORTING PERIOD — behavioural parity between the trusted port and the client mirror.
//
// Prerequisite: npm run build.
//   node --test test/reportingPeriodParity.test.mjs
//
// `functions/src/reportingPeriod/reportingPeriod.ts` (compiled to ../lib) and
// `field-ops-app-vite/src/domain/reportingPeriod.js` are DIFFERENT FILES — TypeScript and
// JavaScript, no shared-module tooling in this repository. This test does not claim they are
// byte-identical, and a finite corpus does not prove equivalence for every input. It asserts
// IDENTICAL OBSERVABLE RESULTS across the cases that would actually diverge: every period type,
// both comparison modes, month-length and leap-year edges, year and quarter boundaries, a
// non-January reporting calendar, and a DST-observing timezone.
//
// The discipline is the one equipmentCompatibilityDomainParity already applies to the D1/D2
// contract. It matters more here than for most mirrors: a divergence would put a dashboard tile and
// the goal it is measured against on opposite sides of a month boundary, and neither screen would
// say anything was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as SERVER from "../lib/reportingPeriod/reportingPeriod.js";
import { TAYLOR_VENTANA_REPORTING_CALENDAR as SERVER_CAL } from "../lib/reportingPeriod/reportingCalendar.js";
import * as CLIENT from "../../field-ops-app-vite/src/domain/reportingPeriod.js";

const J = (v) => JSON.stringify(v);

const CALENDARS = [
  ["taylor/ventana", SERVER_CAL],
  ["july-start", { reportingTimeZone: "America/Phoenix", reportingYearStartMonth: 7 }],
  ["dst-zone", { reportingTimeZone: "America/Denver", reportingYearStartMonth: 1 }],
  ["utc", { reportingTimeZone: "UTC", reportingYearStartMonth: 1 }],
];

// Instants chosen for the edges that break naive implementations, not for coverage theatre.
const AS_OF = [
  ["mid-month", Date.parse("2026-09-22T14:30:00-07:00")],
  ["first of month", Date.parse("2026-09-01T00:30:00-07:00")],
  ["last of month", Date.parse("2026-09-30T23:30:00-07:00")],
  ["first of year", Date.parse("2026-01-01T09:00:00-07:00")],
  ["last of year", Date.parse("2026-12-31T22:00:00-07:00")],
  ["first of quarter", Date.parse("2026-07-01T09:00:00-07:00")],
  ["31st vs a 28-day prior month", Date.parse("2026-03-31T12:00:00-07:00")],
  ["leap day", Date.parse("2024-02-29T12:00:00-07:00")],
  ["day after leap day", Date.parse("2024-03-01T12:00:00-07:00")],
  ["spring forward", Date.parse("2026-03-08T18:00:00Z")],
  ["fall back", Date.parse("2026-11-01T18:00:00Z")],
  ["day before spring forward", Date.parse("2026-03-07T18:00:00Z")],
];

test("every period type, calendar, instant and comparison mode agrees across both ports", () => {
  let cases = 0;
  for (const [calName, calendar] of CALENDARS) {
    for (const [asOfName, asOfMillis] of AS_OF) {
      for (const periodType of SERVER.PERIOD_TYPES) {
        for (const comparisonMode of ["NONE", "PRIOR_FULL", "PRIOR_COMPARABLE"]) {
          const input = { calendar, periodType, asOfMillis, comparisonMode };
          const s = SERVER.resolveReportingPeriod(input);
          const c = CLIENT.resolveReportingPeriod(input);
          assert.equal(J(s), J(c), `diverged: ${calName} / ${asOfName} / ${periodType} / ${comparisonMode}`);
          cases += 1;
        }
      }
    }
  }
  // 4 calendars x 12 instants x 5 period types x 3 modes.
  assert.equal(cases, 720, "the corpus shrank -- a case was removed rather than fixed");
});

test("both ports refuse the same malformed inputs, with the same codes", () => {
  const bad = [
    [{ calendar: null, periodType: "MTD", asOfMillis: 0 }, "CALENDAR_REQUIRED"],
    [{ calendar: { reportingTimeZone: "", reportingYearStartMonth: 1 }, periodType: "MTD", asOfMillis: 0 }, "CALENDAR_REQUIRED"],
    [{ calendar: { reportingTimeZone: "UTC", reportingYearStartMonth: 0 }, periodType: "MTD", asOfMillis: 0 }, "CALENDAR_INVALID"],
    [{ calendar: { reportingTimeZone: "UTC", reportingYearStartMonth: 13 }, periodType: "MTD", asOfMillis: 0 }, "CALENDAR_INVALID"],
    [{ calendar: SERVER_CAL, periodType: "WTD", asOfMillis: 0 }, "PERIOD_TYPE_INVALID"],
    [{ calendar: SERVER_CAL, periodType: "MTD", asOfMillis: Number.NaN }, "AS_OF_REQUIRED"],
    [{ calendar: SERVER_CAL, periodType: "MTD", asOfMillis: "2026-09-22" }, "AS_OF_REQUIRED"],
    [{ calendar: { reportingTimeZone: "Mars/Olympus", reportingYearStartMonth: 1 }, periodType: "MTD", asOfMillis: 0 }, "TIMEZONE_INVALID"],
  ];
  for (const [input, code] of bad) {
    let sc = null;
    let cc = null;
    try { SERVER.resolveReportingPeriod(input); } catch (e) { sc = e.code; }
    try { CLIENT.resolveReportingPeriod(input); } catch (e) { cc = e.code; }
    assert.equal(sc, code, `server code for ${J(input.periodType)}`);
    assert.equal(cc, code, `client code for ${J(input.periodType)}`);
  }
});

test("windowContains and pacing agree across both ports", () => {
  const calendar = SERVER_CAL;
  const asOfMillis = Date.parse("2026-09-22T14:30:00-07:00");
  for (const periodType of SERVER.PERIOD_TYPES) {
    const s = SERVER.resolveReportingPeriod({ calendar, periodType, asOfMillis });
    const c = CLIENT.resolveReportingPeriod({ calendar, periodType, asOfMillis });
    assert.equal(J(SERVER.pacing(s)), J(CLIENT.pacing(c)), `pacing ${periodType}`);
    for (const probe of [s.current.startMillis - 1, s.current.startMillis, s.current.endInclusiveMillis, s.current.endExclusiveMillis]) {
      assert.equal(
        SERVER.windowContains(s.current, probe),
        CLIENT.windowContains(c.current, probe),
        `windowContains ${periodType} @ ${probe}`,
      );
    }
  }
});

test("the client's reportingDayIso is the reporting zone's day, not the host's", () => {
  // The specific bug this replaces: `new Date().toISOString().slice(0,10)` returns the UTC day, so
  // any evening in Phoenix (UTC-7) reports TOMORROW's date. 22:00 on 22 September in Phoenix is
  // 05:00 on the 23rd in UTC.
  const eveningInPhoenix = Date.parse("2026-09-22T22:00:00-07:00");
  assert.equal(CLIENT.reportingDayIso(eveningInPhoenix), "2026-09-22");
  assert.equal(new Date(eveningInPhoenix).toISOString().slice(0, 10), "2026-09-23", "which is what it used to say");
});

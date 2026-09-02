// The Financials period helper — calendar boundaries and the request contract.
// Run: node --test test/financialsPeriod.test.mjs
//
// Boundaries are where date code goes wrong, so the cases below sit ON them: month ends, the
// December→January rollover, quarter edges, and leap day. The helper takes `nowMillis` precisely
// so these can be pinned instead of depending on when the suite runs.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PERIOD_PRESETS,
  DEFAULT_PERIOD_KEY,
  resolvePeriod,
  validateCustomRange,
  periodLabel,
  periodRequestFields,
  periodNote,
} from "../src/domain/financialsPeriod.js";

// REPORTING-ZONE helpers, replacing host-local ones (G-05, Decision #163).
//
// The previous versions built instants with `new Date(y, m, d)` and formatted them with
// `.getFullYear()` — both host-local. That agreed with the module while the module was also
// host-local, so the suite passed everywhere and asserted nothing about WHICH timezone was right.
//
// It stopped agreeing the moment boundaries became America/Phoenix, and the failure was invisible on
// a Phoenix development machine and total on a UTC CI runner: eleven of seventeen tests. Measured,
// not guessed — `TZ=UTC node --test` on this file.
//
// So the helpers now speak the REPORTING zone explicitly. The suite asserts the authority's
// behaviour rather than the host's, and it gives the same answer on every machine.
const REPORTING_TZ = "America/Phoenix";
/** An instant, given as a Phoenix wall-clock time. Phoenix is UTC-7 year round. */
const at = (y, m, d, h = 12) =>
  Date.parse(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00-07:00`);
const partsIn = (ms) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23",
  }).formatToParts(new Date(ms));
const partIn = (ms, type) => partsIn(ms).find((x) => x.type === type)?.value;
const day = (ms) => `${partIn(ms, "year")}-${partIn(ms, "month")}-${partIn(ms, "day")}`;
const span = (w) => [day(w.startMillis), day(w.endMillis)];

test("the preset list is the approved vocabulary, defaulting to all activity", () => {
  assert.deepEqual(
    PERIOD_PRESETS.map((p) => p.key),
    // Two ADDITIVE presets since G-05: the ruling names MTD and QTD as required vocabulary, and the
    // family had only to-date YEAR. The existing full-period presets are untouched and still mean
    // the whole month / whole quarter.
    ["all", "monthToDate", "thisMonth", "lastMonth", "quarterToDate", "thisQuarter", "lastQuarter", "yearToDate", "last12Months", "custom"],
  );
  assert.equal(DEFAULT_PERIOD_KEY, "all");
});

test("only the preset whose meaning CHANGED carries an explanatory note", () => {
  // Owner-approved follow-up to G-05. T12M moved from "first of the month eleven months back" to a
  // rolling twelve months, so a reader who knew the old behaviour sees a number change with no
  // transaction behind it. One sentence beside the control is the cheapest honest explanation.
  //
  // The assertion that matters is the SECOND one: exactly one preset has a note. A note on every
  // preset would train the reader to skip all of them, which is how explanatory text stops working.
  assert.match(periodNote("last12Months"), /rolling 12-calendar-month window/i);
  assert.equal(PERIOD_PRESETS.filter((p) => p.note).length, 1);
  for (const k of ["all", "monthToDate", "thisMonth", "lastMonth", "quarterToDate", "thisQuarter", "lastQuarter", "yearToDate", "custom"]) {
    assert.equal(periodNote(k), null, `${k} needs no note — it means what it says`);
  }
  assert.equal(periodNote("nonsense"), null, "an unknown preset yields no note rather than throwing");
});

test("ALL ACTIVITY is the ABSENCE of a period, not a very wide one", () => {
  assert.equal(resolvePeriod("all", {}, at(2026, 5, 15)), null);
  // The request therefore carries no bounds at all — the server sees no period filter.
  assert.deepEqual(periodRequestFields("all", {}, at(2026, 5, 15)), {});
});

test("month boundaries: this month and last month cover whole calendar months", () => {
  // 15 March 2026.
  assert.deepEqual(span(resolvePeriod("thisMonth", {}, at(2026, 2, 15))), ["2026-03-01", "2026-03-31"]);
  assert.deepEqual(span(resolvePeriod("lastMonth", {}, at(2026, 2, 15))), ["2026-02-01", "2026-02-28"]);
  // 30-day month, and a month end evaluated ON the last day.
  assert.deepEqual(span(resolvePeriod("thisMonth", {}, at(2026, 3, 30))), ["2026-04-01", "2026-04-30"]);
});

test("DECEMBER ROLLS OVER: last month from January is the previous year's December", () => {
  assert.deepEqual(span(resolvePeriod("lastMonth", {}, at(2026, 0, 10))), ["2025-12-01", "2025-12-31"]);
});

test("LEAP YEAR: February 2028 runs to the 29th", () => {
  assert.deepEqual(span(resolvePeriod("thisMonth", {}, at(2028, 1, 10))), ["2028-02-01", "2028-02-29"]);
});

test("quarter boundaries in all four quarters", () => {
  assert.deepEqual(span(resolvePeriod("thisQuarter", {}, at(2026, 0, 5))), ["2026-01-01", "2026-03-31"]);
  assert.deepEqual(span(resolvePeriod("thisQuarter", {}, at(2026, 4, 20))), ["2026-04-01", "2026-06-30"]);
  assert.deepEqual(span(resolvePeriod("thisQuarter", {}, at(2026, 8, 2))), ["2026-07-01", "2026-09-30"]);
  assert.deepEqual(span(resolvePeriod("thisQuarter", {}, at(2026, 11, 31))), ["2026-10-01", "2026-12-31"]);
});

test("LAST QUARTER crosses the year boundary correctly", () => {
  assert.deepEqual(span(resolvePeriod("lastQuarter", {}, at(2026, 1, 14))), ["2025-10-01", "2025-12-31"]);
  assert.deepEqual(span(resolvePeriod("lastQuarter", {}, at(2026, 8, 2))), ["2026-04-01", "2026-06-30"]);
});

test("year to date ends TODAY, not at the end of the year", () => {
  const w = resolvePeriod("yearToDate", {}, at(2026, 8, 2));
  assert.deepEqual(span(w), ["2026-01-01", "2026-09-02"]);
});

test("last 12 months is a ROLLING twelve months ending today — a DELIBERATE change", () => {
  // BEHAVIOUR CHANGED, and it is the one preset whose meaning G-05 required moving. This used to
  // start at the first of the month eleven months back (2025-10-01), which is a twelve-month span
  // measured in whole months. The ruling defines T12M as "the 12 calendar months ending at asOf" and
  // says explicitly: one canonical definition repo-wide, no metric keeping its own rolling-year
  // interpretation. The old behaviour WAS a second interpretation.
  //
  // The window is now ~29 days longer at the start of a month and identical at the end of one.
  assert.deepEqual(span(resolvePeriod("last12Months", {}, at(2026, 8, 2))), ["2025-09-02", "2026-09-02"]);
});

test("month to date and quarter to date end at the as-of day, not the end of the period", () => {
  assert.deepEqual(span(resolvePeriod("monthToDate", {}, at(2026, 8, 2))), ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(span(resolvePeriod("quarterToDate", {}, at(2026, 8, 2))), ["2026-07-01", "2026-09-02"]);
  // And they differ from the full-period presets, which is the whole reason both exist.
  assert.deepEqual(span(resolvePeriod("thisMonth", {}, at(2026, 8, 2))), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(span(resolvePeriod("thisQuarter", {}, at(2026, 8, 2))), ["2026-07-01", "2026-09-30"]);
});

test("boundaries are the REPORTING zone's, not the host's", () => {
  // 1 September 2026 00:00:00 in Phoenix is 07:00 UTC. A host-local implementation on a UTC runner
  // would return 00:00 UTC and be seven hours early, silently pulling in records from 31 August.
  const w = resolvePeriod("thisMonth", {}, at(2026, 8, 15));
  assert.equal(w.startMillis, Date.parse("2026-09-01T07:00:00Z"));
});

test("the window is INCLUSIVE of both days — the end is the last millisecond", () => {
  const w = resolvePeriod("thisMonth", {}, at(2026, 2, 15));
  // Asserted in the REPORTING zone: the last instant is 23:59:59.999 in Phoenix, whatever the host
  // thinks the hour is. Under the old host-local assertion this line passed in Phoenix and failed in
  // UTC, which is not a property worth having in a boundary test.
  assert.equal(partIn(w.endMillis, "hour"), "23");
  assert.equal(partIn(w.endMillis, "minute"), "59");
  assert.equal(partIn(w.endMillis, "fractionalSecond"), "999");
  // A record stamped late on the final day falls INSIDE the window. An end-exclusive boundary
  // would drop a whole day of records, on exactly the day the user named.
  assert.ok(at(2026, 2, 31, 22) <= w.endMillis);
});

test("custom range: valid, inclusive, and usable as a request", () => {
  const v = validateCustomRange({ from: "2026-03-01", to: "2026-03-31" });
  assert.equal(v.valid, true);
  assert.deepEqual(span(v), ["2026-03-01", "2026-03-31"]);
  const fields = periodRequestFields("custom", { from: "2026-03-01", to: "2026-03-31" });
  assert.equal(fields.periodStartMillis, v.startMillis);
  assert.equal(fields.periodEndMillis, v.endMillis);
});

test("a single-day custom range is valid and covers that whole day", () => {
  const v = validateCustomRange({ from: "2026-03-07", to: "2026-03-07" });
  assert.equal(v.valid, true);
  assert.ok(v.endMillis > v.startMillis);
  assert.deepEqual(span(v), ["2026-03-07", "2026-03-07"]);
});

test("FROM AFTER TO is refused, and issues NO request", () => {
  const v = validateCustomRange({ from: "2026-03-31", to: "2026-03-01" });
  assert.equal(v.valid, false);
  assert.match(v.reason, /after the end date/);
  // The critical half: an invalid range must not become a query. A backwards window would come
  // back correctly empty and read to the user as "no records".
  assert.deepEqual(periodRequestFields("custom", { from: "2026-03-31", to: "2026-03-01" }), {});
});

test("incomplete or malformed custom input is refused with a specific reason", () => {
  assert.match(validateCustomRange({ from: "", to: "" }).reason, /start and end/);
  assert.match(validateCustomRange({ from: "2026-03-01", to: "" }).reason, /end date/);
  assert.match(validateCustomRange({ from: "", to: "2026-03-01" }).reason, /start date/);
  // A date that does not exist must not silently roll into the next month.
  assert.equal(validateCustomRange({ from: "2026-02-31", to: "2026-03-01" }).valid, false);
  assert.equal(validateCustomRange({ from: "not-a-date", to: "2026-03-01" }).valid, false);
});

test("the label names the current selection, including an unset custom range", () => {
  assert.equal(periodLabel("all"), "All activity");
  assert.equal(periodLabel("thisQuarter"), "This quarter");
  assert.equal(periodLabel("custom", { from: "", to: "" }), "Custom range — not set");
  assert.match(periodLabel("custom", { from: "2026-03-01", to: "2026-03-31" }), /–/);
});

test("SOURCE GUARD: period boundary logic lives in ONE module, and no page filters records itself", () => {
  const pages = [
    "FinancialsInvoices",
    "FinancialsAccountsReceivable",
    "FinancialsPayments",
    "FinancialsOverview",
    "FinancialsCompanyPerformance",
    "FinancialsEmployeePerformance",
  ];
  for (const name of pages) {
    const src = readFileSync(new URL(`../src/modules/financials/${name}.jsx`, import.meta.url), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    // No page recomputes a boundary...
    assert.ok(!/getMonth\(\)|setMonth\(|startOfMonth|new Date\([^)]*,\s*\d+\s*,\s*1\)/.test(code), `${name} must not compute period boundaries`);
    // ...and no page filters financial records by date in the browser. Period narrows on the
    // SERVER; client-side date filtering would mean the client had been sent records the user
    // did not ask for.
    assert.ok(!/issuedAtMillis\s*[<>]/.test(code), `${name} must not client-filter by issued date`);
    assert.ok(!/receivedAtMillis\s*[<>]/.test(code), `${name} must not client-filter by received date`);
  }
});

test("SOURCE GUARD: a filtered-empty result must reach the period-aware wording", () => {
  // The defect this pins: when the server returns zero records the state is EMPTY, not READY, so
  // a branch keyed on READY alone fell through to the generic sentence — which reads as "no
  // invoices exist" when the truth is "none in this period".
  for (const name of ["FinancialsInvoices", "FinancialsAccountsReceivable", "FinancialsPayments"]) {
    const src = readFileSync(new URL(`../src/modules/financials/${name}.jsx`, import.meta.url), "utf8");
    assert.ok(/const answered =[\s\S]{0,120}FACTS_STATE\.EMPTY/.test(src), `${name} must treat EMPTY as answered`);
    assert.ok(!/state === FACTS_STATE\.READY && rows\.length === 0/.test(src), `${name} must not gate the empty message on READY alone`);
    assert.ok(/in this period/.test(src), `${name} must carry period-aware empty wording`);
  }
});

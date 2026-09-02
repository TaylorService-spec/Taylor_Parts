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
} from "../src/domain/financialsPeriod.js";

// Local-time helpers, matching the module's own convention (see its header on timezone).
const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();
const day = (ms) => {
  const x = new Date(ms);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const span = (w) => [day(w.startMillis), day(w.endMillis)];

test("the preset list is the approved vocabulary, defaulting to all activity", () => {
  assert.deepEqual(
    PERIOD_PRESETS.map((p) => p.key),
    ["all", "thisMonth", "lastMonth", "thisQuarter", "lastQuarter", "yearToDate", "last12Months", "custom"],
  );
  assert.equal(DEFAULT_PERIOD_KEY, "all");
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

test("last 12 months starts at the first of the month eleven months back", () => {
  assert.deepEqual(span(resolvePeriod("last12Months", {}, at(2026, 8, 2))), ["2025-10-01", "2026-09-02"]);
});

test("the window is INCLUSIVE of both days — the end is the last millisecond", () => {
  const w = resolvePeriod("thisMonth", {}, at(2026, 2, 15));
  const lastInstant = new Date(w.endMillis);
  assert.equal(lastInstant.getHours(), 23);
  assert.equal(lastInstant.getMinutes(), 59);
  assert.equal(lastInstant.getMilliseconds(), 999);
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

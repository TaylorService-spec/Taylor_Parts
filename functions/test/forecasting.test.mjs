// Finance — forecast core (F7 / FIN-005). Pure tests. Proves a forecast is an as-of-stamped expectation:
// explicit basis/currency/period/scope; superseded by newer as-of (never edited, never averaged); mixed
// targets and as-of ties are refused; comparison to actuals reuses the never-blend accumulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecastRecord, selectCurrentForecast, compareForecastToActual, ForecastError } from "../lib/finance/forecasting.js";

const fc = (over = {}) => buildForecastRecord({
  measurementBasis: "BOOKED",
  currency: "USD",
  amountMinor: 500_000,
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  scope: { operatingCompanyId: "taylor" },
  asOfMillis: 1_700_000_000_000,
  method: "SALESPERSON_COMMIT",
  ...over,
});
const factOf = (over = {}) => ({
  ref: "F1",
  basis: "BOOKED",
  currency: "USD",
  amountMinor: 200_000,
  eventDate: "2026-02-01",
  operatingCompanyId: "taylor",
  ...over,
});

test("a valid forecast freezes; basis/currency/period/asOf/method are all required and explicit", () => {
  const f = fc();
  assert.ok(Object.isFrozen(f) && Object.isFrozen(f.scope));
  assert.equal(f.scope.businessUnitId, null);
  assert.throws(() => fc({ measurementBasis: "PIPELINE" }), (e) => e instanceof ForecastError && e.code === "BASIS_REQUIRED");
  assert.throws(() => fc({ asOfMillis: 0 }), (e) => e.code === "AS_OF_REQUIRED");
  assert.throws(() => fc({ method: " " }), (e) => e.code === "METHOD_REQUIRED");
  assert.throws(() => fc({ amountMinor: 10.5 }), (e) => e.code === "AMOUNT_INVALID");
  assert.throws(() => fc({ periodEnd: "2025-01-01" }), (e) => e.code === "PERIOD_INVALID");
});

test("supersession: newest asOf wins; older versions are history, never averaged", () => {
  const v1 = fc({ amountMinor: 500_000, asOfMillis: 1_000 });
  const v2 = fc({ amountMinor: 420_000, asOfMillis: 2_000 });
  const current = selectCurrentForecast([v1, v2]);
  assert.equal(current.amountMinor, 420_000);
});

test("mixed targets refuse supersession (different period/scope/basis is not a version)", () => {
  assert.throws(() => selectCurrentForecast([fc(), fc({ periodEnd: "2026-06-30" })]), (e) => e.code === "TARGET_MIXED");
  assert.throws(() => selectCurrentForecast([fc(), fc({ scope: { operatingCompanyId: "ventana" } })]), (e) => e.code === "TARGET_MIXED");
  assert.throws(() => selectCurrentForecast([fc(), fc({ measurementBasis: "BILLED", asOfMillis: 2_000 })]), (e) => e.code === "TARGET_MIXED");
});

test("an asOf tie is ambiguous and refused — never resolved by array order", () => {
  assert.throws(() => selectCurrentForecast([fc({ amountMinor: 1 }), fc({ amountMinor: 2 })]), (e) => e.code === "AS_OF_AMBIGUOUS");
  assert.throws(() => selectCurrentForecast([]), (e) => e.code === "NO_FORECAST");
});

test("forecast vs actual: variance = actual − forecast; in-scope in-period facts accumulate", () => {
  const r = compareForecastToActual(fc(), [factOf(), factOf({ ref: "F2", amountMinor: 100_000 })]);
  assert.equal(r.forecastMinor, 500_000);
  assert.equal(r.actualMinor, 300_000);
  assert.equal(r.varianceMinor, -200_000);
  assert.equal(r.asOfMillis, 1_700_000_000_000);
});

test("never blend: an actual on a different basis or currency is a thrown category error", () => {
  assert.throws(() => compareForecastToActual(fc(), [factOf({ basis: "COLLECTED" })]), (e) => e.code === "BASIS_MISMATCH");
  assert.throws(() => compareForecastToActual(fc(), [factOf({ currency: "EUR" })]), (e) => e.code === "CURRENCY_MISMATCH");
});

test("out-of-period and out-of-scope facts are named exclusions", () => {
  const r = compareForecastToActual(fc(), [
    factOf(),
    factOf({ ref: "LATE", eventDate: "2026-07-01" }),
    factOf({ ref: "OTHER", operatingCompanyId: "ventana" }),
  ]);
  assert.equal(r.actualMinor, 200_000);
  assert.deepEqual(r.excluded.map((e) => e.ref).sort(), ["LATE", "OTHER"]);
  assert.ok(r.excluded.find((e) => e.ref === "LATE").reason.includes("forecast period"));
});

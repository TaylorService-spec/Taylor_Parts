// Finance — PURE forecast core (F7 / FIN-005). A FORECAST is an expectation about future performance,
// stamped at the moment it was made (`asOfMillis`) — it is a distinct fact class that is NEVER an actual
// (invariant A: ACTUAL ≠ FORECAST ≠ BUDGET ≠ GOAL). Consequences, made mechanical here:
//   • A forecast is never edited — a newer forecast for the same target SUPERSEDES the older one by its
//     as-of time; the older one stays as history ("what did we expect on that date?").
//   • A forecast is not an approval object (that is a plan) and is never a price: FIN-001 rules the
//     Opportunity's `expectedValue` a forecast-flavored number with no currency that flows nowhere —
//     forecast facts here are EXPLICIT records with declared basis/currency/period/scope, whatever
//     method produced them (a salesperson commit, a pipeline derivation, a management call — the method
//     vocabulary is deliberately an open label, not policy minted here).
//   • Comparing forecast to actual uses the SAME never-blend accumulation as plan-vs-actual: basis or
//     currency mismatch is a category error; out-of-period/scope facts are named exclusions.
// Integer minor units; pure; no I/O; storage and capability activation stay F12/F14.
import {
  accumulateActualFacts,
  MEASUREMENT_BASES,
  PlanError,
  type ActualFact,
  type MeasurementBasis,
  type PlanScope,
} from "./planVsActual";

export class ForecastError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "ForecastError"; this.code = code; }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface ForecastRecordInput {
  measurementBasis: string;
  currency: string;
  amountMinor: number;
  periodStart: string; // YYYY-MM-DD inclusive
  periodEnd: string; // YYYY-MM-DD inclusive
  scope: Partial<PlanScope> | null | undefined;
  asOfMillis: number; // when this expectation was formed — the supersession key
  method: string; // how it was produced (open label; e.g. SALESPERSON_COMMIT, PIPELINE_DERIVED)
}

export interface ForecastRecord {
  measurementBasis: MeasurementBasis;
  currency: string;
  amountMinor: number;
  periodStart: string;
  periodEnd: string;
  scope: PlanScope;
  asOfMillis: number;
  method: string;
}

// Validate + freeze one forecast record. Same explicit-basis/period/scope discipline as plans.
export function buildForecastRecord(input: ForecastRecordInput): ForecastRecord {
  if (!(MEASUREMENT_BASES as readonly string[]).includes(input?.measurementBasis)) {
    throw new ForecastError("BASIS_REQUIRED", `measurementBasis must be one of ${MEASUREMENT_BASES.join("/")} — a forecast with no declared basis cannot be compared to anything`);
  }
  if (!nonEmpty(input.currency)) throw new ForecastError("CURRENCY_REQUIRED", "currency is explicit on every forecast");
  if (!isInt(input.amountMinor) || input.amountMinor < 0) throw new ForecastError("AMOUNT_INVALID", "amountMinor must be a non-negative integer (minor units)");
  if (!ISO_DATE.test(input.periodStart ?? "") || !ISO_DATE.test(input.periodEnd ?? "")) throw new ForecastError("PERIOD_INVALID", "periodStart/periodEnd must be ISO dates (YYYY-MM-DD)");
  if (input.periodEnd < input.periodStart) throw new ForecastError("PERIOD_INVALID", "periodEnd precedes periodStart");
  if (!isInt(input.asOfMillis) || input.asOfMillis <= 0) throw new ForecastError("AS_OF_REQUIRED", "asOfMillis is required — a forecast is meaningless without when it was made");
  if (!nonEmpty(input.method)) throw new ForecastError("METHOD_REQUIRED", "method is required — every forecast says how it was produced");
  const dim = (v: unknown, label: string): string | null => {
    if (v === undefined || v === null) return null;
    if (!nonEmpty(v)) throw new ForecastError("SCOPE_INVALID", `${label} must be a non-empty id or absent`);
    return v.trim();
  };
  return Object.freeze({
    measurementBasis: input.measurementBasis as MeasurementBasis,
    currency: input.currency.trim(),
    amountMinor: input.amountMinor,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    scope: Object.freeze({
      operatingCompanyId: dim(input.scope?.operatingCompanyId, "operatingCompanyId"),
      businessUnitId: dim(input.scope?.businessUnitId, "businessUnitId"),
      creditedSalespersonId: dim(input.scope?.creditedSalespersonId, "creditedSalespersonId"),
    }),
    asOfMillis: input.asOfMillis,
    method: input.method.trim(),
  });
}

const sameTarget = (a: ForecastRecord, b: ForecastRecord): boolean =>
  a.measurementBasis === b.measurementBasis &&
  a.currency === b.currency &&
  a.periodStart === b.periodStart &&
  a.periodEnd === b.periodEnd &&
  a.scope.operatingCompanyId === b.scope.operatingCompanyId &&
  a.scope.businessUnitId === b.scope.businessUnitId &&
  a.scope.creditedSalespersonId === b.scope.creditedSalespersonId;

// Pick the CURRENT forecast among versions of one target: newest asOf wins; the rest are history, not
// candidates for averaging or blending. Mixed targets are a caller defect (comparing different periods,
// scopes, or bases is not "picking a version"). Ties on asOfMillis are ambiguous — refused, never
// resolved by array order.
export function selectCurrentForecast(records: ForecastRecord[]): ForecastRecord {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) throw new ForecastError("NO_FORECAST", "no forecast records supplied");
  for (const r of list) {
    if (!sameTarget(list[0], r)) throw new ForecastError("TARGET_MIXED", "records span different targets (basis/currency/period/scope) — supersession is per target");
  }
  let current = list[0];
  for (const r of list.slice(1)) {
    if (r.asOfMillis === current.asOfMillis) throw new ForecastError("AS_OF_AMBIGUOUS", `two forecasts share asOfMillis ${r.asOfMillis} — supersession is undefined`);
    if (r.asOfMillis > current.asOfMillis) current = r;
  }
  return current;
}

export interface ForecastComparisonResult {
  measurementBasis: MeasurementBasis;
  currency: string;
  asOfMillis: number;
  forecastMinor: number;
  actualMinor: number;
  varianceMinor: number; // actual − forecast
  includedCount: number;
  excluded: { ref: string; reason: string }[];
}

// Compare one forecast to explicit actual facts — same never-blend semantics as plan-vs-actual (shared
// accumulator; PlanError codes BASIS_MISMATCH/CURRENCY_MISMATCH/FACT_INVALID pass through).
export function compareForecastToActual(forecast: ForecastRecord, actuals: ActualFact[]): ForecastComparisonResult {
  if (!forecast || typeof forecast !== "object") throw new ForecastError("NO_FORECAST", "forecast required");
  const { actualMinor, includedCount, excluded } = accumulateActualFacts(
    {
      measurementBasis: forecast.measurementBasis,
      currency: forecast.currency,
      periodStart: forecast.periodStart,
      periodEnd: forecast.periodEnd,
      scope: forecast.scope,
      label: "forecast",
    },
    actuals,
  );
  return {
    measurementBasis: forecast.measurementBasis,
    currency: forecast.currency,
    asOfMillis: forecast.asOfMillis,
    forecastMinor: forecast.amountMinor,
    actualMinor,
    varianceMinor: actualMinor - forecast.amountMinor,
    includedCount,
    excluded,
  };
}

export { PlanError };

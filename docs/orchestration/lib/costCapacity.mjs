// Provider-neutral cost/capacity semantics. Estimated economic cost is never billed spend.

export const UNKNOWN_COST = "UNKNOWN";

export function createCostCapacityTelemetry({ actualProviderCostUsd = UNKNOWN_COST, estimatedExecutionCostUsd = null, providerCapacityUsage = {}, budgetStopReason = null, costProvenance = {}, freshness = "UNKNOWN" } = {}) {
  if (actualProviderCostUsd !== UNKNOWN_COST && (!Number.isFinite(actualProviderCostUsd) || actualProviderCostUsd < 0)) throw new Error("actualProviderCostUsd must be non-negative or UNKNOWN");
  if (estimatedExecutionCostUsd != null && (!Number.isFinite(estimatedExecutionCostUsd) || estimatedExecutionCostUsd < 0)) throw new Error("estimatedExecutionCostUsd must be non-negative or null");
  return Object.freeze({ actualProviderCostUsd, estimatedExecutionCostUsd, providerCapacityUsage: Object.freeze({ shortWindow: "UNKNOWN", weekly: "UNKNOWN", concurrency: "UNKNOWN", ownerReserve: "UNKNOWN", ...providerCapacityUsage }), budgetStopReason, costProvenance: Object.freeze({ actual: "UNAVAILABLE", estimated: "UNAVAILABLE", ...costProvenance }), freshness });
}

export function evaluateBudgetStop({ billingMode, actualProviderCostUsd = UNKNOWN_COST, actualCostAuthoritative = false, estimatedExecutionCostUsd = null, authoritativeApiBudgetUsd = null, explicitEconomicCostCapUsd = null } = {}) {
  if (explicitEconomicCostCapUsd != null && estimatedExecutionCostUsd != null && estimatedExecutionCostUsd >= explicitEconomicCostCapUsd) return "EXPLICIT_ECONOMIC_COST_CAP";
  if (billingMode === "API" && actualCostAuthoritative === true && authoritativeApiBudgetUsd != null && actualProviderCostUsd !== UNKNOWN_COST && actualProviderCostUsd >= authoritativeApiBudgetUsd) return "AUTHORITATIVE_API_BUDGET_EXHAUSTED";
  return null;
}

export function invocationEconomicCap(ctx = {}) {
  return Number.isFinite(ctx.explicitEconomicCostCapUsd) && ctx.explicitEconomicCostCapUsd > 0 ? ctx.explicitEconomicCostCapUsd : null;
}

export function evaluateProviderCapacityStop(usage = {}) {
  for (const key of ["shortWindow", "weekly", "concurrency"]) {
    const value = usage[key];
    if (value && Number.isFinite(value.used) && Number.isFinite(value.limit) && value.used >= value.limit) return `PROVIDER_${key.toUpperCase()}_LIMIT`;
  }
  const reserve = usage.ownerReserve;
  if (reserve && Number.isFinite(reserve.remaining) && Number.isFinite(reserve.minimum) && reserve.remaining <= reserve.minimum) return "OWNER_RESERVE_REACHED";
  return null;
}

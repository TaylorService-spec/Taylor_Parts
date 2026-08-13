import test from "node:test";
import assert from "node:assert/strict";
import { createCostCapacityTelemetry, evaluateBudgetStop, evaluateProviderCapacityStop, UNKNOWN_COST } from "./costCapacity.mjs";

test("#831: 10-worker modeled Claude cost above $2 does not stop subscription work without economic cap", () => {
  const estimatedExecutionCostUsd = Array.from({length:10}, (_,i) => i < 5 ? 0.34483497 : 0.16).reduce((a,b)=>a+b,0);
  assert.ok(estimatedExecutionCostUsd > 2);
  assert.equal(evaluateBudgetStop({ billingMode:"SUBSCRIPTION", estimatedExecutionCostUsd, actualProviderCostUsd:UNKNOWN_COST }), null);
});
test("explicit economic-cost cap stops modeled execution", () => assert.equal(evaluateBudgetStop({ billingMode:"SUBSCRIPTION", estimatedExecutionCostUsd:2.4, explicitEconomicCostCapUsd:2 }), "EXPLICIT_ECONOMIC_COST_CAP"));
test("authoritative API-dollar exhaustion stops", () => assert.equal(evaluateBudgetStop({ billingMode:"API", actualProviderCostUsd:0.25, actualCostAuthoritative:true, authoritativeApiBudgetUsd:0.25 }), "AUTHORITATIVE_API_BUDGET_EXHAUSTED"));
test("non-authoritative API estimate cannot enforce a billed-dollar budget", () => assert.equal(evaluateBudgetStop({ billingMode:"API", actualProviderCostUsd:9, actualCostAuthoritative:false, authoritativeApiBudgetUsd:1 }), null));
test("missing billing is UNKNOWN, never zero", () => assert.equal(createCostCapacityTelemetry().actualProviderCostUsd, "UNKNOWN"));
test("estimated and actual cost remain distinct", () => assert.deepEqual(createCostCapacityTelemetry({ estimatedExecutionCostUsd:1.72, costProvenance:{estimated:"CLAUDE_CLI_MODELED"}, freshness:"CURRENT" }), { actualProviderCostUsd:"UNKNOWN", estimatedExecutionCostUsd:1.72, providerCapacityUsage:{shortWindow:"UNKNOWN",weekly:"UNKNOWN",concurrency:"UNKNOWN",ownerReserve:"UNKNOWN"}, budgetStopReason:null, costProvenance:{actual:"UNAVAILABLE",estimated:"CLAUDE_CLI_MODELED"}, freshness:"CURRENT" }));
test("authoritative provider windows, concurrency, and Owner reserve stop independently", () => {
  assert.equal(evaluateProviderCapacityStop({ shortWindow:{used:100,limit:100} }), "PROVIDER_SHORTWINDOW_LIMIT");
  assert.equal(evaluateProviderCapacityStop({ weekly:{used:500,limit:500} }), "PROVIDER_WEEKLY_LIMIT");
  assert.equal(evaluateProviderCapacityStop({ concurrency:{used:10,limit:10} }), "PROVIDER_CONCURRENCY_LIMIT");
  assert.equal(evaluateProviderCapacityStop({ ownerReserve:{remaining:10,minimum:10} }), "OWNER_RESERVE_REACHED");
});

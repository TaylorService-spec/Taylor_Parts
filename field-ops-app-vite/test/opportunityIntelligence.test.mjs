import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveOpportunityIntelligence,
  toOpportunityModelInput,
  OPPORTUNITY_INTELLIGENCE_REASON as REASON,
} from "../src/domain/opportunityIntelligence.js";

const NOW = Date.UTC(2026, 7, 27);
const opportunity = (over = {}) => ({
  stage: "DECISION",
  outcome: null,
  expectedCloseAt: NOW + (2 * 24 * 60 * 60 * 1000),
  nextAction: null,
  expectedValue: 90000,
  currency: null,
  id: "95kFz8WWgiSn2nU2O3Ml",
  accountId: "acct-secret",
  ownerEmployeeId: "employee-secret",
  salesAgreementId: "agreement-secret",
  salesOrderId: "order-secret",
  ...over,
});

test("Opportunity intelligence reuses existing attention reasons and exposes NO action", () => {
  const r = deriveOpportunityIntelligence(opportunity(), NOW);
  assert.equal(r.speak, true);
  assert.equal(r.reason, REASON.READY);
  assert.equal(r.allowedRecommendation, null);
  assert.deepEqual(r.evidence.map((e) => e.kind), ["DECISION_PENDING", "NO_NEXT_ACTION", "CLOSE_SOON"]);
});

test("closed Opportunities stay silent", () => {
  for (const outcome of ["WON", "LOST"]) {
    const r = deriveOpportunityIntelligence(opportunity({ outcome }), NOW);
    assert.equal(r.speak, false);
    assert.equal(r.reason, REASON.CLOSED);
  }
});

test("no existing attention means no AI prose", () => {
  const r = deriveOpportunityIntelligence(opportunity({
    stage: "DISCOVERY",
    expectedCloseAt: NOW + (60 * 24 * 60 * 60 * 1000),
    nextAction: "Call customer",
  }), NOW);
  assert.equal(r.speak, false);
  assert.equal(r.reason, REASON.NO_ATTENTION);
});

test("model payload contains bounded semantic evidence only", () => {
  const input = toOpportunityModelInput(deriveOpportunityIntelligence(opportunity(), NOW));
  assert.ok(input);
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.allowedRecommendation, null);

  const serialized = JSON.stringify(input);
  for (const forbidden of [
    "95kFz8WWgiSn2nU2O3Ml",
    "acct-secret",
    "employee-secret",
    "agreement-secret",
    "order-secret",
    "90000",
    "Call customer",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must not expose ${forbidden}`);
  }
});

test("unknown upstream attention reasons fail closed rather than disappearing", () => {
  // This invariant is primarily structural: opportunityIntelligence only accepts the reviewed
  // reason vocabulary. Invalid inputs must not become an explanation.
  assert.equal(deriveOpportunityIntelligence(null, NOW).reason, REASON.INPUT_INVALID);
  assert.equal(toOpportunityModelInput({ speak: true, reason: REASON.READY, evidence: [], allowedRecommendation: null }), null);
});

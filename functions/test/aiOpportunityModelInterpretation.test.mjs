import test from "node:test";
import assert from "node:assert/strict";
import { verifyOpportunityModelInterpretation } from "../lib/ai/opportunityModelInterpretation.js";

const INPUT = Object.freeze({
  schemaVersion: 1,
  observedFact: "EOS has established multiple attention conditions on this opportunity.",
  evidence: Object.freeze([
    Object.freeze({ key: "opportunity-decision-pending", kind: "DECISION_PENDING", summary: "The opportunity is awaiting a customer decision." }),
    Object.freeze({ key: "opportunity-close-soon", kind: "CLOSE_SOON", summary: "The expected close condition is approaching." }),
  ]),
  allowedRecommendation: null,
});

const candidate = (over = {}) => ({
  interpretation: "The deal needs commercial attention before it can progress.",
  businessConsequence: "The current customer decision and close condition should be reviewed by the owner.",
  confidence: "HIGH",
  confidenceBasis: "Both conditions were supplied by EOS as governed evidence.",
  evidenceRefs: ["opportunity-decision-pending", "opportunity-close-soon"],
  recommendedActionId: null,
  ...over,
});

test("grounded explanation is accepted and EOS owns the observed fact", () => {
  const v = verifyOpportunityModelInterpretation(INPUT, candidate());
  assert.equal(v.speak, true);
  assert.equal(v.origin, "MODEL");
  assert.equal(v.observedFact, INPUT.observedFact);
  assert.equal(v.recommendedAction, null);
  assert.deepEqual(v.evidence.map((e) => e.key), INPUT.evidence.map((e) => e.key));
});

test("model cannot add fields or replace the observed fact", () => {
  const v = verifyOpportunityModelInterpretation(INPUT, { ...candidate(), observedFact: "Deal will close." });
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
});

test("model cannot recommend lifecycle or commercial actions in the first slice", () => {
  for (const action of ["advanceOpportunity", "closeOpportunityAsWon", "closeOpportunityAsLost", "createSalesAgreement"] ) {
    const v = verifyOpportunityModelInterpretation(INPUT, candidate({ recommendedActionId: action }));
    assert.equal(v.speak, false, action);
    assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }
});

test("numbers, money, percentages, probabilities and dates fail closed", () => {
  for (const prose of [
    "The deal is 80 percent likely to close.",
    "Expected value is $5000.",
    "Close is in 3 days.",
    "The close should happen in September.",
    "Forecast is strong.",
  ]) {
    const v = verifyOpportunityModelInterpretation(INPUT, candidate({ interpretation: prose }));
    assert.equal(v.speak, false, prose);
    assert.equal(v.reason, "MODEL_OUTPUT_COMMERCIAL_FABRICATION");
  }
});

test("invented or absent evidence fails closed", () => {
  const invented = verifyOpportunityModelInterpretation(INPUT, candidate({ evidenceRefs: ["made-up"] }));
  assert.equal(invented.speak, false);
  assert.equal(invented.reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");

  for (const refs of [[], null, [""], [42]]) {
    const v = verifyOpportunityModelInterpretation(INPUT, candidate({ evidenceRefs: refs }));
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_UNGROUNDED");
  }
});

test("blank prose and invalid confidence fail closed", () => {
  assert.equal(verifyOpportunityModelInterpretation(INPUT, candidate({ interpretation: " " })).speak, false);
  const v = verifyOpportunityModelInterpretation(INPUT, candidate({ confidence: "CERTAIN" }));
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
});

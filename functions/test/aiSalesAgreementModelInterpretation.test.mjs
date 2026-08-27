import test from "node:test";
import assert from "node:assert/strict";
import { verifySalesAgreementModelInterpretation } from "../lib/ai/salesAgreementModelInterpretation.js";

const INPUT = Object.freeze({
  schemaVersion: 1,
  observedFact: "EOS requires every Agreement line to have a recorded price before acceptance.",
  evidence: Object.freeze([
    Object.freeze({
      key: "sales-agreement-unpriced-lines",
      kind: "UNPRICED_LINES",
      summary: "EOS requires every Agreement line to have a recorded price before acceptance.",
    }),
  ]),
  allowedRecommendation: null,
});

const candidate = (over = {}) => ({
  interpretation: "The draft is not ready for the governed acceptance step.",
  businessConsequence: "The missing commercial input needs human review before the workflow can continue.",
  confidence: "HIGH",
  confidenceBasis: "EOS supplied the acceptance blocker as governed evidence.",
  evidenceRefs: ["sales-agreement-unpriced-lines"],
  recommendedActionId: null,
  ...over,
});

test("grounded explanation is accepted and EOS retains the fact", () => {
  const v = verifySalesAgreementModelInterpretation(INPUT, candidate());
  assert.equal(v.speak, true);
  assert.equal(v.observedFact, INPUT.observedFact);
  assert.equal(v.recommendedAction, null);
});

test("invented fields and actions fail closed", () => {
  assert.equal(verifySalesAgreementModelInterpretation(INPUT, { ...candidate(), legalStatus: "binding" }).reason, "MODEL_OUTPUT_INVALID");
  for (const action of ["acceptSalesAgreement", "updateSalesAgreementDraft", "priceAgreement", "sendForSignature"]) {
    const v = verifySalesAgreementModelInterpretation(INPUT, candidate({ recommendedActionId: action }));
    assert.equal(v.speak, false, action);
    assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }
});

test("customer assent, signature and legal language fail closed", () => {
  for (const prose of [
    "The agreement is binding.",
    "The customer accepted the terms.",
    "A signature is still required.",
    "The customer's commitment is incomplete.",
    "The agreement is legally enforceable.",
  ]) {
    const v = verifySalesAgreementModelInterpretation(INPUT, candidate({ interpretation: prose }));
    assert.equal(v.speak, false, prose);
    assert.equal(v.reason, "MODEL_OUTPUT_ACCEPTANCE_FABRICATION");
  }
});

test("money, pricing figures, dates and commercial calculations fail closed", () => {
  for (const prose of [
    "Set the price to $5000.",
    "The discount should be 10 percent.",
    "The total is incomplete.",
    "The down payment needs review.",
    "Resolve this in September.",
  ]) {
    const v = verifySalesAgreementModelInterpretation(INPUT, candidate({ interpretation: prose }));
    assert.equal(v.speak, false, prose);
    assert.equal(v.reason, "MODEL_OUTPUT_COMMERCIAL_FABRICATION");
  }
});

test("invented or absent evidence fails closed", () => {
  assert.equal(verifySalesAgreementModelInterpretation(INPUT, candidate({ evidenceRefs: ["invented"] })).reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
  for (const refs of [[], null, [""], [42]]) {
    const v = verifySalesAgreementModelInterpretation(INPUT, candidate({ evidenceRefs: refs }));
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_UNGROUNDED");
  }
});

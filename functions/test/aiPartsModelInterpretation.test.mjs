import test from "node:test";
import assert from "node:assert/strict";
import { verifyPartsModelInterpretation } from "../lib/ai/partsModelInterpretation.js";

const INPUT = Object.freeze({
  schemaVersion: 1,
  observedFact: "A reorder request assigned to you is ready for purchasing to start.",
  deterministicInterpretation: "The request has reached the existing assigned-purchaser work step.",
  deterministicBusinessConsequence: "Purchasing has not yet been marked as started for this assigned request.",
  evidence: Object.freeze([
    Object.freeze({
      key: "reorder-assigned-to-caller",
      kind: "REORDER_ASSIGNED_TO_CALLER",
      summary: "The governed reorder workflow assigns this request to the current user.",
    }),
  ]),
  allowedRecommendation: Object.freeze({ actionId: "startPurchasing", label: "Start purchasing", authority: "ALLOWED" }),
});

const candidate = (over = {}) => ({
  interpretation: "The assigned reorder request is at the purchasing-start step.",
  businessConsequence: "The request remains waiting for its assigned purchaser to begin the existing workflow step.",
  confidence: "HIGH",
  confidenceBasis: "The assignment state is established directly by EOS.",
  evidenceRefs: ["reorder-assigned-to-caller"],
  recommendedActionId: "startPurchasing",
  ...over,
});

test("a grounded interpretation may repeat only the EOS-allowed startPurchasing action", () => {
  const v = verifyPartsModelInterpretation(INPUT, candidate());
  assert.equal(v.speak, true);
  assert.equal(v.observedFact, INPUT.observedFact);
  assert.equal(v.recommendedAction.actionId, "startPurchasing");
  assert.equal(v.evidence[0].key, "reorder-assigned-to-caller");
});

test("the model may also explain without recommending an action", () => {
  const v = verifyPartsModelInterpretation(INPUT, candidate({ recommendedActionId: null }));
  assert.equal(v.speak, true);
  assert.equal(v.recommendedAction, null);
});

test("THE MODEL CANNOT INVENT ANOTHER PARTS OR PROCUREMENT ACTION", () => {
  for (const action of ["reviewReorderRequest", "assignReorderRequest", "recordPurchaseOrder", "receiveReorderRequest", "cancelReorderRequest"]) {
    const v = verifyPartsModelInterpretation(INPUT, candidate({ recommendedActionId: action }));
    assert.equal(v.speak, false, `${action} must be refused`);
    assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }
});

test("THE MODEL CANNOT INVENT PROCUREMENT FACTS", () => {
  for (const field of ["interpretation", "businessConsequence", "confidenceBasis"]) {
    for (const prose of [
      "Order 4 units.",
      "The vendor should be contacted.",
      "Use supplier Acme.",
      "The purchase order should cost $500.",
      "Stock is available.",
      "ETA is tomorrow.",
      "Quantity is low.",
    ]) {
      const v = verifyPartsModelInterpretation(INPUT, candidate({ [field]: prose }));
      assert.equal(v.speak, false, `${field}: ${prose}`);
      assert.equal(v.reason, "MODEL_OUTPUT_PROCUREMENT_FABRICATION");
    }
  }
});

test("THE MODEL CANNOT INVENT EVIDENCE", () => {
  const v = verifyPartsModelInterpretation(INPUT, candidate({ evidenceRefs: ["stock-shortage"] }));
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
});

test("unknown model fields are refused", () => {
  const v = verifyPartsModelInterpretation(INPUT, { ...candidate(), reorderRequestId: "secret" });
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
});

test("malformed EOS authority input is refused", () => {
  for (const input of [
    { ...INPUT, allowedRecommendation: { ...INPUT.allowedRecommendation, actionId: "recordPurchaseOrder" } },
    { ...INPUT, allowedRecommendation: { ...INPUT.allowedRecommendation, authority: "DENIED" } },
    { ...INPUT, evidence: [] },
    { ...INPUT, schemaVersion: 2 },
  ]) {
    const v = verifyPartsModelInterpretation(input, candidate());
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
  }
});

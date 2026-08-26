import test from "node:test";
import assert from "node:assert/strict";
import { verifyDispatchModelInterpretation } from "../lib/ai/dispatchModelInterpretation.js";

const INPUT = Object.freeze({
  schemaVersion: 1,
  observedFact: "Dispatch has governed attention conditions that need human review.",
  evidence: Object.freeze([
    Object.freeze({ key: "READY_TO_SCHEDULE", kind: "READY_TO_SCHEDULE", summary: "Governed work is ready to schedule." }),
    Object.freeze({ key: "SCHEDULING_CONFLICT", kind: "SCHEDULING_CONFLICT", summary: "The governed schedule contains a conflict." }),
  ]),
  allowedRecommendation: null,
});
const candidate = (over = {}) => ({
  interpretation: "Ready work and a schedule conflict both require dispatch review.",
  businessConsequence: "Operational attention remains unresolved until the governed conditions are reviewed.",
  confidence: "HIGH",
  confidenceBasis: "Both conditions were established by EOS.",
  evidenceRefs: ["READY_TO_SCHEDULE", "SCHEDULING_CONFLICT"],
  recommendedActionId: null,
  ...over,
});

test("grounded dispatch synthesis is accepted with no action", () => {
  const v = verifyDispatchModelInterpretation(INPUT, candidate());
  assert.equal(v.speak, true);
  assert.equal(v.observedFact, INPUT.observedFact);
  assert.equal(v.recommendedAction, null);
});

test("THE MODEL CANNOT INVENT A DISPATCH ACTION", () => {
  for (const action of ["scheduleWorkOrder", "assignTechnician", "rescheduleWorkOrder", "cancelWorkOrder"]) {
    const v = verifyDispatchModelInterpretation(INPUT, candidate({ recommendedActionId: action }));
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
  }
});

test("THE MODEL CANNOT INVENT PEOPLE, TIMES OR DATES", () => {
  for (const prose of ["Assign technician Alex.", "Schedule at 3 pm.", "Move it to tomorrow.", "Use tech Jones.", "Reschedule to Monday."]) {
    const v = verifyDispatchModelInterpretation(INPUT, candidate({ interpretation: prose }));
    assert.equal(v.speak, false, prose);
    assert.equal(v.reason, "MODEL_OUTPUT_SCHEDULING_FABRICATION");
  }
});

test("THE MODEL CANNOT INVENT EVIDENCE", () => {
  const v = verifyDispatchModelInterpretation(INPUT, candidate({ evidenceRefs: ["TECH_SKILL_MISMATCH"] }));
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
});

test("unknown model fields are refused", () => {
  const v = verifyDispatchModelInterpretation(INPUT, { ...candidate(), workOrderId: "secret" });
  assert.equal(v.speak, false);
  assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
});

test("malformed or action-bearing EOS input is refused", () => {
  for (const input of [
    { ...INPUT, evidence: [] },
    { ...INPUT, schemaVersion: 2 },
    { ...INPUT, allowedRecommendation: { actionId: "scheduleWorkOrder" } },
    { ...INPUT, evidence: [{ key: "OTHER", kind: "OTHER", summary: "Other" }] },
  ]) {
    const v = verifyDispatchModelInterpretation(input, candidate());
    assert.equal(v.speak, false);
    assert.equal(v.reason, "MODEL_OUTPUT_INVALID");
  }
});

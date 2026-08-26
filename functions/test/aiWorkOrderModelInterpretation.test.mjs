import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkOrderInterpretationPromptPayload,
  verifyWorkOrderModelInterpretation,
} from "../lib/ai/workOrderModelInterpretation.js";

const input = (over = {}) => ({
  schemaVersion: 1,
  subjectReference: "WO-2026-000873",
  observedFact: "The governed parts-readiness projection reports 1 needs attention; 1 ready.",
  deterministicInterpretation: "At least one planned part needs attention.",
  deterministicBusinessConsequence: "This work order should not be treated as fully parts-ready.",
  evidence: [
    { key: "E1", kind: "WORK_ORDER_PARTS_PLAN", summary: "2 planned lines, quantity 3." },
    { key: "E2", kind: "WORK_ORDER_PARTS_READINESS", summary: "1 ATTENTION, 1 READY, 0 UNKNOWN." },
  ],
  allowedRecommendation: null,
  ...over,
});

const candidate = (over = {}) => ({
  interpretation: "One planned part has a substantiated readiness issue.",
  businessConsequence: "Dispatch should not treat the job as fully parts-ready.",
  confidence: "HIGH",
  confidenceBasis: "Both statements are directly supported by the readiness projection.",
  evidenceRefs: ["E2"],
  recommendedActionId: null,
  ...over,
});

test("accepts grounded interpretation while EOS retains the observed fact and provenance", () => {
  const result = verifyWorkOrderModelInterpretation(input(), candidate());
  assert.equal(result.speak, true);
  assert.equal(result.origin, "MODEL");
  assert.equal(result.observedFact, input().observedFact);
  assert.deepEqual(result.evidence, [input().evidence[1]]);
  assert.equal(result.recommendedAction, null);
});

test("model cannot provide or overwrite an observed fact", () => {
  const result = verifyWorkOrderModelInterpretation(input(), candidate({
    observedFact: "The part will arrive tomorrow.",
  }));
  assert.deepEqual(result, { speak: false, origin: "MODEL", reason: "MODEL_OUTPUT_INVALID" });
});

test("model cannot invent evidence keys", () => {
  const result = verifyWorkOrderModelInterpretation(input(), candidate({ evidenceRefs: ["E99"] }));
  assert.equal(result.speak, false);
  assert.equal(result.reason, "MODEL_OUTPUT_UNSUPPORTED_EVIDENCE");
});

test("model cannot recommend an action EOS did not pre-authorize", () => {
  const result = verifyWorkOrderModelInterpretation(input(), candidate({
    recommendedActionId: "reschedule-work-order",
  }));
  assert.equal(result.speak, false);
  assert.equal(result.reason, "MODEL_OUTPUT_ACTION_NOT_ALLOWED");
});

test("an existing governed action may be repeated but never created by the model", () => {
  const allowed = {
    actionId: "existing-governed-action",
    label: "Existing governed action",
    authority: "ALLOWED",
  };
  const result = verifyWorkOrderModelInterpretation(
    input({ allowedRecommendation: allowed }),
    candidate({ recommendedActionId: allowed.actionId }),
  );
  assert.equal(result.speak, true);
  assert.deepEqual(result.recommendedAction, allowed);
});

test("unsupported confidence, blank prose and evidence-free output all fail closed", () => {
  for (const bad of [
    candidate({ confidence: "CERTAIN" }),
    candidate({ interpretation: "   " }),
    candidate({ evidenceRefs: [] }),
  ]) {
    const result = verifyWorkOrderModelInterpretation(input(), bad);
    assert.equal(result.speak, false);
  }
});

test("prompt payload contains sanitized evidence summaries and no hidden authority expansion", () => {
  const payload = buildWorkOrderInterpretationPromptPayload(input());
  assert.equal(payload.subjectReference, "WO-2026-000873");
  assert.deepEqual(payload.evidence.map((e) => e.key), ["E1", "E2"]);
  assert.equal(payload.allowedRecommendation, null);

  const encoded = JSON.stringify(payload);
  for (const forbidden of ["customerId", "partId", "warehouseId", "technicianId", "firestore", "databaseHandle"]) {
    assert.doesNotMatch(encoded, new RegExp(forbidden, "i"));
  }
});

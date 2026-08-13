import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCompletion, completionStateToStatus, COMPLETION_STATES } from "./completionSemantics.mjs";

// A fully-satisfied positive baseline; individual tests override one axis to isolate a regression.
const OK = {
  processSucceeded: true,
  runtimeTermination: "NORMAL",
  executionCapable: true,
  requiredExecutionReceipts: ["tests"],
  executionReceipts: ["tests"],
  expectedArtifactClass: "PATCH",
  producedArtifacts: ["PATCH"],
  verifierResult: "PASS",
  verifierRequired: true,
  ownerActionRequired: false,
};

test("POSITIVE: all completion criteria + evidence + verifier satisfied => COMPLETE", () => {
  const r = classifyCompletion(OK);
  assert.equal(r.state, "COMPLETE");
  assert.equal(r.complete, true);
});

test("#834 REGRESSION: execution capability unavailable before cycle execution => BLOCKED_EXECUTION, NEVER COMPLETE", () => {
  const r = classifyCompletion({ ...OK, executionCapable: false });
  assert.equal(r.state, "BLOCKED_EXECUTION");
  assert.equal(r.complete, false);
  // and the same when a required receipt is simply absent (capability present but nothing actually ran)
  const r2 = classifyCompletion({ ...OK, executionReceipts: [] });
  assert.equal(r2.state, "BLOCKED_EXECUTION");
  assert.equal(r2.complete, false);
});

test("#835 REGRESSION: implementation exists but required governed patch/PR absent => AWAITING_ARTIFACTIZATION, NEVER COMPLETE", () => {
  const r = classifyCompletion({ ...OK, producedArtifacts: [] });
  assert.equal(r.state, "AWAITING_ARTIFACTIZATION");
  assert.equal(r.complete, false);
  const r2 = classifyCompletion({ ...OK, expectedArtifactClass: "PULL_REQUEST", producedArtifacts: ["PATCH"] });
  assert.equal(r2.state, "AWAITING_ARTIFACTIZATION");
  assert.equal(r2.complete, false);
});

test("#836/#837 REGRESSION: hitting the configured bounded turn ceiling => RETURN_FOR_CORRECTION, fail closed", () => {
  const r = classifyCompletion({ ...OK, runtimeTermination: "MAX_TURNS_EXHAUSTED" });
  assert.equal(r.state, "RETURN_FOR_CORRECTION");
  assert.equal(r.complete, false);
});

test("#836/#837 CONVERSE: a task that runs long but terminates NORMALLY within the bounded ceiling still COMPLETEs", () => {
  // The legacy 40-turn ceiling must no longer be the thing that fails a long-but-finished correction: as long
  // as termination is NORMAL (i.e. it fit inside the raised bounded ceiling), completion is judged on evidence.
  const r = classifyCompletion({ ...OK, runtimeTermination: "NORMAL" });
  assert.equal(r.state, "COMPLETE");
});

test("verifier FAIL/REJECT => RETURN_FOR_CORRECTION; a required-but-absent verifier also fails closed", () => {
  assert.equal(classifyCompletion({ ...OK, verifierResult: "FAIL" }).state, "RETURN_FOR_CORRECTION");
  assert.equal(classifyCompletion({ ...OK, verifierResult: "REJECT" }).state, "RETURN_FOR_CORRECTION");
  assert.equal(classifyCompletion({ ...OK, verifierResult: null, verifierRequired: true }).state, "RETURN_FOR_CORRECTION");
});

test("owner action supersedes; abnormal termination is blocked; process failure is blocked", () => {
  assert.equal(classifyCompletion({ ...OK, ownerActionRequired: true }).state, "OWNER_ACTION_REQUIRED");
  assert.equal(classifyCompletion({ ...OK, runtimeTermination: "TIMEOUT" }).state, "BLOCKED_EXECUTION");
  assert.equal(classifyCompletion({ ...OK, processSucceeded: false }).state, "BLOCKED_EXECUTION");
});

test("fail-closed: an unknown runtimeTermination escalates, never COMPLETE", () => {
  const r = classifyCompletion({ ...OK, runtimeTermination: "WHO_KNOWS" });
  assert.equal(r.state, "ESCALATE");
  assert.equal(r.complete, false);
});

test("worker free-text is never sufficient: analysis with no required evidence still needs structured pass", () => {
  // A pure analysis task (no receipts, no artifact required, no verifier) legitimately COMPLETEs on process
  // success alone — worker text is not consulted.
  const analysis = classifyCompletion({ processSucceeded: true, runtimeTermination: "NORMAL", executionCapable: true, expectedArtifactClass: "NONE" });
  assert.equal(analysis.state, "COMPLETE");
  // but flip processSucceeded off and no amount of worker claim helps (the field is not even read)
  const notReal = classifyCompletion({ processSucceeded: false, workerClaimsComplete: true, expectedArtifactClass: "NONE" });
  assert.equal(notReal.complete, false);
});

test("completionStateToStatus maps to durable statuses; only COMPLETE reports COMPLETE", () => {
  assert.equal(completionStateToStatus("COMPLETE"), "COMPLETE");
  assert.equal(completionStateToStatus("BLOCKED_EXECUTION"), "BLOCKED_EXECUTION");
  assert.equal(completionStateToStatus("AWAITING_ARTIFACTIZATION"), "AWAITING_ARTIFACTIZATION");
  assert.equal(completionStateToStatus("RETURN_FOR_CORRECTION"), "CORRECTING");
  assert.equal(completionStateToStatus("OWNER_ACTION_REQUIRED"), "OWNER_REQUIRED");
  for (const s of COMPLETION_STATES) {
    if (s !== "COMPLETE") assert.notEqual(completionStateToStatus(s), "COMPLETE", `${s} must never map to COMPLETE`);
  }
});

import { normalizeExecutionContract } from "./completionSemantics.mjs";

test("normalizeExecutionContract gives implementation work fail-closed teeth (PATCH + receipts + verifier)", () => {
  const impl = normalizeExecutionContract({ taskClass: "PATCH_PRODUCER" });
  assert.equal(impl.expectedArtifactClass, "PATCH", "implementation must produce a PATCH even if unspecified");
  assert.deepEqual(impl.requiredExecutionReceipts, ["tests"]);
  assert.equal(impl.verifierRequired, true);
  // analysis default carries no such requirements
  const analysis = normalizeExecutionContract({});
  assert.equal(analysis.taskClass, "READ_ONLY_ANALYSIS");
  assert.equal(analysis.expectedArtifactClass, "NONE");
  assert.deepEqual(analysis.requiredExecutionReceipts, []);
  assert.equal(analysis.verifierRequired, false);
  // explicit fields still win (can require a PULL_REQUEST, can waive the verifier)
  const explicit = normalizeExecutionContract({ taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PULL_REQUEST", verifierRequired: false });
  assert.equal(explicit.expectedArtifactClass, "PULL_REQUEST");
  assert.equal(explicit.verifierRequired, false);
});

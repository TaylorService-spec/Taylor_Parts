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

// ── #868: pre-execution authorization ↔ post-execution proof-receipt seam ────────────────────────────────
import { deriveEffectiveContract, PROFILE_PROVABLE } from "./completionSemantics.mjs";
import { PROFILE_RANK } from "./executionProfiles.mjs";

const verifyRequest = normalizeExecutionContract({ taskClass: "READ_ONLY_VERIFY", requiredExecutionReceipts: ["tests"] });
const patchRequest = normalizeExecutionContract({ taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"], verifierRequired: true });

test("#868: a READ_ONLY_VERIFY request GRANTED only READ_ONLY_ANALYSIS is NOT required to prove a tests receipt it cannot run", () => {
  // The #864 shape: request wants VERIFY (tests receipt), but the governed grant is READ_ONLY_ANALYSIS, which
  // has no test-run capability. The receipt requirement must follow the GRANT, not the request → no tests
  // receipt required, so the authorized read-only work can COMPLETE instead of dead-locking on BLOCKED_EXECUTION.
  const eff = deriveEffectiveContract({ requested: verifyRequest, resolvedProfile: "READ_ONLY_ANALYSIS" });
  assert.deepEqual(eff.requiredExecutionReceipts, [], "no tests receipt required of a read-only-analysis grant");
  assert.equal(eff.expectedArtifactClass, "NONE");
  assert.equal(eff.verifierRequired, false);
  assert.equal(eff.downgradeBlocked, false, "a read-only request under a read-only grant is not a fail-closed downgrade");
});

test("#868: a READ_ONLY_VERIFY request GRANTED READ_ONLY_VERIFY STILL requires the tests receipt (post-execution proof kept)", () => {
  const eff = deriveEffectiveContract({ requested: verifyRequest, resolvedProfile: "READ_ONLY_VERIFY" });
  assert.deepEqual(eff.requiredExecutionReceipts, ["tests"], "when the grant CAN run tests, the receipt is required to COMPLETE");
  // And missing it after execution fails closed (BLOCKED_EXECUTION), never success.
  const missing = classifyCompletion({ processSucceeded: true, runtimeTermination: "NORMAL", executionCapable: true, requiredExecutionReceipts: eff.requiredExecutionReceipts, executionReceipts: [] });
  assert.equal(missing.state, "BLOCKED_EXECUTION");
  assert.equal(missing.complete, false);
});

test("#868 preserves #840: a PATCH_PRODUCER request resolved BELOW its class keeps its FULL contract and fails closed", () => {
  const eff = deriveEffectiveContract({ requested: patchRequest, resolvedProfile: "READ_ONLY_ANALYSIS" });
  assert.equal(eff.downgradeBlocked, true, "a downgraded MUTATING task must not collapse into a completable analysis");
  assert.equal(eff.expectedArtifactClass, "PATCH", "still demands the PATCH it can no longer produce");
  assert.deepEqual(eff.requiredExecutionReceipts, ["tests"]);
  assert.equal(eff.verifierRequired, true);
  // classifyCompletion on a read-only run (no PATCH, no receipts) → never COMPLETE.
  const c = classifyCompletion({ processSucceeded: true, runtimeTermination: "NORMAL", executionCapable: true, requiredExecutionReceipts: eff.requiredExecutionReceipts, executionReceipts: [], expectedArtifactClass: eff.expectedArtifactClass, producedArtifacts: ["ANALYSIS_REPORT"], verifierRequired: eff.verifierRequired });
  assert.equal(c.complete, false);
  assert.notEqual(c.state, "COMPLETE");
});

test("#868 does not widen PATCH_PRODUCER gates: a fully-granted PATCH task keeps PATCH + tests + verifier", () => {
  const eff = deriveEffectiveContract({ requested: patchRequest, resolvedProfile: "PATCH_PRODUCER" });
  assert.equal(eff.expectedArtifactClass, "PATCH");
  assert.deepEqual(eff.requiredExecutionReceipts, ["tests"]);
  assert.equal(eff.verifierRequired, true);
  assert.equal(eff.downgradeBlocked, false);
});

test("#868 never widens: the effective contract's requirements are always a subset of what the grant can prove", () => {
  for (const resolvedProfile of Object.keys(PROFILE_PROVABLE)) {
    const eff = deriveEffectiveContract({ requested: patchRequest, resolvedProfile });
    if (eff.downgradeBlocked) continue; // a fail-closed downgrade intentionally keeps the (unsatisfiable) full contract
    for (const r of eff.requiredExecutionReceipts) {
      assert.ok(PROFILE_PROVABLE[resolvedProfile].receipts.includes(r), `${resolvedProfile} cannot be required to prove receipt "${r}" it cannot run`);
    }
  }
});

test("#868 CONTRACT_PROFILE_RANK stays in lock-step with executionProfiles PROFILE_RANK", () => {
  // deriveEffectiveContract keeps a local rank copy to stay dependency-free; it must equal the canonical one.
  for (const [name, rank] of Object.entries(PROFILE_RANK)) {
    // A downgrade is detected iff resolved rank < requested rank; probe the boundary using PATCH (rank 2).
    const eff = deriveEffectiveContract({ requested: patchRequest, resolvedProfile: name });
    const shouldBlock = rank < PROFILE_RANK.PATCH_PRODUCER;
    assert.equal(eff.downgradeBlocked, shouldBlock, `downgrade detection for ${name} must match canonical rank ${rank}`);
  }
});

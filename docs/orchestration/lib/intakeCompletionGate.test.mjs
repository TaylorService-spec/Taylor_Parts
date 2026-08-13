// End-to-end regression tests for the completion-semantic gate wired through runIntakeExecution — proves the
// #834/#835/#836/#837 root cause is closed at the RUNTIME level (not just in the pure classifier): a worker
// process that "succeeds" no longer coerces EOS to COMPLETE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runIntakeExecution } from "./intakeExecute.mjs";
import { intakeDigest, resolveWorkIntake } from "./workIntake.mjs";

const NOW = "2026-08-12T07:00:00Z";

function resolved(over = {}) {
  const requestId = over.requestId || "EOS-RT-001";
  const payload = {
    requestId, title: "t", intent: "do the repo-safe thing",
    scope: ["docs/orchestration/work-intake/"], contextScope: ["orchestration"],
    source: { producer: "Owner", provenance: "test" },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "owner authorized", protectedBoundary: null, ...(over.authorizedProfile ? { authorizedExecutionProfile: over.authorizedProfile } : {}) },
    ...(over.execution ? { execution: over.execution } : {}),
    artifactLocation: `docs/orchestration/work-intake/${requestId}.work.json`,
    createdAt: "2026-08-11T05:00:00Z", updatedAt: "2026-08-11T05:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
  };
  const a = { ...payload, sha256: intakeDigest(payload) };
  return resolveWorkIntake({ requestId, location: a.artifactLocation, sha256: a.sha256, bytes: Buffer.from(JSON.stringify(a), "utf8") });
}

const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [{ id: "auth", retrievalPath: "x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", providerCapacityUsage: { concurrency: { used: 0, limit: 1 } }, sourceFreshness: "CURRENT" };
const mockLease = () => { let held = false; return { acquire: () => (!held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; };
// A worker whose stdout is `run`; defaults to a clean, normally-terminating completion.
const worker = (stdoutObj = { result: "did the thing", total_cost_usd: 0 }) => ({ run: () => ({ stdout: JSON.stringify(stdoutObj), exitCode: 0, timedOut: false }) });
const drive = (artifact, w) => runIntakeExecution({ artifact, now: NOW, processRunner: w, lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });

test("POSITIVE: analysis task + clean completion => COMPLETE with a durable result + REVIEW_READY", () => {
  const r = drive(resolved(), worker());
  assert.equal(r.disposition, "COMPLETE");
  assert.equal(r.completion.state, "COMPLETE");
  assert.equal(r.status.state, "COMPLETE");
  assert.ok(r.result && r.reviewReady);
});

test("#835 REGRESSION: implementation task, worker 'succeeds' (receipts+verifier) but no governed PATCH produced => AWAITING_ARTIFACTIZATION, NOT COMPLETE, NO result", () => {
  const r = drive(resolved({ execution: { taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PATCH" } }), worker({ result: { evidence: { receipts: ["tests"], verifier: "PASS" } }, total_cost_usd: 0 }));
  assert.equal(r.disposition, "AWAITING_ARTIFACTIZATION");
  assert.equal(r.status.state, "AWAITING_ARTIFACTIZATION");
  assert.notEqual(r.disposition, "COMPLETE");
  assert.equal(r.result, undefined, "no fabricated result on a non-complete outcome");
  assert.equal(r.reviewReady, undefined);
});

test("#834 REGRESSION: task requires test receipts, worker ran without them => BLOCKED_EXECUTION, NEVER COMPLETE", () => {
  const r = drive(resolved({ execution: { expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"] } }), worker({ result: { evidence: { receipts: [] } }, total_cost_usd: 0 }));
  assert.equal(r.disposition, "BLOCKED_EXECUTION");
  assert.equal(r.status.state, "BLOCKED_EXECUTION");
  assert.equal(r.result, undefined);
});

test("#836/#837 REGRESSION: worker hits the turn ceiling (subtype error_max_turns) => RETURN_FOR_CORRECTION, fail closed, NOT COMPLETE", () => {
  const r = drive(resolved(), worker({ result: "partial work", subtype: "error_max_turns", is_error: true }));
  assert.equal(r.wake.failureKind, "MAX_TURNS_EXHAUSTED");
  assert.equal(r.wake.runtimeTermination, "MAX_TURNS_EXHAUSTED");
  assert.equal(r.disposition, "RETURN_FOR_CORRECTION");
  assert.equal(r.status.state, "CORRECTING");
  assert.equal(r.result, undefined);
});

test("#834-adjacent: a satisfied implementation task (receipts + declared PATCH artifact) DOES COMPLETE", () => {
  const r = drive(
    resolved({ execution: { expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"] } }),
    worker({ result: { evidence: { receipts: ["tests"], artifacts: ["PATCH"] } }, total_cost_usd: 0 }),
  );
  assert.equal(r.disposition, "COMPLETE");
  assert.ok(r.result);
});

test("hard process failure (nonzero exit) still reports FAILED, not a semantic state", () => {
  const r = drive(resolved(), { run: () => ({ stdout: "", exitCode: 1, timedOut: false }) });
  assert.equal(r.disposition, "FAILED");
  assert.equal(r.result, undefined);
});

test("LEAST-PRIVILEGE: an ordinary analysis wake runs READ_ONLY_ANALYSIS (no Write authority)", () => {
  const r = drive(resolved(), worker());
  assert.equal(r.wake.profile, "READ_ONLY_ANALYSIS");
  assert.equal(r.wake.turnCeiling, 40);
  assert.equal(r.profileDecision.granted, true);
});

test("LEAST-PRIVILEGE: a PATCH task WITHOUT a governed grant cannot self-escalate — runs READ_ONLY_ANALYSIS, fails closed", () => {
  const r = drive(resolved({ execution: { taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PATCH" } }), worker());
  assert.equal(r.wake.profile, "READ_ONLY_ANALYSIS", "request alone never grants PATCH_PRODUCER authority");
  assert.equal(r.profileDecision.granted, false);
  // read-only can't run the required tests → missing receipts → fails closed (never COMPLETE)
  assert.equal(r.disposition, "BLOCKED_EXECUTION");
  assert.notEqual(r.disposition, "COMPLETE");
});

test("LEAST-PRIVILEGE: a PATCH task WITH a governed authorization grant runs PATCH_PRODUCER and can COMPLETE", () => {
  const r = drive(
    resolved({ execution: { taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"] }, authorizedProfile: "PATCH_PRODUCER" }),
    worker({ result: { evidence: { receipts: ["tests"], artifacts: ["PATCH"], verifier: "PASS" } }, total_cost_usd: 0 }),
  );
  assert.equal(r.wake.profile, "PATCH_PRODUCER");
  assert.equal(r.wake.turnCeiling, 80);
  assert.equal(r.profileDecision.granted, true);
  assert.equal(r.disposition, "COMPLETE");
});

test("EXACT #840: implementation issue, NO governed grant, worker read-only reports tool-permission-blocked => never COMPLETE", () => {
  // The real #840 shape: implementation request, launched under READ_ONLY_ANALYSIS (no governed grant),
  // sourcePaths:[] / no patch artifact, worker explicitly reports its tools were permission-blocked.
  const r = drive(
    resolved({ execution: { taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"], verifierRequired: true } }),
    worker({ result: { evidence: { toolPermissionBlocked: true, receipts: [], artifacts: [] } }, total_cost_usd: 0 }),
  );
  assert.equal(r.wake.profile, "READ_ONLY_ANALYSIS", "no grant → runs least-privilege, cannot implement");
  assert.equal(r.profileDecision.granted, false);
  assert.equal(r.disposition, "BLOCKED_EXECUTION", "tool-permission-blocked => BLOCKED_EXECUTION");
  assert.notEqual(r.disposition, "COMPLETE");
  assert.equal(r.result, undefined);
});

test("EXACT #840 converse: same implementation request WITH a governed PATCH grant + patch + receipts + verifier PASS => COMPLETE", () => {
  const r = drive(
    resolved({ execution: { taskClass: "PATCH_PRODUCER", expectedArtifactClass: "PATCH", requiredExecutionReceipts: ["tests"], verifierRequired: true }, authorizedProfile: "PATCH_PRODUCER" }),
    worker({ result: { evidence: { receipts: ["tests"], artifacts: ["PATCH"], verifier: "PASS" } }, total_cost_usd: 0 }),
  );
  assert.equal(r.wake.profile, "PATCH_PRODUCER");
  assert.equal(r.disposition, "COMPLETE");
});

// ── #868: the READ_ONLY_VERIFY receipt-gate deadlock, end-to-end through runIntakeExecution ───────────────
test("#868 REPRO→FIX: READ_ONLY_VERIFY request GRANTED only READ_ONLY_ANALYSIS may dispatch and COMPLETE (no unprovable tests receipt required)", () => {
  // The exact #864 shape: taskClass READ_ONLY_VERIFY (wants a tests receipt) but grant READ_ONLY_ANALYSIS
  // (no test-run capability). Before the fix this dead-locked as BLOCKED_EXECUTION "required execution receipts
  // missing: tests" even though the worker completed the authorized read-only verification.
  const r = drive(
    resolved({ execution: { taskClass: "READ_ONLY_VERIFY", requiredExecutionReceipts: ["tests"], verifierRequired: false }, authorizedProfile: "READ_ONLY_ANALYSIS" }),
    worker({ result: "read-only verification analysis complete", total_cost_usd: 0 }),
  );
  assert.equal(r.wake.profile, "READ_ONLY_ANALYSIS", "runs under the granted least-privilege profile — no widening");
  assert.equal(r.profileDecision.granted, false, "the VERIFY escalation was not granted; it ran read-only");
  assert.equal(r.disposition, "COMPLETE", "the authorized read-only work COMPLETEs instead of dead-locking");
  assert.ok(r.result && r.reviewReady, "a durable result + REVIEW_READY are produced");
});

test("#868: READ_ONLY_VERIFY request GRANTED READ_ONLY_VERIFY still cannot COMPLETE without the tests receipt (post-execution proof kept, fail-closed)", () => {
  const r = drive(
    resolved({ execution: { taskClass: "READ_ONLY_VERIFY", requiredExecutionReceipts: ["tests"], verifierRequired: false }, authorizedProfile: "READ_ONLY_VERIFY" }),
    worker({ result: { evidence: { receipts: [] } }, total_cost_usd: 0 }),
  );
  assert.equal(r.wake.profile, "READ_ONLY_VERIFY", "a granted VERIFY runs under VERIFY (can run tests)");
  assert.equal(r.disposition, "BLOCKED_EXECUTION", "a grant that CAN run tests must present the receipt to COMPLETE");
  assert.equal(r.result, undefined, "no fabricated result when the required post-execution receipt is missing");
});

test("#868: READ_ONLY_VERIFY request GRANTED READ_ONLY_VERIFY WITH the tests receipt COMPLETEs", () => {
  const r = drive(
    resolved({ execution: { taskClass: "READ_ONLY_VERIFY", requiredExecutionReceipts: ["tests"], verifierRequired: false }, authorizedProfile: "READ_ONLY_VERIFY" }),
    worker({ result: { evidence: { receipts: ["tests"] } }, total_cost_usd: 0 }),
  );
  assert.equal(r.wake.profile, "READ_ONLY_VERIFY");
  assert.equal(r.disposition, "COMPLETE");
  assert.ok(r.result);
});

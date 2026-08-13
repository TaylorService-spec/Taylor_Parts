import { test } from "node:test";
import assert from "node:assert/strict";
import { runIntakeExecution } from "./intakeExecute.mjs";
import { intakeDigest, resolveWorkIntake, sha256Bytes } from "./workIntake.mjs";
import { verifyIntakeStatus } from "./intakeStatus.mjs";

const NOW = "2026-08-11T07:00:00Z";

function resolved(over = {}) {
  const requestId = over.requestId || "EOS-EXEC-001";
  const payload = {
    requestId, title: "t", intent: "do the repo-safe thing",
    scope: ["docs/orchestration/work-intake/"], contextScope: ["orchestration"],
    source: { producer: "Owner", provenance: "test" },
    status: over.status || "EXECUTION_AUTHORIZED",
    authority: over.authority || { authorizationState: "AUTHORIZED", basis: "owner authorized", protectedBoundary: null },
    artifactLocation: `docs/orchestration/work-intake/${requestId}.work.json`,
    createdAt: "2026-08-11T05:00:00Z", updatedAt: "2026-08-11T05:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
  };
  const a = { ...payload, sha256: intakeDigest(payload) };
  return resolveWorkIntake({ requestId, location: a.artifactLocation, sha256: a.sha256, bytes: Buffer.from(JSON.stringify(a), "utf8") });
}

const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [{ id: "auth", retrievalPath: "x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5, sourceFreshness: "CURRENT" };
const mockWorker = (opts = {}) => { const calls = []; return { calls, run(a) { calls.push(a); return opts.run || { stdout: JSON.stringify({ result: "# EOS-EXEC-001 result\nworker did the thing\n", total_cost_usd: 0 }), exitCode: 0, timedOut: false }; } }; };
const mockLease = (acquired = true) => { let held = false; return { acquire: () => (acquired && !held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; };

test("EXECUTION_AUTHORIZED + free slot + worker → COMPLETE; content-addressed result persists + verifies", () => {
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, processRunner: mockWorker(), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(r.disposition, "COMPLETE");
  assert.equal(r.executed, true);
  assert.equal(r.wake.outcome, "SPAWNED_COMPLETED");
  assert.equal(r.status.state, "COMPLETE");
  assert.equal(r.status.actualProviderCostUsd, "UNKNOWN");
  assert.equal(r.status.estimatedExecutionCostUsd, 0);
  assert.equal(r.status.costProvenance.estimated, "CLAUDE_CLI_MODELED");
  assert.equal(verifyIntakeStatus(r.status).ok, true);
  // COMPLETE status carries the exact result manifest ref
  assert.equal(r.status.resultRef.location, r.result.manifestLocation);
  assert.equal(r.status.resultRef.sha256, r.result.manifest.sha256);
  // result content address verifies
  assert.equal(r.result.manifest.contentSha256, sha256Bytes(r.result.content));
  assert.equal(r.result.index.pointer, "result://EOS-EXEC-001");
});

test("DESIGN_STAGING → not executed (worker never runs), status STAGED, no result", () => {
  const worker = mockWorker();
  const r = runIntakeExecution({ artifact: resolved({ status: "DESIGN_STAGING", authority: { authorizationState: "REPO_SAFE", basis: "b", protectedBoundary: null } }), now: NOW, processRunner: worker, lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(r.disposition, "STAGED");
  assert.equal(r.executed, false);
  assert.equal(r.status.state, "STAGED");
  assert.equal(r.result, undefined);
  assert.equal(worker.calls.length, 0, "no spawn on a non-executable stage");
});

test("EXECUTION_AUTHORIZED requiring OPENAI_REVIEW + no broker → BLOCKED, zero spawn, no fabricated result", () => {
  const worker = mockWorker();
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, requiresCapabilities: ["OPENAI_REVIEW"], capabilityBroker: null, processRunner: worker, lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(r.disposition, "BLOCKED");
  assert.equal(r.status.state, "BLOCKED");
  assert.equal(worker.calls.length, 0);
  assert.equal(r.result, undefined);
});

test("EXECUTION_AUTHORIZED requiring OPENAI_REVIEW WITH a broker that has it → executes (injected) → COMPLETE", () => {
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, requiresCapabilities: ["OPENAI_REVIEW"], capabilityBroker: { hasCapability: () => true }, processRunner: mockWorker(), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(r.disposition, "COMPLETE");
  assert.equal(r.status.state, "COMPLETE");
});

test("worker fails (nonzero exit) → FAILED; never reported COMPLETE, no result persisted", () => {
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, processRunner: mockWorker({ run: { exitCode: 2, stdout: "", stderr: "boom" } }), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(r.disposition, "FAILED");
  assert.equal(r.wake.outcome, "SPAWNED_FAILED");
  assert.equal(r.wake.failureKind, "NONZERO_EXIT");
  assert.equal(r.status.state, "FAILED");
  assert.equal(r.result, undefined);
});

test("lease held → HELD (spawn zero); not COMPLETE", () => {
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, processRunner: mockWorker(), lease: mockLease(false), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.notEqual(r.disposition, "COMPLETE");
  assert.equal(r.wake.outcome, "HELD");
  assert.notEqual(r.status.state, "COMPLETE");
});

test("no secret/key appears in the execution status or result", () => {
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, processRunner: mockWorker(), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  const blob = JSON.stringify(r.status) + JSON.stringify(r.result.manifest);
  assert.doesNotMatch(blob, /sk-[A-Za-z0-9]|AIza|Bearer |OPENAI_API_KEY|api[_-]?key/i);
});

test("COMPLETE emits a minimal REVIEW_READY signal pointing at the content-addressed result", () => {
  const r = runIntakeExecution({ artifact: resolved(), now: NOW, processRunner: mockWorker(), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(r.disposition, "COMPLETE");
  assert.ok(r.reviewReady, "COMPLETE must emit a review-ready signal");
  assert.equal(r.reviewReady.event, "REVIEW_READY");
  assert.equal(r.reviewReady.workId, "EOS-EXEC-001");
  assert.equal(r.reviewReady.artifact, r.result.contentLocation); // ChatGPT retrieves this path from GitHub
  assert.equal(r.reviewReady.commit, null); // landing commit unknown at emit time → default-branch HEAD
});

test("a refusal (STAGED/BLOCKED/FAILED) emits NO review-ready signal — only completed work is announced", () => {
  const staged = runIntakeExecution({ artifact: resolved({ status: "DESIGN_STAGING" }), now: NOW, processRunner: mockWorker(), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(staged.disposition, "STAGED");
  assert.equal(staged.reviewReady, undefined);
  const failed = runIntakeExecution({ artifact: resolved(), now: NOW, processRunner: mockWorker({ run: { stdout: "", exitCode: 1, timedOut: false } }), lease: mockLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT });
  assert.equal(failed.disposition, "FAILED");
  assert.equal(failed.reviewReady, undefined);
});

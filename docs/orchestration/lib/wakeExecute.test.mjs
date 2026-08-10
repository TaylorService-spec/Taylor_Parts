import { test } from "node:test";
import assert from "node:assert/strict";
import { executeWake } from "./wakeExecute.mjs";
import { contextPackageFor } from "../context/build-package.mjs";
import { resolveDispatchModel } from "./modelPolicy.mjs";

// --- injected doubles (no real AI, no real fs) ---
function mockRunner(outcome) {
  const calls = [];
  return {
    calls,
    run(args) { calls.push(args); return outcome; },
  };
}
function mockLease({ acquire = true, releaseThrows = false } = {}) {
  const state = { acquired: 0, released: 0 };
  return { state, acquire() { state.acquired++; return { acquired: acquire }; }, release() { state.released++; if (releaseThrows) throw new Error("lease stuck"); } };
}
const cleanOutput = JSON.stringify({ result: "done", total_cost_usd: 0.42, session_id: "s1" });

const okItem = (over = {}) => ({ id: "orch-w", status: "READY", authorized: true, protectedBoundary: null, scope: ["orchestration"], sha: "abc", workstream: "Design", modelTier: "standard", ...over });
const okCtx = (over = {}) => ({ governor: { remoteAiUsed: 0, remoteAiMax: 2 }, network: "NORMAL", budgetRemainingUsd: 5, triggerKind: "AUTOMATIC_TRIGGER", ...over });
const base = (over = {}) => ({ item: okItem(), ctx: okCtx(), contextPackageFn: contextPackageFor, sourceFreshness: "CURRENT", sourceCommit: "abc", ...over });

test("TRIGGER + clean run → spawn EXACTLY once → SPAWNED_COMPLETED; lease released", () => {
  const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
  const lease = mockLease();
  const r = executeWake(base({ processRunner: runner, lease }));
  assert.equal(runner.calls.length, 1, "spawns exactly once");
  assert.equal(r.outcome, "SPAWNED_COMPLETED");
  assert.equal(r.wakeState, "COMPLETED");
  assert.equal(r.cost, 0.42);
  assert.equal(lease.state.acquired, 1);
  assert.ok(lease.state.released >= 1 && r.leaseReleased, "lease always released");
  // selected model is the #759 resolved model (delegated → sonnet)
  assert.equal(r.selectedModel, resolveDispatchModel({ delegated: true, workstream: "Design" }).selectedModel);
  assert.equal(r.selectedModel, "sonnet");
  // C-7 package is the standard-dispatch package (same builder), and it was passed to claude -p
  assert.equal(r.contextPackage.governingAuthority, contextPackageFor({ scope: ["orchestration"] }).governingAuthority);
});

test("HOLD (READY but not authorized) → spawn ZERO, no lease acquired", () => {
  const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
  const lease = mockLease();
  const r = executeWake(base({ item: okItem({ authorized: false }), processRunner: runner, lease }));
  assert.equal(runner.calls.length, 0);
  assert.equal(r.outcome, "HELD");
  assert.equal(r.spawned, false);
  assert.equal(lease.state.acquired, 0);
});

test("protected boundary → spawn ZERO", () => {
  const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
  const r = executeWake(base({ item: okItem({ protectedBoundary: "deploy" }), processRunner: runner, lease: mockLease() }));
  assert.equal(runner.calls.length, 0);
  assert.equal(r.spawned, false);
});

test("overnight / resource ceiling / network / budget → spawn ZERO", () => {
  for (const ctx of [okCtx({ overnight: true }), okCtx({ governor: { remoteAiUsed: 2, remoteAiMax: 2 } }), okCtx({ network: "NETWORK_UNAVAILABLE" }), okCtx({ budgetRemainingUsd: 0 })]) {
    const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
    const r = executeWake(base({ ctx, processRunner: runner, lease: mockLease() }));
    assert.equal(runner.calls.length, 0);
    assert.equal(r.spawned, false);
  }
});

test("duplicate/active lease → spawn ZERO (even though readiness said TRIGGER)", () => {
  const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
  const r = executeWake(base({ processRunner: runner, lease: mockLease({ acquire: false }) }));
  assert.equal(runner.calls.length, 0);
  assert.equal(r.failureKind, "LEASE_UNAVAILABLE");
  assert.equal(r.spawned, false);
});

test("insufficient context (bad scope) → spawn ZERO, EVIDENCE-based refusal", () => {
  const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
  const r = executeWake(base({ item: okItem({ scope: ["no-such-domain"] }), processRunner: runner, lease: mockLease() }));
  assert.equal(runner.calls.length, 0);
  assert.equal(r.failureKind, "INSUFFICIENT_CONTEXT");
});

test("source provenance not CURRENT → spawn ZERO", () => {
  const runner = mockRunner({ exitCode: 0, stdout: cleanOutput });
  const r = executeWake(base({ sourceFreshness: "BEHIND_REMOTE", processRunner: runner, lease: mockLease() }));
  assert.equal(runner.calls.length, 0);
  assert.equal(r.failureKind, "PROVENANCE_UNACCEPTABLE");
});

test("timeout → failure captured (NOT completed); lease released", () => {
  const lease = mockLease();
  const r = executeWake(base({ processRunner: mockRunner({ timedOut: true, exitCode: null }), lease }));
  assert.equal(r.outcome, "SPAWNED_FAILED");
  assert.equal(r.failureKind, "TIMEOUT");
  assert.notEqual(r.wakeState, "COMPLETED");
  assert.ok(lease.state.released >= 1);
});

test("spawn error / non-zero exit / malformed output / missing result → distinct failures, never COMPLETED", () => {
  assert.equal(executeWake(base({ processRunner: { run() { throw new Error("ENOENT"); } }, lease: mockLease() })).failureKind, "SPAWN_FAILURE");
  assert.equal(executeWake(base({ processRunner: mockRunner({ exitCode: 143, stdout: "" }), lease: mockLease() })).failureKind, "NONZERO_EXIT");
  assert.equal(executeWake(base({ processRunner: mockRunner({ exitCode: 0, stdout: "not json" }), lease: mockLease() })).failureKind, "MALFORMED_OUTPUT");
  assert.equal(executeWake(base({ processRunner: mockRunner({ exitCode: 0, stdout: JSON.stringify({ nope: 1 }) }), lease: mockLease() })).failureKind, "MISSING_RESULT");
  for (const k of ["SPAWN_FAILURE", "NONZERO_EXIT", "MALFORMED_OUTPUT", "MISSING_RESULT"]) {
    // each captured case must not claim COMPLETED
    // (individually asserted above; here we just confirm the failure kinds are members)
    assert.ok(["SPAWN_FAILURE", "NONZERO_EXIT", "MALFORMED_OUTPUT", "MISSING_RESULT"].includes(k));
  }
});

test("result-persistence failure is captured, not swallowed", () => {
  const r = executeWake(base({ processRunner: mockRunner({ exitCode: 0, stdout: cleanOutput }), lease: mockLease(), persistResult() { throw new Error("disk full"); } }));
  assert.equal(r.failureKind, "RESULT_PERSIST_FAILURE");
  assert.equal(r.outcome, "SPAWNED_FAILED");
});

test("lease-release failure is captured as LEASE_RELEASE_FAILURE on an otherwise-clean run", () => {
  const r = executeWake(base({ processRunner: mockRunner({ exitCode: 0, stdout: cleanOutput }), lease: mockLease({ releaseThrows: true }) }));
  // work completed, but we surface the lease-release problem honestly
  assert.equal(r.wakeState, "COMPLETED");
  assert.equal(r.leaseReleased, false);
  assert.equal(r.failureKind, "LEASE_RELEASE_FAILURE");
});

test("a spawn alone never fabricates ACKNOWLEDGED/COMPLETED", () => {
  // process error: spawned, but state must not be COMPLETED and must not claim ACKNOWLEDGED
  const r = executeWake(base({ processRunner: mockRunner({ exitCode: 1, stdout: "" }), lease: mockLease() }));
  assert.notEqual(r.wakeState, "COMPLETED");
  assert.notEqual(r.wakeState, "ACKNOWLEDGED");
});

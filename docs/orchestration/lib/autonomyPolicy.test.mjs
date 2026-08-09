// Tests for the Option-B bounded autonomy policy (Phase 5, DESIGN ONLY). Run:
//   node --test docs/orchestration/lib/autonomyPolicy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSED_AUTONOMY_POLICY, classifyBudget, retryDecision, failureContainment,
  shouldCheckpoint, recoveryConcurrency, hardStopReason,
} from "./autonomyPolicy.mjs";

test("ceilings are unchanged from Phase 3/4 (2/1/1) — policy does not raise concurrency", () => {
  assert.equal(PROPOSED_AUTONOMY_POLICY.maxRemoteConcurrency, 2);
  assert.equal(PROPOSED_AUTONOMY_POLICY.browserRemoteConcurrency, 1);
  assert.equal(PROPOSED_AUTONOMY_POLICY.networkHeavyConcurrency, 1);
});

test("budget: warn at the fraction, BUDGET_LIMIT at the ceiling (dispatch or token proxy)", () => {
  assert.equal(classifyBudget({ remoteDispatches: 5 }).state, "OK");
  assert.equal(classifyBudget({ remoteDispatches: 15 }).state, "BUDGET_WARN"); // 15/20 = 0.75
  assert.equal(classifyBudget({ remoteDispatches: 20 }).state, "BUDGET_LIMIT");
  assert.equal(classifyBudget({ exposedSubagentTokens: 1_000_000 }).state, "BUDGET_LIMIT");
});

test("retry is network-aware: never retry against a degraded link (no retry storm)", () => {
  assert.equal(retryDecision({ attempt: 0, networkState: "NETWORK_UNAVAILABLE" }).decision, "HOLD");
  assert.equal(retryDecision({ attempt: 0, networkState: "NETWORK_PRESSURE" }).decision, "HOLD");
  assert.equal(retryDecision({ attempt: 0, networkState: "NORMAL" }).decision, "RETRY");
  assert.equal(retryDecision({ attempt: 1, networkState: "NORMAL" }).decision, "GIVE_UP"); // maxRetries=1
});

test("backoff grows exponentially and is capped", () => {
  assert.equal(retryDecision({ attempt: 0 }).backoffSeconds, 30);
  const policy = { ...PROPOSED_AUTONOMY_POLICY, maxRetriesPerRequest: 5 };
  assert.equal(retryDecision({ attempt: 4 }, policy).backoffSeconds, 300); // capped at backoffMaxSeconds
});

test("failure containment hard-stops after N consecutive failures", () => {
  assert.equal(failureContainment(2).decision, "CONTINUE");
  assert.equal(failureContainment(3).decision, "HARD_STOP");
});

test("checkpoint triggers (earliest wins) — and a checkpoint is not a gate", () => {
  assert.deepEqual(shouldCheckpoint({}).triggers, []);
  assert.ok(shouldCheckpoint({ minutesElapsed: 30 }).checkpoint);
  assert.ok(shouldCheckpoint({ incrementsSinceCheckpoint: 3 }).checkpoint);
  assert.ok(shouldCheckpoint({ networkEvent: true }).triggers.includes("NETWORK_EVENT"));
  assert.ok(shouldCheckpoint({ contextPressure: true }).triggers.includes("CONTEXT_PRESSURE"));
});

test("recovery: one remote worker first, full capacity only after the stability window", () => {
  assert.equal(recoveryConcurrency({ networkState: "NETWORK_UNAVAILABLE" }).remoteAllowed, 0);
  assert.equal(recoveryConcurrency({ networkState: "NETWORK_PRESSURE" }).remoteAllowed, 0);
  assert.equal(recoveryConcurrency({ networkState: "RECOVERY", sustainedHealthySamples: 3 }).remoteAllowed, 1);
  assert.equal(recoveryConcurrency({ networkState: "RECOVERY", sustainedHealthySamples: 12 }).remoteAllowed, 2);
  assert.equal(recoveryConcurrency({ networkState: "NORMAL" }).remoteAllowed, 2);
});

test("hard-stop reasons: protected/owner/budget/failures/network/window — else continue", () => {
  assert.equal(hardStopReason({}), null); // continue autonomously
  assert.equal(hardStopReason({ protectedBoundaryReached: true }), "PROTECTED_ACTION");
  assert.equal(hardStopReason({ ownerDecisionRequired: true }), "OWNER_DECISION");
  assert.equal(hardStopReason({ budgetState: "BUDGET_LIMIT" }), "BUDGET_LIMIT");
  assert.equal(hardStopReason({ consecutiveFailures: 3 }), "FAILURE_CONTAINMENT");
  assert.equal(hardStopReason({ networkUnavailableMinutes: 30 }), "NETWORK_UNAVAILABLE_TOO_LONG");
  assert.equal(hardStopReason({ minutesElapsed: 90 }), "WORK_WINDOW_ELAPSED");
});

test("stability window is evidence-derived: 60s at the 5s telemetry interval = 12 samples", () => {
  assert.equal(PROPOSED_AUTONOMY_POLICY.recoveryStabilityWindowSeconds, 60);
  assert.equal(PROPOSED_AUTONOMY_POLICY.recoveryStabilitySamples, 12);
});

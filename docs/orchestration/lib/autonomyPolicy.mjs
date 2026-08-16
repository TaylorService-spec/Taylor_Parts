import { classifyFailure } from "./failureClassification.mjs";
import { assessOwnerCapacity, ownerReserveStopReason } from "./ownerCapacityReserve.mjs";
import { assessStagnation } from "./progressDetection.mjs";
// Option-B bounded autonomy policy (Phase 5) — DESIGN ONLY, NOT ACTIVATED.
//
// Pure, tested parameters + decision functions for eventual unattended operation.
// Defining this does NOT turn Option B on: Option A (in-session /loop) remains
// current, ceilings stay 2/1/1, and the Owner ratifies activation separately (§7).
//
// The parameters below are CONSERVATIVE INITIAL PROPOSALS informed by evidence
// (5s telemetry interval; Phase-4 window healthy at 2 concurrent). They are pending
// Owner ratification and are easy to tune — they are data, not hard-coded behavior.
//
// Core principle: budget exhaustion, context pressure, and network loss are NOT
// Product failures. They map to BUDGET_LIMIT / SAFE_CHECKPOINT / network states and
// preserve resumable durable state (the backlog + agent-requests ledger).

export const PROPOSED_AUTONOMY_POLICY = Object.freeze({
  // Work window: about one substantial engineering window per unattended run.
  maxWorkWindowMinutes: 90,
  // Concurrency: UNCHANGED from Phase 3/4 — do not increase.
  maxRemoteConcurrency: 2,
  browserRemoteConcurrency: 1,
  networkHeavyConcurrency: 1,
  // Budget: exact main-loop tokens are NOT exposed by this runtime, so the measurable
  // ceilings are countable proxies + the exposed subagent-token sum. Never fabricated.
  maxRemoteDispatchesPerWindow: 20,
  maxExposedSubagentTokensPerWindow: 1_000_000,
  budgetWarnFraction: 0.75, // checkpoint when a ceiling crosses this fraction
  // Retries / backoff.
  maxRetriesPerRequest: 1,
  backoffBaseSeconds: 30,
  backoffFactor: 2,
  backoffMaxSeconds: 300,
  // Failure containment.
  maxConsecutiveWorkerFailures: 3, // hard stop after this many in a row
  // Checkpoint cadence (earliest trigger wins).
  checkpointEveryMinutes: 30,
  checkpointEveryIncrements: 3,
  // Network recovery.
  recoveryStabilityWindowSeconds: 60,   // sustained health required before restoring full capacity
  recoveryStabilitySamples: 12,         // 60s / 5s telemetry interval
  recoveryFirstRemoteConcurrency: 1,    // permit ONE remote worker first during recovery
  networkUnavailableMaxMinutes: 30,     // beyond this, checkpoint + stop launching new remote work
});

// --- Budget ---
export function classifyBudget(spent = {}, policy = PROPOSED_AUTONOMY_POLICY) {
  const dispatches = spent.remoteDispatches || 0;
  const tokens = spent.exposedSubagentTokens || 0;
  const dispatchFrac = dispatches / policy.maxRemoteDispatchesPerWindow;
  const tokenFrac = tokens / policy.maxExposedSubagentTokensPerWindow;
  const frac = Math.max(dispatchFrac, tokenFrac);
  if (frac >= 1) return { state: "BUDGET_LIMIT", frac, reason: dispatchFrac >= 1 ? "MAX_DISPATCHES" : "MAX_TOKENS" };
  if (frac >= policy.budgetWarnFraction) return { state: "BUDGET_WARN", frac };
  return { state: "OK", frac };
}

// --- Retries / backoff (network-aware: no retry storm) ---
export function retryDecision({ attempt = 0, networkState = "NORMAL", failure = null } = {}, policy = PROPOSED_AUTONOMY_POLICY) {
  // CLASSIFY BEFORE RETRYING (eos-operational-authorization.md §6). Attempt count alone cannot
  // distinguish a transient blip from a deterministic denial -- which is how a workflows-permission
  // rejection was retried FIVE TIMES on 2026-08-13. When the caller supplies the failure, a
  // non-retryable class fails FAST and once. Optional, so existing callers are unaffected.
  if (failure) {
    const c = classifyFailure(failure);
    if (!c.retryable) {
      return { decision: "FAIL_FAST", reason: c.failureClass, detail: c.reason, backoffSeconds: null };
    }
  }
  if (networkState === "NETWORK_UNAVAILABLE" || networkState === "NETWORK_PRESSURE") {
    return { decision: "HOLD", reason: "NETWORK_NOT_NORMAL", backoffSeconds: null }; // do not retry against a degraded link
  }
  if (attempt >= policy.maxRetriesPerRequest) return { decision: "GIVE_UP", backoffSeconds: null };
  const backoff = Math.min(policy.backoffMaxSeconds, policy.backoffBaseSeconds * policy.backoffFactor ** attempt);
  return { decision: "RETRY", backoffSeconds: backoff };
}

// --- Failure containment ---
export function failureContainment(consecutiveFailures = 0, policy = PROPOSED_AUTONOMY_POLICY) {
  return consecutiveFailures >= policy.maxConsecutiveWorkerFailures
    ? { decision: "HARD_STOP", reason: "CONSECUTIVE_WORKER_FAILURES" }
    : { decision: "CONTINUE" };
}

// --- Checkpoint cadence (checkpoint != approval gate) ---
export function shouldCheckpoint(ctx = {}, policy = PROPOSED_AUTONOMY_POLICY) {
  const triggers = [];
  if ((ctx.minutesElapsed || 0) >= policy.checkpointEveryMinutes) triggers.push("ELAPSED_TIME");
  if ((ctx.incrementsSinceCheckpoint || 0) >= policy.checkpointEveryIncrements) triggers.push("INCREMENTS");
  if (ctx.majorDomainTransition) triggers.push("DOMAIN_TRANSITION");
  if (ctx.budgetState === "BUDGET_WARN" || ctx.budgetState === "BUDGET_LIMIT") triggers.push("BUDGET");
  if (ctx.networkEvent) triggers.push("NETWORK_EVENT");
  if (ctx.significantFinding) triggers.push("SIGNIFICANT_FINDING");
  if (ctx.contextPressure) triggers.push("CONTEXT_PRESSURE");
  return { checkpoint: triggers.length > 0, triggers };
}

// --- Network recovery: how many remote slots are permitted right now ---
export function recoveryConcurrency({ networkState = "NORMAL", sustainedHealthySamples = 0 } = {}, policy = PROPOSED_AUTONOMY_POLICY) {
  if (networkState === "NETWORK_UNAVAILABLE") return { remoteAllowed: 0, reason: "UNAVAILABLE_STOP_NEW_REMOTE" };
  if (networkState === "NETWORK_PRESSURE") return { remoteAllowed: 0, reason: "PRESSURE_NO_NEW_HEAVY" };
  if (networkState === "RECOVERY") {
    if (sustainedHealthySamples >= policy.recoveryStabilitySamples) return { remoteAllowed: policy.maxRemoteConcurrency, reason: "STABILITY_WINDOW_MET" };
    return { remoteAllowed: policy.recoveryFirstRemoteConcurrency, reason: "RECOVERY_ONE_FIRST" };
  }
  return { remoteAllowed: policy.maxRemoteConcurrency, reason: "NORMAL" };
}

// --- Hard-stop conditions (the only genuine autonomous stops) ---
export function hardStopReason(ctx = {}, policy = PROPOSED_AUTONOMY_POLICY) {
  if (ctx.protectedBoundaryReached) return "PROTECTED_ACTION";
  if (ctx.ownerDecisionRequired) return "OWNER_DECISION";
  if (ctx.budgetState === "BUDGET_LIMIT") return "BUDGET_LIMIT";
  if (failureContainment(ctx.consecutiveFailures || 0, policy).decision === "HARD_STOP") return "FAILURE_CONTAINMENT";
  if ((ctx.networkUnavailableMinutes || 0) >= policy.networkUnavailableMaxMinutes) return "NETWORK_UNAVAILABLE_TOO_LONG";
  if ((ctx.minutesElapsed || 0) >= policy.maxWorkWindowMinutes) return "WORK_WINDOW_ELAPSED";
  // OWNER CAPACITY RESERVE (§4.1). Unattended EOS yields to interactive Owner work. This is a
  // SUSPEND-class reason -- the mission is intact, only this segment pauses until capacity returns.
  if (ctx.ownerCapacity) {
    const reserve = ownerReserveStopReason(assessOwnerCapacity(ctx.ownerCapacity));
    if (reserve) return reserve;
  }
  // STAGNATION (§5.1/5.2) -- the PRIMARY control. The ceilings above catch a run that has gone
  // too long; this catches one that is busy and getting nowhere, which nothing else sees.
  if (ctx.progressWindow) {
    if (assessStagnation(ctx.progressWindow).stagnant) return "STAGNATION_DETECTED";
  }
  return null; // no hard stop — continue autonomously
}

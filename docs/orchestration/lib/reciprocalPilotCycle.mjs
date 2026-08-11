// Bounded ONE-CYCLE reciprocal pilot driver — pure (no I/O, no live calls). It carries a single eligible
// AI_REVIEW all the way through: GPT (injected) → persist → consume → selector → ACTUAL Claude wake via
// the EXISTING Wake Supervisor executeWake (#760, injected process runner + lease). A hard kill switch
// caps the pilot at 1 GPT call, 1 Claude wake, 1 reciprocal cycle — no recursive unlimited loop.
//
// Reuses #772 (runReciprocalReviewCycle / selectEligibleReviews) + #760 (executeWake) — no second
// architecture, no second wake mechanism. Everything with a side effect is INJECTED, so the whole chain
// is unit-tested with fake GPT + Claude runners and NO OpenAI/Claude invocation.

import { runReciprocalReviewCycle, selectEligibleReviews } from "./reciprocalReviewLoop.mjs";
import { executeWake } from "./wakeExecute.mjs";

// One-cycle kill switch (the pilot ceiling).
export const PILOT_CEILING = Object.freeze({ maxGptLiveCalls: 1, maxClaudeAutomaticWakes: 1, maxReciprocalCycles: 1 });

function buildEvidence({ loop, wake, transitions, gptCalls, claudeWakes }) {
  const usages = (loop && loop.perReview || []).map((p) => p.usage).filter(Boolean);
  const gpt = usages[0] || null;
  return {
    gpt: gpt ? { inputTokens: gpt.inputTokens ?? null, outputTokens: gpt.outputTokens ?? null, actualCostUsd: gpt.actualCostUsd ?? null } : null,
    claude: wake && wake.outcome === "SPAWNED_COMPLETED" ? { cost: wake.cost ?? null, selectedModel: wake.selectedModel ?? null, result: wake.result ?? null } : null,
    // The ACTUAL wake outcome + failure reason — reported, never inferred. Includes the child exit code
    // + sanitized stderr/stdout diagnostic for a SPAWNED_FAILED, and the HELD `reason` otherwise.
    claudeOutcome: wake ? { outcome: wake.outcome ?? null, failureKind: wake.failureKind ?? null, reason: wake.reason ?? wake.failureDetail ?? null, exitCode: wake.exitCode ?? null, diagnostic: wake.diagnostic ?? null, wakeState: wake.wakeState ?? null } : null,
    lifecycleTransitions: transitions,
    ownerRelayCount: 0,                                   // no Claude↔GPT relay in the loop
    ownerManualActionCountAfterActivation: 0,            // the pilot performs the chain automatically
    duplicateCallCount: Math.max(0, gptCalls - 1) + Math.max(0, claudeWakes - 1),
    gptCalls, claudeWakes,
  };
}

/**
 * Run ONE bounded reciprocal pilot cycle. Returns full lifecycle evidence and STOPS after a single
 * GPT→Claude continuation. No live call — gptRunner + claudeProcessRunner + wakeLease + contextPackageFn
 * are injected. Authorization comes from DURABLE review state (authorizedForReview) — never from the
 * event; READY ≠ authorization, EVENT ≠ authorization.
 */
export async function runReciprocalPilotCycle({
  reviews = [], backlogItems = [], store,
  gptRunner, claudeProcessRunner, wakeLease, contextPackageFn,
  persistExchange = () => {}, persistWorkerResult = null,
  acquireLease = () => true, releaseLease = () => {},
  sufficiencyOf = () => "SUFFICIENT", freshnessOf = () => "CURRENT", protectedOf = () => false,
  contextPackageRefOf = () => null, provenanceOf = () => null,
  budgetAvailable = true, clock = () => null, wakeCtx = {}, sourceCommit = null, sourceFreshness = "CURRENT",
  ceiling = PILOT_CEILING, cycleState = { cyclesRun: 0 },
} = {}) {
  const transitions = [];
  const t = (s) => transitions.push(s);

  // KILL SWITCH — at most one reciprocal cycle. A second invocation makes no GPT/Claude call.
  if (cycleState.cyclesRun >= ceiling.maxReciprocalCycles) {
    return { ok: false, stopped: "CYCLE_CEILING", reason: `max ${ceiling.maxReciprocalCycles} reciprocal cycle(s) already run`, gptCalls: 0, claudeWakes: 0, transitions };
  }
  // Budget gate (deterministic) — no GPT when budget is unavailable.
  if (budgetAvailable !== true) {
    return { ok: false, stopped: "BUDGET_EXHAUSTED", reason: "budget unavailable — no provider call", gptCalls: 0, claudeWakes: 0, transitions };
  }

  // Bound GPT to ONE call: take only the first eligible review (durable-authorized, non-protected, etc.).
  const { eligible } = selectEligibleReviews(reviews, { store, sufficiencyOf, freshnessOf, protectedOf });
  const pilotReviews = eligible.slice(0, ceiling.maxGptLiveCalls);
  t("CYCLE_START");

  if (pilotReviews.length === 0) {
    return { ok: true, stopped: "NO_ELIGIBLE_REVIEW", reason: "no eligible durable AI_REVIEW", gptCalls: 0, claudeWakes: 0, transitions, evidence: buildEvidence({ loop: null, wake: null, transitions, gptCalls: 0, claudeWakes: 0 }) };
  }

  // Loop over the ONE review: GPT once → persist → consume → selector → WOULD_TRIGGER.
  const loop = await runReciprocalReviewCycle({
    reviews: pilotReviews, backlogItems, store, providerRunner: gptRunner,
    persistExchange, acquireLease, releaseLease,
    sufficiencyOf, freshnessOf, targetsProtectedActionOf: protectedOf, contextPackageRefOf, provenanceOf,
    clock, wakeCtx,
  });
  cycleState.cyclesRun += 1;
  if (loop.providerInvocations > 0) { t("GPT_TRIGGERED"); t("GPT_COMPLETED"); }
  if (loop.perReview.some((p) => p.lifecycle === "CONSUMED")) t("REVIEW_CONSUMED");

  const gptCalls = loop.providerInvocations;

  // No actionable, would-trigger assignment → STOP without a wake (Owner surface / fail-closed).
  if (!loop.wake.wouldTrigger) {
    t(loop.ownerSurfaces.length ? "OWNER_SURFACED_NO_WAKE" : "NO_WAKE");
    t("STOP");
    return { ok: true, stopped: loop.ownerSurfaces.length ? "OWNER_GATE_NO_WAKE" : "NO_WAKE", loop, gptCalls, claudeWakes: 0, ownerSurfaces: loop.ownerSurfaces, relayMetric: loop.relayMetric, transitions, evidence: buildEvidence({ loop, wake: null, transitions, gptCalls, claudeWakes: 0 }) };
  }

  // ACTUAL Claude wake via the EXISTING Wake Supervisor. The compact GPT return context is injected into
  // the woken Claude's C-7 package. assessReadiness inside executeWake re-checks authority≠trigger.
  t("CLAUDE_AUTHORIZED");
  const wakeItem = { ...loop.wake.item, scope: loop.wake.item.scope || ["orchestration"], modelTier: "standard", purpose: "interpret independent review", reviewContext: loop.returnContext };
  const wrappedCtxFn = (args) => { const pkg = contextPackageFn(args); return { ...pkg, reviewReturnContext: loop.returnContext }; };
  const wake = executeWake({
    item: wakeItem, ctx: { triggerKind: "AUTOMATIC_TRIGGER", ...wakeCtx },
    contextPackageFn: wrappedCtxFn, processRunner: claudeProcessRunner, lease: wakeLease,
    persistResult: persistWorkerResult, sourceCommit, sourceFreshness,
  });
  t("CLAUDE_TRIGGERED");
  if (wake.wakeState === "ACTIVE" || wake.wakeState === "COMPLETED") t("CLAUDE_ACTIVE");
  const claudeWakes = wake.outcome === "SPAWNED_COMPLETED" ? 1 : 0;
  t(claudeWakes ? "CLAUDE_COMPLETED" : "CLAUDE_FAILED_OR_HELD");
  t("STOP"); // one continuation cycle only — no recursion

  return {
    ok: wake.outcome === "SPAWNED_COMPLETED",
    stopped: "ONE_CYCLE_COMPLETE",
    loop, wake, gptCalls, claudeWakes, ownerSurfaces: loop.ownerSurfaces, relayMetric: loop.relayMetric,
    transitions, evidence: buildEvidence({ loop, wake, transitions, gptCalls, claudeWakes }),
  };
}

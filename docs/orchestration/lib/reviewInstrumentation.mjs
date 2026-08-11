// Instrumentation for the reciprocal review — TIMING (item 12) + API EFFICIENCY (item 11). The point is a
// truthful, reproducible account of where wall-clock went and where paid tokens went, so a benchmark can be
// compared honestly against a preserved baseline. Nothing here fabricates numbers: timestamps are inputs
// (an injected clock in production, fixed values in tests) and token figures are the estimates the feed
// builder produced, labeled as estimates.
//
// Pure, zero-dependency ESM. Does NOT touch selector / Wake Supervisor / authority model / aiExchange
// lifecycle / provider routing / review semantics.

import { FEED_CATEGORIES } from "./reviewFacts.mjs";

// ---- Timing (item 12) -------------------------------------------------------------------------------

// A phase is ACTIVE processing, a WAIT on a non-owner dependency (a provider call, a spawn), or an
// OWNER_WAIT (blocked on a human). Owner wait is separated because it is never "our" latency.
export const PHASE_KINDS = Object.freeze(["ACTIVE", "WAIT", "OWNER_WAIT"]);

export function makePhase({ name, kind, startedAt, completedAt } = {}) {
  if (!name) throw new Error("makePhase: name required");
  if (!PHASE_KINDS.includes(kind)) throw new Error(`makePhase: unknown kind ${JSON.stringify(kind)}`);
  if (typeof startedAt !== "number" || typeof completedAt !== "number") throw new Error("makePhase: numeric startedAt/completedAt required");
  const elapsedMs = Math.max(0, completedAt - startedAt);
  return Object.freeze({ name, kind, startedAt, completedAt, elapsedMs });
}

/**
 * Roll phases up into a timing summary. totalElapsedMs is the wall-clock span; the three rollups partition
 * time by kind. accountedMs is the sum of phase elapsed — surfaced (not hidden) so any gap between it and
 * totalElapsedMs is visible rather than silently absorbed.
 */
export function summarizeTiming({ startedAt, completedAt, phases = [] } = {}) {
  if (typeof startedAt !== "number" || typeof completedAt !== "number") throw new Error("summarizeTiming: numeric startedAt/completedAt required");
  const rollup = { ACTIVE_PROCESSING_TIME: 0, WAIT_TIME: 0, OWNER_WAIT_TIME: 0 };
  const keyFor = { ACTIVE: "ACTIVE_PROCESSING_TIME", WAIT: "WAIT_TIME", OWNER_WAIT: "OWNER_WAIT_TIME" };
  let accountedMs = 0;
  for (const p of phases) {
    rollup[keyFor[p.kind]] += p.elapsedMs;
    accountedMs += p.elapsedMs;
  }
  return Object.freeze({
    startedAt,
    completedAt,
    totalElapsedMs: Math.max(0, completedAt - startedAt),
    accountedMs,
    unaccountedMs: Math.max(0, (completedAt - startedAt) - accountedMs),
    ...rollup,
    phases,
  });
}

// ---- API efficiency (item 11) -----------------------------------------------------------------------

export const EFFICIENCY_COUNTERS = Object.freeze([
  "artifactsCreated",
  "artifactsReused",
  "hashesReused",
  "duplicateProviderCallsAvoided",
  "wakeOnlyRecoveries",
]);

/**
 * Accumulator for the paid-API efficiency account. recordCall() stores a per-call token breakdown (by the
 * seven FEED_CATEGORIES, plus optional measured input/output tokens); the counters track how often the
 * content-addressed machinery AVOIDED work (reuse, dedup, wake-only recovery). merge() folds a plain
 * counters object (e.g. the one reviewRecovery increments) so the two layers share one truth.
 */
export function makeEfficiencyLedger(initial = {}) {
  const state = {
    calls: [],
    artifactsCreated: 0,
    artifactsReused: 0,
    hashesReused: 0,
    duplicateProviderCallsAvoided: 0,
    wakeOnlyRecoveries: 0,
  };
  for (const c of EFFICIENCY_COUNTERS) if (typeof initial[c] === "number") state[c] = initial[c];

  return {
    /** Record one paid provider call's token breakdown. `breakdown` is a buildFactFeed() breakdown; input/output are optional measured token counts. */
    recordCall({ breakdown = {}, inputTokens = null, outputTokens = null, note = null } = {}) {
      const perCategory = {};
      for (const c of FEED_CATEGORIES) perCategory[c] = Number(breakdown[c] || 0);
      // The structured-output schema is transmitted with the request and counts toward input tokens, so it
      // is attributed as its own category (kept out of FEED_CATEGORIES, which is the fact-feed body).
      const structuredOutputSchema = Number(breakdown.structuredOutputSchema || 0);
      state.calls.push({ perCategory, structuredOutputSchema, estimatedTotal: Number(breakdown.totalEstimate || 0), inputTokens, outputTokens, note });
      return state.calls.length;
    },
    bump(counter, n = 1) {
      if (!EFFICIENCY_COUNTERS.includes(counter)) throw new Error(`bump: unknown counter ${counter}`);
      state[counter] += n;
      return state[counter];
    },
    /** Fold a plain counters object (only the recognized EFFICIENCY_COUNTERS keys are absorbed). */
    merge(counters = {}) {
      for (const c of EFFICIENCY_COUNTERS) if (typeof counters[c] === "number") state[c] += counters[c];
      return this;
    },
    snapshot() {
      const perCategoryTotals = {};
      for (const c of FEED_CATEGORIES) perCategoryTotals[c] = state.calls.reduce((s, call) => s + (call.perCategory[c] || 0), 0);
      perCategoryTotals.structuredOutputSchema = state.calls.reduce((s, call) => s + (call.structuredOutputSchema || 0), 0);
      const measuredInput = state.calls.reduce((s, call) => s + (call.inputTokens || 0), 0);
      const measuredOutput = state.calls.reduce((s, call) => s + (call.outputTokens || 0), 0);
      return {
        providerCalls: state.calls.length,
        calls: state.calls.map((c) => ({ ...c })),
        perCategoryTotals,
        estimatedTotalTokens: state.calls.reduce((s, call) => s + call.estimatedTotal, 0),
        measuredInputTokens: measuredInput,
        measuredOutputTokens: measuredOutput,
        artifactsCreated: state.artifactsCreated,
        artifactsReused: state.artifactsReused,
        hashesReused: state.hashesReused,
        duplicateProviderCallsAvoided: state.duplicateProviderCallsAvoided,
        wakeOnlyRecoveries: state.wakeOnlyRecoveries,
      };
    },
  };
}

// One-trigger Taylor benchmark — the readout + ceiling assessment + durable result artifact. Pure. Given
// the evidence from ONE instrumented reciprocal cycle (runInstrumentedPilotCycle), it computes what the
// benchmark set out to measure: were the hard ceilings respected, how does the paid-token account compare
// to the PRESERVED #319 baseline, and did the run meet the efficiency goals (one paid call when there is no
// correction; smallest necessary context; zero Owner relay). It fabricates nothing — every number traces to
// the cycle evidence or the recorded baseline.
//
// The baseline is the instrumented #319 pilot, preserved verbatim so a regression is visible, never hidden.

import { makeArtifact } from "./reviewArtifacts.mjs";

// The instrumented #319 review + pilot, recorded 2026-08-10 (do not rewrite — it is the comparison point).
export const BENCHMARK_BASELINE = Object.freeze({
  review319: Object.freeze({ gptInputTokens: 7620, gptOutputTokens: 1351, gptCostUsd: 0.031452 }),
  pilot319: Object.freeze({ gptPaidCalls: 2, totalCostUsd: 0.058488, successfulClaudeWakes: 1, ownerAiRelays: 0 }),
});

// Hard ceilings for the benchmark run (the Owner's stated caps).
export const BENCHMARK_CEILING = Object.freeze({
  maxGptPaidCalls: 3,
  maxClaudeWakes: 3,
  maxReciprocalCycles: 3,
  maxOpenAiSpendUsd: 0.10,
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Assess one benchmark cycle result against the ceilings + baseline.
 * @param {{ result, ceiling?, baseline?, cyclesRun?, sourceCommit?, createdAt? }} args
 *   result: the object returned by runInstrumentedPilotCycle (carries gptCalls, claudeWakes, evidence,
 *           instrumentation). cyclesRun: how many reciprocal cycles ran (default 1).
 * @returns {{ readout, artifact }} — a compact readout (PASS/FAIL + per-ceiling + baseline delta) and a
 *   content-addressed `result` artifact carrying the full durable substance.
 */
export function assessBenchmark({ result, ceiling = BENCHMARK_CEILING, baseline = BENCHMARK_BASELINE, cyclesRun = 1, sourceCommit = null, createdAt = null } = {}) {
  const gptCalls = num(result && result.gptCalls);
  const claudeWakes = num(result && result.claudeWakes);
  const gpt = (result && result.evidence && result.evidence.gpt) || {};
  const openAiSpendUsd = num(gpt.actualCostUsd);
  const eff = (result && result.instrumentation && result.instrumentation.efficiency) || {};
  const timing = (result && result.instrumentation && result.instrumentation.timing) || {};

  const ceilings = {
    gptPaidCalls: { value: gptCalls, limit: ceiling.maxGptPaidCalls, within: gptCalls <= ceiling.maxGptPaidCalls },
    claudeWakes: { value: claudeWakes, limit: ceiling.maxClaudeWakes, within: claudeWakes <= ceiling.maxClaudeWakes },
    reciprocalCycles: { value: cyclesRun, limit: ceiling.maxReciprocalCycles, within: cyclesRun <= ceiling.maxReciprocalCycles },
    openAiSpendUsd: { value: openAiSpendUsd, limit: ceiling.maxOpenAiSpendUsd, within: openAiSpendUsd <= ceiling.maxOpenAiSpendUsd },
  };
  const ceilingsRespected = Object.values(ceilings).every((c) => c.within);

  // Efficiency goals (the point of the fact-feed + content-addressing work): one paid call when there was
  // no correction, and zero Owner AI-to-AI relay.
  const ownerRelays = num(result && result.evidence && result.evidence.ownerRelayCount);
  const goals = {
    singlePaidCallNoCorrection: gptCalls <= 1,
    zeroOwnerRelay: ownerRelays === 0,
    smallerThanBaselineInput: num(eff.measuredInputTokens) > 0 && num(eff.measuredInputTokens) <= baseline.review319.gptInputTokens,
  };

  const baselineDelta = {
    inputTokens: { thisRun: num(eff.measuredInputTokens), baseline: baseline.review319.gptInputTokens, delta: num(eff.measuredInputTokens) - baseline.review319.gptInputTokens },
    outputTokens: { thisRun: num(eff.measuredOutputTokens), baseline: baseline.review319.gptOutputTokens, delta: num(eff.measuredOutputTokens) - baseline.review319.gptOutputTokens },
    gptPaidCalls: { thisRun: gptCalls, baseline: baseline.pilot319.gptPaidCalls, delta: gptCalls - baseline.pilot319.gptPaidCalls },
    totalCostUsd: { thisRun: openAiSpendUsd, baseline: baseline.pilot319.totalCostUsd, delta: Number((openAiSpendUsd - baseline.pilot319.totalCostUsd).toFixed(6)) },
  };

  const pass = ceilingsRespected && goals.zeroOwnerRelay;
  const readout = {
    pass,
    stopped: (result && result.stopped) || null,
    ceilingsRespected,
    ceilings,
    goals,
    gptCalls,
    claudeWakes,
    openAiSpendUsd,
    ownerRelays,
    efficiency: eff,
    timing,
    baselineDelta,
  };

  const artifact = makeArtifact({
    kind: "result",
    content: { benchmark: "taylor-one-trigger", readout, evidence: (result && result.evidence) || null, transitions: (result && result.transitions) || [] },
    location: `docs/orchestration/benchmark/results/${(result && result.stopped) || "UNKNOWN"}-${sourceCommit || "nocommit"}.json`,
    sourceCommit,
    createdAt,
    provenance: { baseline: "instrumented #319 pilot (2026-08-10)" },
  });

  return { readout, artifact };
}

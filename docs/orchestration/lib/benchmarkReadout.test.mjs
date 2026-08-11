import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBenchmark, BENCHMARK_CEILING, BENCHMARK_BASELINE } from "./benchmarkReadout.mjs";
import { verifyArtifact } from "./reviewArtifacts.mjs";

// A minimal instrumented-cycle result shaped like runInstrumentedPilotCycle's return.
function cycle({ gptCalls = 1, claudeWakes = 1, cost = 0.03, inTok = 5000, outTok = 400, relays = 0, stopped = "ONE_CYCLE_COMPLETE" } = {}) {
  return {
    stopped,
    gptCalls,
    claudeWakes,
    evidence: { gpt: { actualCostUsd: cost, inputTokens: inTok, outputTokens: outTok }, ownerRelayCount: relays },
    transitions: ["CYCLE_START", "GPT_TRIGGERED", "CLAUDE_COMPLETED", "STOP"],
    instrumentation: {
      efficiency: { providerCalls: gptCalls, measuredInputTokens: inTok, measuredOutputTokens: outTok, duplicateProviderCallsAvoided: 0, wakeOnlyRecoveries: 0 },
      timing: { totalElapsedMs: 1000, WAIT_TIME: 800, OWNER_WAIT_TIME: 0 },
    },
  };
}

test("PASS: within all ceilings, one paid call, zero relay", () => {
  const { readout } = assessBenchmark({ result: cycle(), cyclesRun: 1, sourceCommit: "abc123" });
  assert.equal(readout.pass, true);
  assert.equal(readout.ceilingsRespected, true);
  assert.equal(readout.goals.singlePaidCallNoCorrection, true);
  assert.equal(readout.goals.zeroOwnerRelay, true);
  assert.equal(readout.ceilings.openAiSpendUsd.within, true);
});

test("FAIL: OpenAI spend over the $0.10 ceiling", () => {
  const { readout } = assessBenchmark({ result: cycle({ cost: 0.25 }) });
  assert.equal(readout.ceilings.openAiSpendUsd.within, false);
  assert.equal(readout.ceilingsRespected, false);
  assert.equal(readout.pass, false);
});

test("FAIL: too many reciprocal cycles", () => {
  const { readout } = assessBenchmark({ result: cycle(), cyclesRun: 4 });
  assert.equal(readout.ceilings.reciprocalCycles.within, false);
  assert.equal(readout.pass, false);
});

test("FAIL: an Owner relay breaks the zero-relay goal", () => {
  const { readout } = assessBenchmark({ result: cycle({ relays: 1 }) });
  assert.equal(readout.goals.zeroOwnerRelay, false);
  assert.equal(readout.pass, false);
});

test("baseline delta compares this run to the preserved #319 numbers", () => {
  const { readout } = assessBenchmark({ result: cycle({ inTok: 3000, outTok: 300, cost: 0.02 }) });
  assert.equal(readout.baselineDelta.inputTokens.baseline, BENCHMARK_BASELINE.review319.gptInputTokens);
  assert.equal(readout.baselineDelta.inputTokens.thisRun, 3000);
  assert.equal(readout.baselineDelta.inputTokens.delta, 3000 - 7620);
  assert.equal(readout.goals.smallerThanBaselineInput, true);
  // cheaper than the two-call baseline
  assert.ok(readout.baselineDelta.totalCostUsd.delta < 0);
});

test("the durable artifact is content-addressed and self-verifying", () => {
  const { artifact } = assessBenchmark({ result: cycle(), sourceCommit: "abc123" });
  assert.equal(artifact.kind, "result");
  assert.match(artifact.artifactId, /^result:[0-9a-f]{64}$/);
  // recomputing the hash over the same content verifies
  const content = { benchmark: "taylor-one-trigger", readout: assessBenchmark({ result: cycle(), sourceCommit: "abc123" }).readout, evidence: cycle().evidence, transitions: cycle().transitions };
  assert.equal(verifyArtifact(artifact, content).ok, true);
});

test("ceiling + baseline constants are the Owner's stated values", () => {
  assert.equal(BENCHMARK_CEILING.maxGptPaidCalls, 3);
  assert.equal(BENCHMARK_CEILING.maxClaudeWakes, 3);
  assert.equal(BENCHMARK_CEILING.maxReciprocalCycles, 3);
  assert.equal(BENCHMARK_CEILING.maxOpenAiSpendUsd, 0.10);
  assert.equal(BENCHMARK_BASELINE.review319.gptCostUsd, 0.031452);
  assert.equal(BENCHMARK_BASELINE.pilot319.totalCostUsd, 0.058488);
});

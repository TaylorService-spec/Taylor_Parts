import { test } from "node:test";
import assert from "node:assert/strict";
import { runInstrumentedPilotCycle } from "./reciprocalPilotInstrumented.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "./reviewTrigger.mjs";
import { makeEfficiencyLedger } from "./reviewInstrumentation.mjs";

function review(id, over = {}) {
  return { ...buildReviewRequest({ requestId: id, subject: `review ${id}`, source: "CONTROL_PLANE_EVENT" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: "Orchestration", ...over };
}
const fakeGpt = (verdict = "CONCUR") => async (rv) => ({ ok: true, result: { exchangeId: `rev:${rv.requestId}`, requestId: rv.requestId, provider: "OPENAI", selectedModel: "gpt-5.6-terra", verdict, conclusion: "c", corrections: [], evidenceRefs: [], sourceFreshness: "CURRENT", routedBackTo: rv.routedBackTo }, usage: { actualCostUsd: 0.015, inputTokens: 4900, outputTokens: 420 } });
const mockClaudeRunner = (opts = {}) => { const calls = []; return { calls, run(a) { calls.push(a); return opts.run || { stdout: JSON.stringify({ result: "interpreted", total_cost_usd: 0.06, session_id: "s1" }), exitCode: 0, timedOut: false }; } }; };
const mockWakeLease = () => { let held = false; return { acquire: () => (!held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; };
const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "orch-operating-model", required: [{ id: "orch-operating-model", retrievalPath: "docs/orchestration/x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5 };
const base = () => ({ store: makeInMemoryReviewStore(), gptRunner: fakeGpt("CONCUR"), claudeProcessRunner: mockClaudeRunner(), wakeLease: mockWakeLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT, sourceFreshness: "CURRENT" });
// Monotonic fake clock: each read advances by 1ms.
const counterClock = () => { let n = 0; return () => n++; };

test("instrumented happy path: preserves core evidence AND adds timing + efficiency + recovery", async () => {
  const r = await runInstrumentedPilotCycle({ ...base(), reviews: [review("W1")], clock: counterClock() });
  // core cycle unchanged
  assert.equal(r.stopped, "ONE_CYCLE_COMPLETE");
  assert.equal(r.gptCalls, 1);
  assert.equal(r.claudeWakes, 1);
  assert.equal(r.evidence.gpt.actualCostUsd, 0.015);
  // timing: two WAIT phases (gpt + wake), total spans the cycle
  assert.equal(r.instrumentation.timing.WAIT_TIME > 0, true);
  assert.equal(r.instrumentation.timing.OWNER_WAIT_TIME, 0);
  assert.equal(r.instrumentation.timing.phases.map((p) => p.name).sort().join(","), "claude-wake,gpt-review");
  assert.ok(r.instrumentation.timing.totalElapsedMs >= r.instrumentation.timing.WAIT_TIME);
  // efficiency: one paid call recorded with the measured tokens
  const eff = r.instrumentation.efficiency;
  assert.equal(eff.providerCalls, 1);
  assert.equal(eff.measuredInputTokens, 4900);
  assert.equal(eff.measuredOutputTokens, 420);
  // recovery: none needed for a completed wake
  assert.equal(r.instrumentation.recovery.action, "NONE");
});

test("instrumented: records the fact-feed breakdown token account for the paid call", async () => {
  const feedBreakdown = { protocol: 3, question: 10, facts: 40, authority: 5, deterministicEvidence: 30, rawSource: 0, provenance: 4, totalEstimate: 92 };
  const r = await runInstrumentedPilotCycle({ ...base(), reviews: [review("W1")], clock: counterClock(), feedBreakdown });
  const eff = r.instrumentation.efficiency;
  assert.equal(eff.providerCalls, 1);
  assert.equal(eff.perCategoryTotals.facts, 40);
  assert.equal(eff.perCategoryTotals.deterministicEvidence, 30);
  assert.equal(eff.estimatedTotalTokens, 92);
});

test("instrumented: failed wake + persisted result → recovery plans WAKE-ONLY retry, no second call, counter folded", async () => {
  const r = await runInstrumentedPilotCycle({
    ...base(),
    claudeProcessRunner: mockClaudeRunner({ run: { exitCode: 2, stdout: "", stderr: "boom" } }),
    reviews: [review("W1")],
    clock: counterClock(),
    persistedResultRefOf: () => ({ artifactId: "result:r1", sha256: "r1" }),
  });
  assert.equal(r.claudeWakes, 0);
  assert.equal(r.wake.outcome, "SPAWNED_FAILED");
  assert.equal(r.instrumentation.recovery.action, "RETRY_WAKE_ONLY");
  assert.equal(r.instrumentation.recovery.providerCallCountDelta, 0);
  assert.equal(r.instrumentation.efficiency.wakeOnlyRecoveries, 1);
  // GPT still ran exactly once — recovery does NOT add a provider call
  assert.equal(r.instrumentation.efficiency.providerCalls, 1);
});

test("instrumented: a shared ledger accumulates across cycles", async () => {
  const ledger = makeEfficiencyLedger();
  await runInstrumentedPilotCycle({ ...base(), reviews: [review("W1")], clock: counterClock(), ledger });
  const r2 = await runInstrumentedPilotCycle({ ...base(), reviews: [review("W2")], clock: counterClock(), ledger });
  assert.equal(r2.instrumentation.efficiency.providerCalls, 2);
});

test("instrumented: no eligible review → no paid call recorded, no timing phases", async () => {
  const r = await runInstrumentedPilotCycle({ ...base(), reviews: [review("W1")], protectedOf: () => true, clock: counterClock() });
  assert.equal(r.stopped, "NO_ELIGIBLE_REVIEW");
  assert.equal(r.instrumentation.efficiency.providerCalls, 0);
  assert.equal(r.instrumentation.timing.phases.length, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { runReciprocalPilotCycle, PILOT_CEILING } from "./reciprocalPilotCycle.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "./reviewTrigger.mjs";

function review(id, over = {}) {
  return { ...buildReviewRequest({ requestId: id, subject: `review ${id}`, source: "CONTROL_PLANE_EVENT" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: "Orchestration", ...over };
}
const fakeGpt = (verdict = "CONCUR", extra = {}) => async (rv) => ({ ok: true, result: { exchangeId: `rev:${rv.requestId}`, requestId: rv.requestId, provider: "OPENAI", selectedModel: "gpt-5.6-terra", verdict, conclusion: "c", corrections: extra.corrections || [], evidenceRefs: [], sourceFreshness: "CURRENT", routedBackTo: rv.routedBackTo }, usage: { actualCostUsd: 0.015, inputTokens: 4900, outputTokens: 420 } });
// Mock Claude process runner in the executeWake shape: clean exit + JSON stdout with a `result`.
const mockClaudeRunner = (opts = {}) => { const calls = []; return { calls, run(a) { calls.push(a); if (opts.throwErr) throw new Error(opts.throwErr); return opts.run || { stdout: JSON.stringify({ result: "interpreted the review", total_cost_usd: 0.06, session_id: "s1" }), exitCode: 0, timedOut: false }; } }; };
const mockWakeLease = (acquired = true) => { let held = false; return { acquire: () => (acquired && !held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; };
const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "orch-operating-model", required: [{ id: "orch-operating-model", retrievalPath: "docs/orchestration/continuous-workstream-orchestrator.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5 };
const base = () => ({ store: makeInMemoryReviewStore(), gptRunner: fakeGpt("CONCUR"), claudeProcessRunner: mockClaudeRunner(), wakeLease: mockWakeLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT, sourceFreshness: "CURRENT" });

test("HAPPY PATH: eligible → GPT once → persist → consume → selector → Claude wake once → worker result → STOP", async () => {
  const persisted = []; const workerResults = [];
  const r = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], persistExchange: (e) => persisted.push(e), persistWorkerResult: (x) => workerResults.push(x) });
  assert.equal(r.stopped, "ONE_CYCLE_COMPLETE");
  assert.equal(r.gptCalls, 1);
  assert.equal(r.claudeWakes, 1);
  assert.equal(persisted.length, 1);                     // automatic aiExchange persistence
  assert.equal(workerResults.length, 1);                 // Claude worker result captured
  assert.equal(r.wake.outcome, "SPAWNED_COMPLETED");
  assert.deepEqual(r.transitions.filter((x) => /GPT_TRIGGERED|REVIEW_CONSUMED|CLAUDE_TRIGGERED|CLAUDE_COMPLETED|STOP/.test(x)), ["GPT_TRIGGERED", "REVIEW_CONSUMED", "CLAUDE_TRIGGERED", "CLAUDE_COMPLETED", "STOP"]);
  assert.equal(r.evidence.ownerManualActionCountAfterActivation, 0);
  assert.equal(r.evidence.duplicateCallCount, 0);
  assert.equal(r.evidence.gpt.actualCostUsd, 0.015);
  assert.equal(r.evidence.claude.cost, 0.06);
});

test("duplicate event / second invocation → cycle ceiling → NO second GPT or Claude", async () => {
  const cycleState = { cyclesRun: 0 };
  const first = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], cycleState });
  const second = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], cycleState });
  assert.equal(first.claudeWakes, 1);
  assert.equal(second.stopped, "CYCLE_CEILING");
  assert.equal(second.gptCalls, 0);
  assert.equal(second.claudeWakes, 0);
});

test("duplicate consumption / lease unavailable → no duplicate Claude wake", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], wakeLease: mockWakeLease(false) });
  assert.equal(r.gptCalls, 1);                           // GPT still ran
  assert.equal(r.claudeWakes, 0);                        // but wake refused (lease held)
  assert.equal(r.wake.outcome, "HELD");
});

test("NEEDS_OWNER → Owner surfaced, NO Claude wake", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), gptRunner: fakeGpt("NEEDS_OWNER"), reviews: [review("W1")] });
  assert.equal(r.stopped, "OWNER_GATE_NO_WAKE");
  assert.equal(r.claudeWakes, 0);
  assert.equal(r.ownerSurfaces.length, 1);
});

test("protected action → no provider call and no wake (excluded from eligibility)", async () => {
  const claude = mockClaudeRunner();
  const r = await runReciprocalPilotCycle({ ...base(), claudeProcessRunner: claude, reviews: [review("W1")], protectedOf: () => true });
  assert.equal(r.stopped, "NO_ELIGIBLE_REVIEW");
  assert.equal(r.gptCalls, 0);
  assert.equal(r.claudeWakes, 0);
  assert.equal(claude.calls.length, 0);
});

test("insufficient context → no GPT", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], sufficiencyOf: () => "EVIDENCE_REQUIRED" });
  assert.equal(r.gptCalls, 0);
  assert.equal(r.stopped, "NO_ELIGIBLE_REVIEW");
});

test("stale provenance → no GPT", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], freshnessOf: () => "BEHIND_REMOTE" });
  assert.equal(r.gptCalls, 0);
});

test("failed GPT → no Claude", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), gptRunner: async () => ({ ok: false, failureKind: "PROVIDER_FAILED" }), reviews: [review("W1")] });
  assert.equal(r.gptCalls, 1);
  assert.equal(r.claudeWakes, 0);
  assert.equal(r.stopped, "NO_WAKE");
});

test("failed consumption (malformed) → no Claude", async () => {
  const bad = async (rv) => ({ ok: true, result: { exchangeId: `rev:${rv.requestId}`, requestId: rv.requestId, verdict: "LGTM", sourceFreshness: "CURRENT" } });
  const r = await runReciprocalPilotCycle({ ...base(), gptRunner: bad, reviews: [review("W1")] });
  assert.equal(r.claudeWakes, 0);
});

test("budget exhausted → no GPT", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], budgetAvailable: false });
  assert.equal(r.stopped, "BUDGET_EXHAUSTED");
  assert.equal(r.gptCalls, 0);
});

test("cycle ceiling reached → no second cycle", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), reviews: [review("W1")], cycleState: { cyclesRun: 1 } });
  assert.equal(r.stopped, "CYCLE_CEILING");
  assert.equal(r.gptCalls, 0);
  assert.equal(r.claudeWakes, 0);
});

test("CONCUR_WITH_CORRECTION carries the correction into the woken Claude's return context", async () => {
  const r = await runReciprocalPilotCycle({ ...base(), gptRunner: fakeGpt("CONCUR_WITH_CORRECTION", { corrections: ["tighten X"] }), reviews: [review("W1")] });
  assert.equal(r.claudeWakes, 1);
  assert.deepEqual(r.loop.returnContext.corrections, ["tighten X"]);
});

test("ceiling constant is 1/1/1", () => {
  assert.deepEqual(PILOT_CEILING, { maxGptLiveCalls: 1, maxClaudeAutomaticWakes: 1, maxReciprocalCycles: 1 });
});

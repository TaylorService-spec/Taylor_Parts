import { test } from "node:test";
import assert from "node:assert/strict";
import { runReciprocalReviewCycle, selectEligibleReviews, reviewReturnContext, mapToWakeItem } from "./reciprocalReviewLoop.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "./reviewTrigger.mjs";

// A durable AI_REVIEW (buildReviewRequest + the loop's eligibility fields).
function review(id, over = {}) {
  return { ...buildReviewRequest({ requestId: id, subject: `review ${id}`, source: "CONTROL_PLANE_EVENT" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: "Orchestration", ...over };
}
// A fake provider runner: returns a structured envelope with the given verdict. NO live call.
function fakeProvider(verdict = "CONCUR", extra = {}) {
  return async (rv) => ({ ok: true, result: { exchangeId: `rev:${rv.requestId}`, requestId: rv.requestId, provider: "OPENAI", selectedModel: "gpt-5.6-terra", verdict, conclusion: "c", corrections: extra.corrections || [], evidenceRefs: extra.evidenceRefs || [], sourceFreshness: "CURRENT", routedBackTo: rv.routedBackTo, ...extra }, usage: { actualCostUsd: 0.01, inputTokens: 4900, outputTokens: 400 } });
}
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5 };
const leaseTracker = () => { const held = new Set(); return { acquire: (id) => (held.has(id) ? false : (held.add(id), true)), release: (id) => held.delete(id) }; };

test("eligible AI_REVIEW → provider invoked EXACTLY once → persisted → consumed → selector updated → Claude WOULD_TRIGGER", async () => {
  const store = makeInMemoryReviewStore();
  const persisted = [];
  const lease = leaseTracker();
  const r = await runReciprocalReviewCycle({
    reviews: [review("W1")], backlogItems: [], store, providerRunner: fakeProvider("CONCUR"),
    persistExchange: (e) => persisted.push(e), acquireLease: lease.acquire, releaseLease: lease.release, wakeCtx: FREE_SLOT,
  });
  assert.equal(r.providerInvocations, 1);
  assert.equal(persisted.length, 1);                         // automatic aiExchange persistence
  assert.equal(r.perReview[0].lifecycle, "CONSUMED");
  assert.equal(r.selection.decision, "RUN");
  assert.equal(r.wake.wouldTrigger, true);                   // responsible Claude would auto-trigger
  assert.equal(r.wake.triggerKind, "AUTOMATIC_TRIGGER");
  assert.equal(r.relayMetric.claudeToGptRelay, 0);
  assert.equal(r.relayMetric.gptToClaudeRelay, 0);
  assert.equal(r.relayMetric.ownerContinue, 0);
});

test("duplicate event → ONE provider invocation (store replay + lease guard)", async () => {
  const store = makeInMemoryReviewStore();
  const lease = leaseTracker();
  const args = { reviews: [review("W1")], store, providerRunner: fakeProvider("CONCUR"), acquireLease: lease.acquire, releaseLease: lease.release, wakeCtx: FREE_SLOT };
  const first = await runReciprocalReviewCycle(args);
  const second = await runReciprocalReviewCycle(args); // same review observed again
  assert.equal(first.providerInvocations, 1);
  assert.equal(second.providerInvocations, 0);        // replay → no second call
});

test("workflow retry (concurrent lease held) → no duplicate review", async () => {
  const store = makeInMemoryReviewStore();
  const held = new Set(["rev:W1"]);                    // a concurrent runner already holds the lease
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider(), acquireLease: (id) => !held.has(id), releaseLease: () => {}, wakeCtx: FREE_SLOT });
  assert.equal(r.providerInvocations, 0);
  assert.equal(r.perReview[0].skipped, true);
});

test("stale provenance → ZERO provider invocation", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider(), freshnessOf: () => "BEHIND_REMOTE", wakeCtx: FREE_SLOT });
  assert.equal(r.providerInvocations, 0);
  assert.equal(r.eligibleCount, 0);
  assert.ok(r.skipped.some((s) => /not CURRENT|RESULT_STALE/.test(JSON.stringify(s))));
});

test("insufficient context → ZERO provider invocation", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider(), sufficiencyOf: () => "EVIDENCE_REQUIRED", wakeCtx: FREE_SLOT });
  assert.equal(r.providerInvocations, 0);
  assert.equal(r.eligibleCount, 0);
});

test("CONCUR → responsible Claude re-eligible", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider("CONCUR"), wakeCtx: FREE_SLOT });
  assert.equal(r.wake.wouldTrigger, true);
});

test("CONCUR_WITH_CORRECTION → correction arrives in the Claude C-7 return context", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider("CONCUR_WITH_CORRECTION", { corrections: ["tighten lease release"] }), wakeCtx: FREE_SLOT });
  assert.equal(r.wake.wouldTrigger, true);
  assert.deepEqual(r.returnContext.corrections, ["tighten lease release"]);
  assert.equal(r.returnContext.verdict, "CONCUR_WITH_CORRECTION");
});

test("EVIDENCE_REQUIRED → evidence work routed, NOT a false completion", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider("EVIDENCE_REQUIRED", { evidenceRefs: ["need repro"] }), wakeCtx: FREE_SLOT });
  assert.equal(r.perReview[0].disposition, "CONSUMED");
  assert.equal(r.wake.wouldTrigger, true);                  // evidence work is actionable
  assert.equal(r.returnContext.evidenceRequired, true);
  assert.match(r.wake.item.id, /interpret:rev:W1/);
});

test("NEEDS_OWNER → Owner surfaced, Claude NOT improperly continued", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider("NEEDS_OWNER"), wakeCtx: FREE_SLOT });
  assert.equal(r.ownerSurfaces.length, 1);
  assert.equal(r.wake.wouldTrigger, false);                 // no auto-wake around an Owner gate
  assert.equal(r.relayMetric.genuineOwnerGates, 1);         // a governed gate, not relay friction
});

test("provider failure → fail closed (no wake, no false completion)", async () => {
  const store = makeInMemoryReviewStore();
  const runner = async () => ({ ok: false, failureKind: "PROVIDER_FAILED" });
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: runner, wakeCtx: FREE_SLOT });
  assert.equal(r.perReview[0].lifecycle, "FAILED");
  assert.equal(r.wake.wouldTrigger, false);
});

test("malformed result → fail closed", async () => {
  const store = makeInMemoryReviewStore();
  const runner = async (rv) => ({ ok: true, result: { exchangeId: `rev:${rv.requestId}`, requestId: rv.requestId, verdict: "LGTM", sourceFreshness: "CURRENT" } });
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: runner, wakeCtx: FREE_SLOT });
  assert.equal(r.perReview[0].consumable, false);
  assert.equal(r.wake.wouldTrigger, false);
});

test("protected action → GPT cannot authorize it (routes to Owner)", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider("CONCUR"), targetsProtectedActionOf: () => true, wakeCtx: FREE_SLOT });
  assert.equal(r.ownerSurfaces.length, 1);
  assert.equal(r.wake.wouldTrigger, false);                 // CONCUR on protected work never auto-continues
});

test("no free REMOTE_AI slot → consumed but wake HOLDs (respects the 2/1/1 governor)", async () => {
  const store = makeInMemoryReviewStore();
  const r = await runReciprocalReviewCycle({ reviews: [review("W1")], store, providerRunner: fakeProvider("CONCUR"), wakeCtx: { governor: { remoteAiUsed: 1, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5 } });
  assert.equal(r.perReview[0].lifecycle, "CONSUMED");       // review still consumed
  assert.equal(r.wake.wouldTrigger, false);                 // but no wake without a slot
  assert.match(r.wake.reason, /slot/);
});

test("selectEligibleReviews filters by OPEN + INDEPENDENT_AI + authorized", () => {
  const store = makeInMemoryReviewStore();
  const { eligible } = selectEligibleReviews([
    review("A"),
    review("B", { status: "RESOLVED" }),
    review("C", { reviewClass: "ROUTINE_AI" }),
    review("D", { authorizedForReview: false }),
  ], { store });
  assert.deepEqual(eligible.map((e) => e.requestId), ["A"]);
});

test("reviewReturnContext is compact — no transcript/model internals", () => {
  const c = reviewReturnContext({ exchangeId: "rev:X", verdict: "CONCUR", conclusion: "ok", corrections: [], evidenceRefs: [], rawModelResponse: "SHOULD NOT APPEAR", apiTranscript: "SECRET" });
  assert.ok(!("rawModelResponse" in c));
  assert.ok(!("apiTranscript" in c));
  assert.deepEqual(Object.keys(c).sort(), ["conclusion", "contextPackageRef", "corrections", "evidenceRefs", "evidenceRequired", "provenance", "reviewId", "verdict"].sort());
});

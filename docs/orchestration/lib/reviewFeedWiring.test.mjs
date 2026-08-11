// Wiring proof (FAKE provider only — no network, no key). Proves the LIVE provider path transmits the ONE
// canonical fact-based feed, that the legacy full-context payload is NOT silently appended for an ordinary
// bounded review, that instrumentation reconciles with the transmitted payload, that content-addressed
// artifacts participate, and that dedup + wake-only recovery + the expanded (high-risk) path are preserved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalReviewFeed, buildFactBasedInvocation, describeInvocation, reconcileTokens } from "./reviewFeedInvocation.mjs";
import { runOpenAIReview, buildReviewInvocation } from "./openaiReviewProvider.mjs";
import { makeEfficiencyLedger } from "./reviewInstrumentation.mjs";
import { makeReviewResultCache, planProviderCall, planWakeRecovery } from "./reviewRecovery.mjs";
import { makeArtifact, makeArtifactStore, artifactRef, verifyArtifact } from "./reviewArtifacts.mjs";
import { runInstrumentedPilotCycle } from "./reciprocalPilotInstrumented.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "./reviewTrigger.mjs";
import { SUBJECT_785_FEED } from "../benchmark/subject-785-feed.mjs";

const SCHEMA = { type: "json_schema", name: "eos_review_result", strict: true, schema: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: ["CONCUR"] } }, required: ["verdict"] } };
const feed785 = () => buildCanonicalReviewFeed({ ...SUBJECT_785_FEED, provenance: { sourceCommit: "abc123" }, artifactRefs: [{ artifactId: "request:x", sha256: "x1" }] });

function memFs() {
  const files = new Map();
  return { writeFileSync: (p, c) => files.set(p, c), readFileSync: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); }, mkdirSync: () => {}, _files: files };
}

test("live transport receives the EXACT canonical fact invocation — not a rebuilt full-context payload", async () => {
  const { invocation } = buildFactBasedInvocation({ feed: feed785(), model: "gpt-5.6-terra", schema: SCHEMA });
  let received = null;
  const transport = async (inv) => { received = inv; return { ok: true, review: { verdict: "CONCUR", conclusion: "ok", corrections: [], evidenceRefs: [], ownerDecisionRequired: false }, usage: { inputTokens: 1100, outputTokens: 300 } }; };
  const r = await runOpenAIReview({ request: { requestId: "TAYLOR-BENCH-785", reviewClass: "INDEPENDENT_AI", selectedModel: "gpt-5.6-terra", routedBackTo: "Orchestration" }, invocation, transport });
  assert.equal(r.ok, true);
  // The transport got the SAME object the builder produced (dry/live parity).
  assert.equal(received, invocation);
  assert.deepEqual(received.messages, invocation.messages);
  // It is the fact payload, and it does NOT contain the full governing-authority dump the legacy path inlines.
  const userText = received.messages[1].content;
  assert.match(userText, /QUESTION \(one independent decision\)/);
  assert.doesNotMatch(userText, /Governing authority content \(inlined minimum context\)/);
});

test("ordinary bounded fact request is materially smaller than the #319 baseline (7,620 in)", () => {
  const { breakdown } = buildFactBasedInvocation({ feed: feed785(), model: "m", schema: SCHEMA });
  assert.ok(breakdown.totalEstimate > 0);
  assert.ok(breakdown.totalEstimate < 2000, `fact feed ${breakdown.totalEstimate} should be << 7620`);
  assert.ok(breakdown.totalEstimate < 0.4 * 7620, "at least ~60% smaller than baseline");
});

test("instrumentation reconciles: the recorded breakdown estimate ≈ measured input tokens", () => {
  const { breakdown } = buildFactBasedInvocation({ feed: feed785(), model: "m", schema: SCHEMA });
  const ledger = makeEfficiencyLedger();
  ledger.recordCall({ breakdown, inputTokens: 1150, outputTokens: 300 });
  const snap = ledger.snapshot();
  assert.ok(snap.estimatedTotalTokens > 0, "never the old zero");
  assert.ok(snap.perCategoryTotals.facts > 0 && snap.perCategoryTotals.structuredOutputSchema > 0);
  const rec = reconcileTokens({ estimatedTotal: snap.estimatedTotalTokens, measuredInputTokens: snap.measuredInputTokens });
  assert.equal(rec.withinTolerance, true);
});

test("content-addressed artifacts participate: request + facts stored + verified, count is truthful", () => {
  const reqA = makeArtifact({ kind: "request", content: { reviewId: "R", q: "?" }, sourceCommit: "abc" });
  const factsA = makeArtifact({ kind: "facts", content: { facts: ["a", "b"] }, sourceCommit: "abc" });
  const store = makeArtifactStore({ dir: "art", fs: memFs(), join: (a, b) => `${a}/${b}` });
  let created = 0;
  if (store.put(reqA, { reviewId: "R", q: "?" }).ok) created += 1;
  if (store.put(factsA, { facts: ["a", "b"] }).ok) created += 1;
  assert.equal(created, 2);
  // stored substance verifies against the ref; a ref rides identity-only
  assert.equal(store.get(reqA).ok, true);
  assert.equal(artifactRef(factsA).artifactId, factsA.artifactId);
  assert.ok(!("content" in artifactRef(factsA)));
  const ledger = makeEfficiencyLedger();
  ledger.bump("artifactsCreated", created);
  assert.equal(ledger.snapshot().artifactsCreated, 2);
});

test("the legacy EXPANDED path is preserved for review classes that need full context", () => {
  // High-risk / expanded review still builds the inlined-context invocation — not removed by this fix.
  const built = buildReviewInvocation({ request: { requestId: "HR-1", reviewClass: "INDEPENDENT_AI", subject: "high risk" }, contextPackage: { sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [] }, diff: "big diff", model: "gpt-5.6-terra", contextText: "FULL GOVERNING AUTHORITY TEXT ..." });
  assert.equal(built.ok, true);
  assert.match(built.invocation.messages[1].content, /Governing authority content \(inlined minimum context\)/);
});

test("dedup preserved: same request hash avoids a second paid call", () => {
  const cache = makeReviewResultCache();
  const req = { artifactId: "request:h1", sha256: "h1" };
  const counters = {};
  assert.equal(planProviderCall({ requestArtifact: req, cache, counters }).action, "CALL_PROVIDER");
  cache.record(req, { artifactId: "result:r1", sha256: "r1" });
  assert.equal(planProviderCall({ requestArtifact: req, cache, counters }).action, "REUSE_EXISTING");
  assert.equal(counters.duplicateProviderCallsAvoided, 1);
});

test("wake-only recovery preserved: failed wake + persisted result → no repurchase", () => {
  const plan = planWakeRecovery({ wakeOutcome: "SPAWNED_FAILED", persistedResultRef: { artifactId: "result:r1", sha256: "r1" } });
  assert.equal(plan.action, "RETRY_WAKE_ONLY");
  assert.equal(plan.providerCallCountDelta, 0);
});

test("end-to-end (fake fact runner): cycle records the real breakdown + artifacts; categories nonzero", async () => {
  const { invocation, breakdown } = buildFactBasedInvocation({ feed: feed785(), model: "gpt-5.6-terra", schema: SCHEMA });
  const review = { ...buildReviewRequest({ requestId: "TAYLOR-BENCH-785", subject: "s", source: "CONTROL_PLANE_EVENT" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: "Orchestration" };
  // Fake fact runner: transmits the prebuilt invocation to a fake transport; returns usage.
  const gptRunner = async (rv) => runOpenAIReview({ request: rv, invocation, transport: async () => ({ ok: true, review: { verdict: "CONCUR", conclusion: "ok", corrections: [], evidenceRefs: [], ownerDecisionRequired: false }, usage: { inputTokens: 1120, outputTokens: 300 } }) });
  const claude = { calls: [], run(a) { this.calls.push(a); return { stdout: JSON.stringify({ result: "interpreted", total_cost_usd: 0, session_id: "s" }), exitCode: 0, timedOut: false }; } };
  const lease = (() => { let held = false; return { acquire: () => (!held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; })();
  const ledger = makeEfficiencyLedger();
  ledger.bump("artifactsCreated", 2);
  const r = await runInstrumentedPilotCycle({
    clock: (() => { let n = 0; return () => n++; })(),
    ledger, feedBreakdown: breakdown,
    store: makeInMemoryReviewStore(), reviews: [review], gptRunner, claudeProcessRunner: claude, wakeLease: lease,
    contextPackageFn: () => ({ sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [{ id: "auth", retrievalPath: "x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } }),
    wakeCtx: { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: 5 }, sourceFreshness: "CURRENT",
  });
  assert.equal(r.gptCalls, 1);
  const eff = r.instrumentation.efficiency;
  assert.ok(eff.estimatedTotalTokens > 0, "breakdown recorded, not zero");
  assert.ok(eff.perCategoryTotals.facts > 0 && eff.perCategoryTotals.structuredOutputSchema > 0);
  assert.equal(eff.artifactsCreated, 2);
  assert.equal(eff.measuredInputTokens, 1120);
  assert.equal(reconcileTokens({ estimatedTotal: eff.estimatedTotalTokens, measuredInputTokens: eff.measuredInputTokens }).withinTolerance, true);
});

test("no credentials or message content ever enter the safe diagnostic", () => {
  const { invocation } = buildFactBasedInvocation({ feed: feed785(), model: "m", schema: SCHEMA });
  const blob = JSON.stringify(describeInvocation(invocation));
  assert.doesNotMatch(blob, /Authorization|Bearer|sk-|OPENAI_API_KEY|onSnapshot/);
});

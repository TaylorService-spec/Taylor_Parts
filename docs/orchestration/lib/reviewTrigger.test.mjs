import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_TRIGGER_SOURCES, REVIEW_PROVIDERS, REVIEW_FAILURE_KINDS, triggerKindForSource,
  makeInMemoryReviewStore, buildReviewRequest, assessTriggerEligibility, triggerReview,
  structureReviewResult, consumeReviewResult, reviewResultToWorkItem, selectNextWorkWithReviews,
  promoteToDurable, projectReviewTriggerBoard,
} from "./reviewTrigger.mjs";

// A well-formed CURRENT result for `subject` with the given verdict.
function goodResult({ verdict = "CONCUR", corrections = [], routedBackTo = "Orchestration", freshness = "CURRENT" } = {}) {
  const raw = { exchangeId: "rev:R1", requestId: "R1", reviewerRole: "architecture-review", provider: "OPENAI", verdict, corrections, sourceFreshness: freshness, routedBackTo, conclusion: "ok" };
  const s = structureReviewResult(raw);
  assert.equal(s.ok, true);
  return s.result;
}

// ── Trigger: same contract across sources; exactly-once; dedupe ──────────────

test("event → eligible review → invocation exactly once (and marks handled)", () => {
  const store = makeInMemoryReviewStore();
  const req = buildReviewRequest({ requestId: "R1", subject: "review PR #900", source: "GITHUB_EVENT" });
  const t = triggerReview({ request: req, store, contextSufficiency: "SUFFICIENT", sourceFreshness: "CURRENT" });
  assert.equal(t.triggered, true);
  assert.equal(t.record.wakeState, "TRIGGERED");
  assert.equal(t.record.triggerKind, "AUTOMATIC_TRIGGER");
  assert.equal(store.all().length, 1);
});

test("scheduled trigger and manual trigger use the SAME contract (different mechanism only)", () => {
  for (const [source, kind] of [["SCHEDULED", "AUTOMATIC_TRIGGER"], ["MANUAL", "MANUAL_RUNTIME_TRIGGER"]]) {
    const store = makeInMemoryReviewStore();
    const req = buildReviewRequest({ requestId: "R1", subject: "same subject", source });
    const t = triggerReview({ request: req, store, contextSufficiency: "SUFFICIENT", sourceFreshness: "CURRENT" });
    assert.equal(t.triggered, true);
    assert.equal(t.record.triggerKind, kind);
    assert.equal(triggerKindForSource(source), kind);
  }
});

test("duplicate event → no duplicate review (idempotency dedupe)", () => {
  const store = makeInMemoryReviewStore();
  const req = buildReviewRequest({ requestId: "R1", subject: "review PR #900", source: "GITHUB_EVENT" });
  const first = triggerReview({ request: req, store, sourceFreshness: "CURRENT" });
  const dup = buildReviewRequest({ requestId: "R1b", subject: "review PR #900", source: "GITHUB_EVENT" }); // same subject → same key
  const second = triggerReview({ request: dup, store, sourceFreshness: "CURRENT" });
  assert.equal(first.triggered, true);
  assert.equal(second.triggered, false);
  assert.equal(second.failureKind, "DUPLICATE_RESULT");
  assert.equal(store.all().length, 1); // still one exchange
});

test("stale context → hold / fail closed (never trigger a stale review)", () => {
  const store = makeInMemoryReviewStore();
  const req = buildReviewRequest({ requestId: "R1", subject: "s", source: "GITHUB_EVENT" });
  const staleSource = triggerReview({ request: req, store, contextSufficiency: "SUFFICIENT", sourceFreshness: "BEHIND_REMOTE" });
  assert.equal(staleSource.triggered, false);
  assert.equal(staleSource.failureKind, "RESULT_STALE");
  const insufficient = assessTriggerEligibility({ request: req, store, contextSufficiency: "EVIDENCE_REQUIRED", sourceFreshness: "CURRENT" });
  assert.equal(insufficient.eligible, false);
  assert.equal(insufficient.failureKind, "CONTEXT_INSUFFICIENT");
});

// ── Result fail-closed: none is approval ─────────────────────────────────────

test("missing result → no continuation", () => {
  const c = consumeReviewResult({ result: null });
  assert.equal(c.consumable, false);
  assert.equal(c.failureKind, "RESULT_MISSING");
});

test("malformed result → no continuation", () => {
  const bad = structureReviewResult({ exchangeId: "x", requestId: "R", reviewerRole: "r", provider: "OPENAI", verdict: "BOGUS" });
  assert.equal(bad.ok, false);
  assert.equal(bad.failureKind, "MALFORMED_RESULT");
  const c = consumeReviewResult({ result: { verdict: "BOGUS", sourceFreshness: "CURRENT" } });
  assert.equal(c.consumable, false);
  assert.equal(c.failureKind, "MALFORMED_RESULT");
});

test("stale result → not consumable, suggests a stale disposition", () => {
  const c = consumeReviewResult({ result: goodResult({ freshness: "DIVERGED" }) });
  assert.equal(c.consumable, false);
  assert.equal(c.failureKind, "RESULT_STALE");
  assert.ok(c.suggestedDisposition);
});

test("provider/trigger failure → not consumable, never approval", () => {
  for (const kind of ["PROVIDER_FAILED", "TRIGGER_FAILED", "RESULT_UNVERIFIABLE"]) {
    const c = consumeReviewResult({ failureKind: kind });
    assert.equal(c.consumable, false);
    assert.equal(c.failureKind, kind);
  }
  assert.ok(REVIEW_FAILURE_KINDS.includes("DUPLICATE_RESULT"));
});

// ── Verdict handling through consumption ─────────────────────────────────────

test("CONCUR → consumable result that makes the responsible worker eligible", () => {
  const c = consumeReviewResult({ result: goodResult({ verdict: "CONCUR" }), consumedAt: 1 });
  assert.equal(c.consumable, true);
  assert.equal(c.disposition, "CONSUMED");
  assert.equal(c.workItem.state, "READY");
  assert.equal(c.workItem.workstream, "Orchestration");
  // fed to the SAME selector, it becomes the actionable pick (RUN), not a false CHECKPOINT
  const decision = selectNextWorkWithReviews([], [c.workItem]);
  assert.equal(decision.decision, "RUN");
  assert.equal(decision.item.id, c.workItem.id);
});

test("CONCUR_WITH_CORRECTION → correction survives consumption", () => {
  const c = consumeReviewResult({ result: goodResult({ verdict: "CONCUR_WITH_CORRECTION", corrections: ["tighten the lease release path"] }) });
  assert.equal(c.consumable, true);
  assert.deepEqual(c.workItem.corrections, ["tighten the lease release path"]);
});

test("EVIDENCE_REQUIRED → an evidence work item / gate (retrieve-don't-guess)", () => {
  const c = consumeReviewResult({ result: goodResult({ verdict: "EVIDENCE_REQUIRED" }) });
  assert.equal(c.consumable, true);
  assert.match(c.workItem.label, /Gather evidence/);
});

test("NEEDS_OWNER → Owner surface, not autonomous continuation", () => {
  const c = consumeReviewResult({ result: goodResult({ verdict: "NEEDS_OWNER" }) });
  assert.equal(c.disposition, "NEEDS_OWNER");
  assert.ok(c.ownerSurface);
  assert.equal(c.workItem, undefined);
});

test("protected action cannot be authorized by a reviewer (verdict ≠ authorization)", () => {
  const c = consumeReviewResult({ result: goodResult({ verdict: "CONCUR" }), targetsProtectedAction: true });
  assert.equal(c.consumable, false);
  assert.equal(c.disposition, "NEEDS_OWNER");
  assert.match(c.blockedReason, /protected action/);
});

// ── Repository-vs-runtime authority boundary ─────────────────────────────────

test("promoteToDurable: only ACCEPTED + CURRENT + CONSUMED promotes; stale/unaccepted never do", () => {
  const consumed = { ...goodResult({ verdict: "CONCUR_WITH_CORRECTION", corrections: ["c1"] }), disposition: "CONSUMED" };
  const p = promoteToDurable(consumed);
  assert.equal(p.promotable, true);
  assert.equal(p.durableCandidate.kind, "decision"); // has corrections → decision, else finding
  assert.equal(promoteToDurable({ ...consumed, sourceFreshness: "BEHIND_REMOTE" }).promotable, false);
  assert.equal(promoteToDurable({ ...goodResult({ verdict: "NEEDS_OWNER" }), disposition: "CONSUMED" }).promotable, false);
  assert.equal(promoteToDurable({ ...goodResult(), disposition: "OPEN" }).promotable, false); // not consumed
});

// ── Owner relay count + projection ───────────────────────────────────────────

test("full event→consume path keeps Owner relay count at 0 (no manual relay required)", () => {
  const store = makeInMemoryReviewStore();
  let ownerRelays = 0;
  const req = buildReviewRequest({ requestId: "R1", subject: "review PR #900", source: "GITHUB_EVENT" });
  const t = triggerReview({ request: req, store, contextSufficiency: "SUFFICIENT", sourceFreshness: "CURRENT" });
  assert.equal(t.triggered, true);
  const result = goodResult({ verdict: "CONCUR" });
  const c = consumeReviewResult({ result, consumedAt: 2 });
  if (c.ownerSurface) ownerRelays++; // CONCUR non-protected → no owner surface
  assert.equal(ownerRelays, 0);
  assert.equal(c.consumable, true);
});

test("projectReviewTriggerBoard: counts sources/verdicts/failures for the Control Center", () => {
  const board = projectReviewTriggerBoard([
    { triggerSource: "GITHUB_EVENT", verdict: "CONCUR", disposition: "CONSUMED" },
    { triggerSource: "MANUAL", disposition: "HELD", failureKind: "RESULT_STALE" },
    { triggerSource: "GITHUB_EVENT", verdict: "NEEDS_OWNER", disposition: "NEEDS_OWNER" },
  ]);
  assert.equal(board.total, 3);
  assert.equal(board.bySource.GITHUB_EVENT, 2);
  assert.equal(board.byFailure.RESULT_STALE, 1);
  assert.equal(board.consumed, 1);
  assert.equal(board.held, 1);
  assert.equal(board.ownerSurfaced, 1);
});

test("taxonomies are the reused/expected sets", () => {
  assert.deepEqual(REVIEW_TRIGGER_SOURCES, ["GITHUB_EVENT", "CONTROL_PLANE_EVENT", "TASK_TRIGGER", "SCHEDULED", "MANUAL"]);
  assert.deepEqual(REVIEW_PROVIDERS, ["OPENAI", "ANTHROPIC", "MANUAL_RELAY"]);
});

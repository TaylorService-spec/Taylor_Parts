import test from "node:test";
import assert from "node:assert/strict";
import {
  checkReviewPayload, assertReviewPayload, estimateTokens, shouldReview,
  checkProviderCapacity, payloadCostRecord,
  PAYLOAD_MODE, DEFAULT_CEILING_TOKENS, FACT_FEED_CEILING_TOKENS,
} from "./reviewPayloadGuard.mjs";

const big = (tokens) => "x".repeat(Math.ceil(tokens * 3.5) + 10);

test("token estimate rounds UP — a guard that under-estimates lets the expensive case through", () => {
  assert.ok(estimateTokens("abcd") >= 1);
  assert.ok(estimateTokens(big(1000)) >= 1000);
});

test("a normal fact-feed payload is allowed", () => {
  const r = checkReviewPayload({ payload: big(5000), mode: PAYLOAD_MODE.FACT_FEED });
  assert.equal(r.allowed, true);
  assert.equal(r.ceilingTokens, FACT_FEED_CEILING_TOKENS);
});

test("DEFECT GUARD: FULL_CONTEXT on a metered path is refused outright", () => {
  // The #788 defect. Not a degraded fallback -- reaching here means the wrong path was chosen.
  const r = checkReviewPayload({ payload: "small", mode: PAYLOAD_MODE.FULL_CONTEXT });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /#788 defect/);
});

test("DEFECT GUARD: an oversized payload is REFUSED, never truncated", () => {
  const r = checkReviewPayload({ payload: big(500_000), mode: PAYLOAD_MODE.FACT_FEED });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /refusing rather than truncating/);
  // A truncated review looks valid and is not -- the failure mode this project keeps hitting.
});

test("a fact-feed payload over the tighter fact-feed ceiling is refused", () => {
  const r = checkReviewPayload({ payload: big(FACT_FEED_CEILING_TOKENS + 500), mode: PAYLOAD_MODE.FACT_FEED });
  assert.equal(r.allowed, false);
});

test("unknown mode falls back to the wider default ceiling", () => {
  const r = checkReviewPayload({ payload: big(DEFAULT_CEILING_TOKENS - 500), mode: PAYLOAD_MODE.UNKNOWN });
  assert.equal(r.allowed, true);
  assert.equal(r.ceilingTokens, DEFAULT_CEILING_TOKENS);
});

test("no API key refuses BEFORE invocation — misconfiguration never becomes a paid call", () => {
  const r = checkReviewPayload({ payload: "x", mode: PAYLOAD_MODE.FACT_FEED, hasApiKey: false });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /before provider invocation/);
});

test("empty payload is refused", () => {
  assert.equal(checkReviewPayload({ payload: "   ", mode: PAYLOAD_MODE.FACT_FEED }).allowed, false);
});

test("assertReviewPayload throws on refusal and returns on pass", () => {
  assert.throws(() => assertReviewPayload({ payload: big(999_999), mode: PAYLOAD_MODE.FACT_FEED }), /REVIEW_PAYLOAD_REFUSED/);
  assert.equal(assertReviewPayload({ payload: "ok", mode: PAYLOAD_MODE.FACT_FEED }).allowed, true);
});

test("AVAILABILITY: capacity reserve keeps the reviewer usable rather than spending to zero", () => {
  // $10 cap, 25% reserved => $7.50 spendable.
  assert.equal(checkProviderCapacity({ capUsd: 10, spentUsd: 5 }).allowed, true);
  const atFloor = checkProviderCapacity({ capUsd: 10, spentUsd: 7.5 });
  assert.equal(atFloor.allowed, false);
  assert.match(atFloor.reason, /stays available/);
});

test("a call that would breach the reserve is refused even below the floor", () => {
  const r = checkProviderCapacity({ capUsd: 10, spentUsd: 7.0, estimatedCostUsd: 2.0 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /would breach the reserve/);
});

test("unknown spend is treated as fully consumed — fails toward availability", () => {
  assert.equal(checkProviderCapacity({ capUsd: 10, spentUsd: undefined }).allowed, false);
});

test("unknown cap refuses rather than risking the reviewer", () => {
  assert.equal(checkProviderCapacity({ capUsd: 0, spentUsd: 0 }).allowed, false);
  assert.equal(checkProviderCapacity({}).allowed, false);
});

test("one review per head SHA — a re-push that changes nothing must not re-review", () => {
  const prior = [{ headSha: "abc123" }];
  assert.equal(shouldReview("abc123", prior).review, false);
  assert.equal(shouldReview("def456", prior).review, true);
});

test("no head SHA refuses — cannot dedupe, so cannot bound the spend", () => {
  assert.equal(shouldReview("", []).review, false);
});

test("every invocation produces a cost record, including refusals", () => {
  const refused = checkReviewPayload({ payload: big(999_999), mode: PAYLOAD_MODE.FACT_FEED });
  const rec = payloadCostRecord({ headSha: "abc", mode: PAYLOAD_MODE.FACT_FEED, estimatedTokens: refused.estimatedTokens, allowed: refused.allowed, reason: refused.reason });
  assert.equal(rec.outcome, "REFUSED");
  assert.equal(rec.invoked, false);
  // An unmeasured cost cannot be tuned -- a refusal is worth recording too.
  assert.ok(rec.estimatedTokens > 0);
});

test("guard never throws on malformed input", () => {
  assert.doesNotThrow(() => checkReviewPayload());
  assert.doesNotThrow(() => checkProviderCapacity());
  assert.doesNotThrow(() => shouldReview());
});

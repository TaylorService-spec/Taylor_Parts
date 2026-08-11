import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalReviewFeed,
  buildFactBasedInvocation,
  describeInvocation,
  reconcileTokens,
  REVIEW_SYSTEM_TEXT,
} from "./reviewFeedInvocation.mjs";
import { FEED_CATEGORIES } from "./reviewFacts.mjs";

const SCHEMA = { type: "json_schema", name: "eos_review_result", strict: true, schema: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: ["CONCUR", "NONCONCUR_ESCALATE"] }, conclusion: { type: "string" } }, required: ["verdict", "conclusion"] } };

function sampleFeed(over = {}) {
  return buildCanonicalReviewFeed({
    reviewId: "R1",
    question: "Is the change correct and appropriately scoped? One verdict.",
    requirement: "Show 'unavailable' on a failed read; 'unknown' only when confirmed absent.",
    implementationFacts: ["hook returns {error,retry}", "cell renders inline error + Retry"],
    sourceFacts: ["precedent: a failed read must be distinguishable from absent"],
    deterministicEvidence: ["7/7 unit tests pass", "CI green"],
    rawEvidence: ["const unsub = onSnapshot(ref, ok, (err)=>apply(failure(err)));"],
    provenance: { sourceCommit: "abc123" },
    artifactRefs: [{ artifactId: "request:h", sha256: "hhhhhhhhhhhh" }],
    ...over,
  });
}

test("buildCanonicalReviewFeed requires reviewId + a narrow question", () => {
  assert.throws(() => buildCanonicalReviewFeed({ question: "q" }), /reviewId/);
  assert.throws(() => buildCanonicalReviewFeed({ reviewId: "R1" }), /question/);
});

test("fact-based invocation: system + user messages, FACT_BASED, judges only from provided material", () => {
  const { ok, invocation } = buildFactBasedInvocation({ feed: sampleFeed(), model: "gpt-5.6-terra", schema: SCHEMA });
  assert.equal(ok, true);
  assert.equal(invocation.model, "gpt-5.6-terra");
  assert.equal(invocation.feedMode, "FACT_BASED");
  assert.equal(invocation.messages[0].role, "system");
  assert.equal(invocation.messages[0].content, REVIEW_SYSTEM_TEXT);
  assert.equal(invocation.messages[1].role, "user");
  const user = invocation.messages[1].content;
  // The narrow sections are present; there is NO whole-file / operating-model dump.
  assert.match(user, /QUESTION \(one independent decision\)/);
  assert.match(user, /IMPLEMENTATION FACTS/);
  assert.match(user, /DETERMINISTIC EVIDENCE/);
  assert.match(user, /RAW EVIDENCE \(minimal excerpts only\)/);
});

test("breakdown accounts every category over the transmitted strings; schema is separate; total reconciles", () => {
  const { invocation, breakdown } = buildFactBasedInvocation({ feed: sampleFeed(), model: "m", schema: SCHEMA });
  for (const c of FEED_CATEGORIES) assert.ok(c in breakdown, `has ${c}`);
  assert.ok(breakdown.question > 0 && breakdown.facts > 0 && breakdown.authority > 0);
  assert.ok(breakdown.deterministicEvidence > 0 && breakdown.rawSource > 0 && breakdown.provenance > 0);
  assert.ok(breakdown.structuredOutputSchema > 0, "schema token contribution is visible");
  // total = sum of the seven categories + schema, by construction — never zero when content exists.
  const sum = FEED_CATEGORIES.reduce((n, c) => n + breakdown[c], 0) + breakdown.structuredOutputSchema;
  assert.equal(breakdown.totalEstimate, sum);
  assert.ok(breakdown.totalEstimate > 0);
  assert.equal(invocation.schemaTokens, breakdown.structuredOutputSchema);
});

test("schema is OPTIONAL and its contribution is zero when absent", () => {
  const { invocation, breakdown } = buildFactBasedInvocation({ feed: sampleFeed(), model: "m" });
  assert.equal(invocation.schemaTokens, 0);
  assert.equal(breakdown.structuredOutputSchema, 0);
});

test("an empty section contributes an honest zero, not a hidden cost", () => {
  const feed = sampleFeed({ deterministicEvidence: [], rawEvidence: [] });
  const { breakdown } = buildFactBasedInvocation({ feed, model: "m", schema: SCHEMA });
  assert.equal(breakdown.deterministicEvidence, 0);
  assert.equal(breakdown.rawSource, 0);
  assert.ok(breakdown.question > 0);
});

test("dry/live parity: the builder is deterministic — identical inputs yield an identical invocation", () => {
  const a = buildFactBasedInvocation({ feed: sampleFeed(), model: "m", schema: SCHEMA });
  const b = buildFactBasedInvocation({ feed: sampleFeed(), model: "m", schema: SCHEMA });
  assert.deepEqual(a.invocation.messages, b.invocation.messages);
  assert.equal(a.breakdown.totalEstimate, b.breakdown.totalEstimate);
});

test("describeInvocation is a SAFE diagnostic — sizes + refs, never content/key/headers", () => {
  const { invocation } = buildFactBasedInvocation({ feed: sampleFeed(), model: "m", schema: SCHEMA });
  const d = describeInvocation(invocation);
  assert.equal(d.ok, true);
  assert.equal(d.feedMode, "FACT_BASED");
  assert.ok(Array.isArray(d.sections) && d.sections.length > 0);
  assert.ok(d.schemaTokens > 0);
  assert.deepEqual(d.artifactRefs, [{ artifactId: "request:h", sha256: "hhhhhhhhhhhh" }]);
  const blob = JSON.stringify(d);
  // no message content, no auth material
  assert.doesNotMatch(blob, /onSnapshot|Authorization|Bearer|sk-|QUESTION \(one independent/);
});

test("reconcileTokens: within tolerance vs measured; null when not yet invoked", () => {
  assert.equal(reconcileTokens({ estimatedTotal: 1000, measuredInputTokens: 1050 }).withinTolerance, true);
  assert.equal(reconcileTokens({ estimatedTotal: 1000, measuredInputTokens: 7498 }).withinTolerance, false);
  assert.equal(reconcileTokens({ estimatedTotal: 1000, measuredInputTokens: 0 }).withinTolerance, null);
  const r = reconcileTokens({ estimatedTotal: 1053, measuredInputTokens: 1100 });
  assert.ok(r.ratio > 0 && r.tolerance > 0);
});

test("artifactRefs ride as identity only — no substance is inlined", () => {
  const feed = sampleFeed({ artifactRefs: [{ artifactId: "facts:x", sha256: "x", location: "reviews/facts/x.json", secretPayload: "should-not-appear" }] });
  const { invocation } = buildFactBasedInvocation({ feed, model: "m" });
  assert.deepEqual(invocation.artifactRefs, [{ artifactId: "facts:x", sha256: "x" }]);
  assert.doesNotMatch(JSON.stringify(invocation), /secretPayload|should-not-appear/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFact, minimizeFacts, buildFactFeed, FACT_KINDS, FEED_CATEGORIES } from "./reviewFacts.mjs";
import { makeNarrowQuestion, structureCompactResult, verdictDisposition, REVIEW_QUESTION_VERDICTS } from "./reviewQuestion.mjs";

test("minimizeFacts drops non-material facts and flags analysis-only material decisions", () => {
  const facts = [
    makeFact({ kind: "DETERMINISTIC_FACT", statement: "npm test exit 0", materialDecision: "tests-pass" }),
    makeFact({ kind: "SOURCE_FACT", statement: "Rules require name<=200", materialDecision: "name-parity" }),
    makeFact({ kind: "CLAUDE_ANALYSIS", statement: "I think it's fine", materialDecision: null }),        // dropped
    makeFact({ kind: "CLAUDE_ANALYSIS", statement: "risk is low", materialDecision: "risk-assessment" }),  // unanchored
  ];
  const { kept, excluded, unanchoredAnalysis } = minimizeFacts(facts);
  assert.equal(kept.length, 3);
  assert.equal(excluded.length, 1);
  assert.equal(unanchoredAnalysis.length, 1, "analysis with no deterministic/source anchor is flagged");
  assert.equal(unanchoredAnalysis[0].materialDecision, "risk-assessment");
});

test("buildFactFeed produces a compact reference-carrying feed + per-category token breakdown", () => {
  const ref = { artifactId: "evidence:abc", kind: "evidence", sha256: "abc", location: "reviews/evidence/abc.json" };
  const { feed, breakdown, excludedCount } = buildFactFeed({
    questionId: "Q1", ask: "Is the change safe to merge?",
    facts: [
      makeFact({ kind: "DETERMINISTIC_FACT", statement: "full suite green", materialDecision: "safety" }),
      makeFact({ kind: "SOURCE_FACT", statement: "the diff", materialDecision: "safety", ref }),   // rides as a reference
      makeFact({ kind: "CLAUDE_ANALYSIS", statement: "irrelevant note", materialDecision: null }), // excluded
    ],
    authorityRefs: [{ artifactId: "auth:xyz", sha256: "xyz" }],
    provenance: { sourceCommit: "deadbeef" },
  });
  assert.equal(feed.question.ask, "Is the change safe to merge?");
  assert.equal(feed.facts.length, 2, "only material facts");
  assert.ok(feed.facts.some((f) => f.ref && f.ref.artifactId === "evidence:abc"), "a fact with an artifact rides as a reference");
  assert.equal(excludedCount, 1);
  for (const c of FEED_CATEGORIES) assert.ok(c in breakdown, `breakdown has ${c}`);
  assert.ok(breakdown.totalEstimate > 0);
  // the feed does NOT carry the operating model / transcripts / whole files
  assert.ok(!JSON.stringify(feed).includes("transcript"));
});

test("narrow question requires a single-decision ask; verdict vocab is the four", () => {
  const q = makeNarrowQuestion({ questionId: "Q1", ask: "Is finding F-01 resolved?" });
  assert.deepEqual(q.verdictVocab, [...REVIEW_QUESTION_VERDICTS]);
  assert.throws(() => makeNarrowQuestion({ questionId: "Q1" }), /ask/);
  assert.deepEqual([...REVIEW_QUESTION_VERDICTS], ["YES", "NO", "EVIDENCE_REQUIRED", "OWNER_REQUIRED"]);
});

test("structureCompactResult: compact {verdict, findingRefs}; unknown verdict fails closed", () => {
  const ok = structureCompactResult({ verdict: "YES", findingRefs: [], extra: "dropped" });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.result).sort(), ["findingRefs", "verdict"]);
  assert.equal(structureCompactResult({ verdict: "LGTM" }).ok, false);
  assert.equal(structureCompactResult({}).failureKind, "MALFORMED_RESULT");
  // findingRefs keeps only well-formed artifact refs
  const withFinding = structureCompactResult({ verdict: "NO", findingRefs: [{ artifactId: "finding:1", sha256: "1" }, { bogus: true }] });
  assert.equal(withFinding.result.findingRefs.length, 1);
});

test("verdictDisposition maps the four verdicts", () => {
  assert.equal(verdictDisposition("YES").pass, true);
  assert.equal(verdictDisposition("NO").needsWork, true);
  assert.equal(verdictDisposition("EVIDENCE_REQUIRED").disposition, "EVIDENCE_REQUIRED");
  assert.equal(verdictDisposition("OWNER_REQUIRED").ownerGate, true);
});

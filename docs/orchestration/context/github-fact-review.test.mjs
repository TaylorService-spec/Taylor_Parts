import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSecurityFeed, executeReview, parseReviewInputs, resolveExactSubject } from "./github-fact-review.mjs";
import { buildReviewInvocation } from "../lib/openaiReviewProvider.mjs";

const SHA = "a".repeat(40), BASE = "b".repeat(40);
const inputs = { reviewId: "REVIEW-790", repo: "TaylorService-spec/Taylor_Parts", prNumber: 790, expectedHeadSha: SHA, question: "Is this credential boundary secure?", profile: "security-credential-boundary", maxSpendUsd: 0.25, model: "gpt-5.6-terra" };
const fetchJson = async () => ({ number: 790, head: { sha: SHA }, base: { sha: BASE } });
const gitExec = (args) => args[0] === "rev-parse" ? SHA : args.includes("--name-only") ? "docs/orchestration/lib/secretProvider.mjs" : "diff --git a/secretProvider.mjs b/secretProvider.mjs\n+withCredential scans callback results";
const review = { verdict: "CONCUR", conclusion: "bounded boundary is sound", corrections: [], evidenceRefs: ["secretProvider.mjs"], ownerDecisionRequired: false };

test("arbitrary exact PR/head builds one FACT_BASED invocation with honest tokens and no Claude dependency", async () => {
  let invocation; const outputDir = mkdtempSync(join(tmpdir(), "fact-review-"));
  const out = await executeReview({ inputs, live: true, fetchJson, gitExec, outputDir, transport: async (i) => { invocation = i; return { ok: true, review, usage: { inputTokens: 900, outputTokens: 80 } }; } });
  assert.equal(out.providerCalls, 1); assert.equal(out.feedMode, "FACT_BASED"); assert.equal(invocation.feedMode, "FACT_BASED");
  assert.ok(invocation.inputTokensEstimate > 0); assert.doesNotMatch(JSON.stringify(invocation), /AI_ENGINEERING_OPERATING_MODEL|Claude CLI/);
  assert.equal(JSON.parse(readFileSync(join(outputDir, out.artifact.location), "utf8")).verdict, "CONCUR");
});

test("head mismatch refuses before provider", async () => {
  let calls = 0;
  await assert.rejects(() => executeReview({ inputs, live: true, fetchJson: async () => ({ number: 790, head: { sha: "c".repeat(40) }, base: { sha: BASE } }), gitExec, transport: async () => { calls++; } }), /HEAD_MISMATCH/);
  assert.equal(calls, 0);
});

test("dry/live use the same canonical payload", async () => {
  const dry = await executeReview({ inputs, fetchJson, gitExec }); let liveInvocation;
  await executeReview({ inputs, live: true, fetchJson, gitExec, outputDir: mkdtempSync(join(tmpdir(), "fact-review-")), transport: async (i) => { liveInvocation = i; return { ok: true, review, usage: { inputTokens: 1, outputTokens: 1 } }; } });
  assert.deepEqual(dry.diagnostic.sections, liveInvocation.sectionBreakdown); assert.equal(dry.diagnostic.totalRequestTokenEstimate, dry.tokenBreakdown.totalEstimate);
});

test("input validation binds arbitrary repo/PR/head and the per-call ceiling", () => {
  assert.equal(parseReviewInputs({ REVIEW_ID: "R", REVIEW_REPO: "o/r", REVIEW_PR_NUMBER: "44", REVIEW_EXPECTED_HEAD_SHA: SHA, REVIEW_QUESTION: "q", REVIEW_PROFILE: "security-credential-boundary", REVIEW_MAX_SPEND_USD: "0.25", OPENAI_REVIEW_MODEL: "m" }).prNumber, 44);
  assert.throws(() => parseReviewInputs({ REVIEW_ID: "R", REVIEW_REPO: "o/r", REVIEW_PR_NUMBER: "44", REVIEW_EXPECTED_HEAD_SHA: SHA, REVIEW_QUESTION: "q", REVIEW_PROFILE: "security-credential-boundary", REVIEW_MAX_SPEND_USD: "0.26", OPENAI_REVIEW_MODEL: "m" }), /max_spend/);
});

test("security fixture is materially smaller than legacy full-context payload", async () => {
  const dry = await executeReview({ inputs, fetchJson, gitExec });
  const legacy = buildReviewInvocation({ request: { reviewClass: "INDEPENDENT_AI", subject: "legacy", selectedModel: inputs.model }, contextPackage: { sufficiency: "SUFFICIENT", governingAuthority: "model", required: [] }, contextText: "governance ".repeat(5000), diff: "full diff ".repeat(3000), model: inputs.model });
  assert.equal(legacy.ok, true); assert.ok(dry.tokenBreakdown.totalEstimate < legacy.invocation.inputTokensEstimate * 0.5);
});

test("delta profile sends only the compact resolution artifact and enforces the one question", async () => {
  const deltaInputs = { ...inputs, profile: "security-credential-boundary-delta", question: "Are findings F1–F4 resolved sufficiently to approve PR #790's credential security boundary?" };
  const deltaGit = (args) => args[0] === "rev-parse" ? SHA : args.includes("--name-only") ? "docs/orchestration/reviews/resolutions/PR-790-F1-F4.resolution.json" : args[0] === "show" ? '{"findings":["F1","F2","F3","F4"],"tests":"pass","priorResultSha256":"7f73"}' : "";
  const dry = await executeReview({ inputs: deltaInputs, fetchJson, gitExec: deltaGit });
  assert.equal(dry.feedMode, "FACT_BASED"); assert.ok(dry.tokenBreakdown.rawSource > 0); assert.ok(dry.tokenBreakdown.totalEstimate < 1500);
  await assert.rejects(() => executeReview({ inputs: { ...deltaInputs, question: "broader question" }, fetchJson, gitExec: deltaGit }), /DELTA_QUESTION_MISMATCH/);
});

test("final profile binds the committed exact-head evidence and sends no implementation source", async () => {
  const head = "8a71f7cd3006fc149c7a80c52967a1643935ac7d";
  const finalInputs = {
    ...inputs,
    expectedHeadSha: head,
    question: `Are the remaining evidence gaps now satisfied for findings F1-F4 on PR #790 exact head ${head}?`,
    profile: "security-credential-boundary-final",
  };
  const finalFetch = async () => ({ number: 790, head: { sha: head }, base: { sha: BASE } });
  const subject = await resolveExactSubject(finalInputs, { fetchJson: finalFetch, gitExec: () => head });
  const feed = buildSecurityFeed(finalInputs, subject).feed;
  const dry = await executeReview({ inputs: finalInputs, fetchJson: finalFetch, gitExec: () => head });
  assert.equal(dry.feedMode, "FACT_BASED");
  assert.ok(dry.tokenBreakdown.totalEstimate > 0);
  assert.deepEqual(subject.material, ["docs/orchestration/reviews/evidence/pr-790/PR-790-FINAL-EVIDENCE.json"]);
  assert.doesNotMatch(JSON.stringify(feed), /diff --git|secretProvider\.mjs b\//);
});

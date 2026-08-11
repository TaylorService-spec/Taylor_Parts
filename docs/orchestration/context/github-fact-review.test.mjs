import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeReview, parseReviewInputs } from "./github-fact-review.mjs";
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

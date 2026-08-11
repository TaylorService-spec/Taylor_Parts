import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const yaml = readFileSync(join(here, "..", "..", "..", ".github", "workflows", "reciprocal-gpt-review.yml"), "utf8").replace(/\r/g, "");
const runner = readFileSync(join(here, "..", "context", "github-fact-review.mjs"), "utf8");
const steps = yaml.split(/^\s*- name:/m);
const dry = steps.find((s) => /^\s*DRY fact review/.test(s));
const live = steps.find((s) => /^\s*LIVE fact review/.test(s));

test("workflow accepts the exact arbitrary-subject contract", () => {
  for (const input of ["review_id", "repo", "pr_number", "expected_head_sha", "review_question", "review_profile", "max_spend_usd"]) assert.match(yaml, new RegExp(`^\\s{6}${input}:`, "m"));
  assert.match(yaml, /ref:\s*\$\{\{ inputs\.expected_head_sha \}\}/);
  assert.match(yaml, /path:\s*review-subject/);
});

test("GitHub secret/model wiring is live-only for the key", () => {
  assert.ok(dry && live); assert.match(dry, /OPENAI_REVIEW_MODEL:\s*\$\{\{ vars\.OPENAI_REVIEW_MODEL \}\}/);
  assert.doesNotMatch(dry, /secrets\.OPENAI_API_KEY/); assert.match(live, /OPENAI_API_KEY:\s*\$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(live, /--live/); assert.match(live, /refusing before provider invocation/);
});

test("dry/live input wiring is identical and shell does not interpolate subject inputs", () => {
  for (const key of ["REVIEW_ID", "REVIEW_REPO", "REVIEW_PR_NUMBER", "REVIEW_EXPECTED_HEAD_SHA", "REVIEW_QUESTION", "REVIEW_PROFILE", "REVIEW_MAX_SPEND_USD", "REVIEW_SUBJECT_ROOT"]) assert.ok(dry.includes(key) && live.includes(key));
  for (const block of [dry, live]) assert.doesNotMatch(block.slice(block.indexOf("run:")), /\$\{\{\s*inputs\./);
});

test("entry is FACT_BASED only and has no legacy or Claude dependency", () => {
  assert.match(runner, /buildCanonicalReviewFeed/); assert.match(runner, /buildFactBasedInvocation/);
  assert.doesNotMatch(runner, /buildReviewInvocation|coldStart|claude/i); assert.match(runner, /FEED_MODE_NOT_FACT_BASED/);
  assert.doesNotMatch(yaml, /claude|openai-review\.mjs/);
});

test("workflow remains manual-only and persists artifact plus PR pointer", () => {
  assert.match(yaml, /workflow_dispatch:/); assert.doesNotMatch(yaml, /^\s*(push|pull_request|schedule|repository_dispatch):/m);
  assert.match(yaml, /actions\/upload-artifact@v4/); assert.match(yaml, /gh pr comment/);
});

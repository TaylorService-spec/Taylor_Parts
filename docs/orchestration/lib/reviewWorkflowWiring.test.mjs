import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Guards the reciprocal-gpt-review workflow wiring so the post-#768 regression cannot recur:
//   dry-run must receive OPENAI_REVIEW_MODEL (so it reflects the real model) but NEVER the API key,
//   and live must receive BOTH. Text-scoped by step (no YAML dependency).

const here = dirname(fileURLToPath(import.meta.url));
const WF = join(here, "..", "..", "..", ".github", "workflows", "reciprocal-gpt-review.yml");
const yaml = readFileSync(WF, "utf8");

// Split into per-step blocks on the "- name:" boundary, then find the dry-run and live steps by the
// step name at the START of the block (anchored, so the header comment that mentions "DRY-RUN" and the
// key doesn't get mistaken for a step). CRLF-safe.
const steps = yaml.split(/^\s*- name:/m).map((s) => s.replace(/\r/g, ""));
const dryRun = steps.find((s) => /^\s*Dry-run \(no provider/.test(s));
const live = steps.find((s) => /^\s*Live review \(/.test(s));

test("workflow has a dry-run step and a live step", () => {
  assert.ok(dryRun, "dry-run step present");
  assert.ok(live, "live step present");
});

test("DRY-RUN receives OPENAI_REVIEW_MODEL (the #768 wiring fix) but NEVER the API key", () => {
  assert.match(dryRun, /OPENAI_REVIEW_MODEL:\s*\$\{\{\s*vars\.OPENAI_REVIEW_MODEL\s*\}\}/, "dry-run must inject the model variable");
  // The safety property is that the key is not INJECTED (an explanatory comment naming it is fine).
  assert.ok(!/secrets\.OPENAI_API_KEY/.test(dryRun), "dry-run must NOT inject the API key secret");
  assert.ok(!/OPENAI_API_KEY:\s*\$\{\{/.test(dryRun), "dry-run must NOT bind OPENAI_API_KEY as env");
  assert.ok(!/--live/.test(dryRun), "dry-run must not pass --live");
});

test("LIVE receives BOTH the model variable and the API key secret", () => {
  assert.match(live, /OPENAI_REVIEW_MODEL:\s*\$\{\{\s*vars\.OPENAI_REVIEW_MODEL\s*\}\}/, "live must inject the model variable");
  assert.match(live, /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/, "live must inject the key secret");
  assert.match(live, /--live/, "live step runs with --live");
  assert.match(live, /refusing live call/i, "live step refuses when the secret is absent");
});

test("no auto-on-code or clock triggers; only manual dispatch + the inert repository_dispatch event path", () => {
  assert.match(yaml, /workflow_dispatch:/, "operator dispatch present");
  assert.match(yaml, /repository_dispatch:/, "event path present");
  assert.match(yaml, /types:\s*\[eos-ai-review-eligible\]/, "scoped event type");
  // A GPT call must never fire on every push/PR/commit or on a clock.
  assert.ok(!/^\s*push:/m.test(yaml), "no push trigger");
  assert.ok(!/^\s*pull_request:/m.test(yaml), "no pull_request trigger");
  assert.ok(!/^\s*schedule:/m.test(yaml), "no schedule/cron trigger");
});

// ── Input-injection hardening: inputs flow via env, NEVER interpolated into shell ────────────────

test("neither step interpolates workflow inputs into the shell command (no ${{ inputs.* }} in run:)", () => {
  // Extract the run: body of each step and assert it contains no `${{ inputs.` interpolation.
  for (const [label, block] of [["dry-run", dryRun], ["live", live]]) {
    const runIdx = block.indexOf("run:");
    assert.ok(runIdx !== -1, `${label} has a run:`);
    const runBody = block.slice(runIdx);
    assert.ok(!/\$\{\{\s*inputs\./.test(runBody), `${label} run: must not interpolate workflow inputs into shell`);
    assert.ok(!/format\(/.test(runBody), `${label} run: must not build shell fragments via format()`);
  }
});

test("both steps pass request_id and diff_path through ENV (read by Node, not shell)", () => {
  for (const block of [dryRun, live]) {
    assert.match(block, /REVIEW_REQUEST_ID:\s*\$\{\{\s*inputs\.request_id\s*\}\}/);
    assert.match(block, /REVIEW_DIFF_PATH:\s*\$\{\{\s*inputs\.diff_path\s*\}\}/);
  }
});

test("dry-run and live input wiring is IDENTICAL except the key (live) and --live", () => {
  // Same env inputs on both.
  for (const v of ["OPENAI_REVIEW_MODEL", "REVIEW_REQUEST_ID", "REVIEW_DIFF_PATH"]) {
    assert.ok(dryRun.includes(v) && live.includes(v), `${v} present in both`);
  }
  // Differences: key only in live, --live only in live.
  assert.ok(!/secrets\.OPENAI_API_KEY/.test(dryRun) && /secrets\.OPENAI_API_KEY/.test(live), "key only in live");
  assert.ok(!/--live/.test(dryRun) && /--live/.test(live), "--live only in live");
});

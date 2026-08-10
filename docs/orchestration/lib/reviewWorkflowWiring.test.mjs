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

test("the workflow is manual-dispatch only (never auto-triggered on push/PR)", () => {
  assert.match(yaml, /on:\s*\n\s*workflow_dispatch:/, "must be workflow_dispatch only");
  assert.ok(!/^\s*push:/m.test(yaml) && !/^\s*pull_request:/m.test(yaml), "no push/pull_request triggers");
});

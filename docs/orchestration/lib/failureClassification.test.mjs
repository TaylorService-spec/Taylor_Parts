import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, shouldAttemptRetry, explainFailure, FAILURE_CLASS } from "./failureClassification.mjs";
import { retryDecision } from "./autonomyPolicy.mjs";

// The verbatim failure that was retried five times on 2026-08-13.
const WORKFLOWS_REJECTION =
  " ! [remote rejected] HEAD -> main (refusing to allow a GitHub App to create or update workflow " +
  "`.github/workflows/orchestration-agent-manager-tests.yml` without `workflows` permission)\n" +
  "error: failed to push some refs to 'https://github.com/TaylorService-spec/Taylor_Parts'";

test("DEFECT GUARD: the workflows-permission rejection is NOT retryable", () => {
  // This exact text was retried 5x, wasted minutes, and buried the root cause for three days.
  const c = classifyFailure(WORKFLOWS_REJECTION);
  assert.equal(c.failureClass, FAILURE_CLASS.PROHIBITED_WORKFLOW_WRITE);
  assert.equal(c.retryable, false);
});

test("DEFECT GUARD: it fails ONCE — not five times", () => {
  const r = shouldAttemptRetry(WORKFLOWS_REJECTION, { attempt: 0, maxAttempts: 5 });
  assert.equal(r.retry, false);
  assert.equal(r.decision, "FAIL_FAST");
  assert.equal(r.attempts, 1, "one attempt, then surface the real cause");
});

test("ordering matters: the workflows rejection must not classify as a retryable push race", () => {
  // It contains "failed to push", which a naive matcher would treat as a race.
  assert.notEqual(classifyFailure(WORKFLOWS_REJECTION).failureClass, FAILURE_CLASS.PUSH_RACE);
});

test("a genuine non-fast-forward IS retryable — re-syncing is the actual remedy", () => {
  const c = classifyFailure("! [rejected] main -> main (non-fast-forward)\nhint: fetch first");
  assert.equal(c.failureClass, FAILURE_CLASS.PUSH_RACE);
  assert.equal(c.retryable, true);
});

test("permission denials are non-retryable across their many spellings", () => {
  for (const t of [
    "bash: permission denied",
    "TOOL_PERMISSION_BLOCKED",
    "Error: EACCES: permission denied, open '/etc/x'",
    "HTTP 403 Forbidden",
    "Permission for this action was denied by the Claude Code auto mode classifier",
  ]) {
    const c = classifyFailure(t);
    assert.equal(c.retryable, false, `expected non-retryable: ${t}`);
  }
});

test("missing credentials are non-retryable — a retry cannot create a secret", () => {
  for (const t of [
    "OPENAI_API_KEY secret not set; refusing before provider invocation.",
    "[FAIL] CREDENTIAL_ACCESS_FAILED personaId=admin type=FILE_NOT_FOUND",
  ]) {
    assert.equal(classifyFailure(t).retryable, false);
  }
  assert.equal(classifyFailure("no API key present").failureClass, FAILURE_CLASS.UNAVAILABLE_CREDENTIAL);
});

test("deterministic program errors are non-retryable", () => {
  const c = classifyFailure("Error: Cannot find module '/home/x/scripts/_sandboxDeployGuard.mjs'\nMODULE_NOT_FOUND");
  assert.equal(c.failureClass, FAILURE_CLASS.INVALID_COMMAND);
  assert.equal(c.retryable, false);
});

test("schema/intake rejections are non-retryable until the input changes", () => {
  const c = classifyFailure("Error: issue intake rejected: issue body requires a non-empty ## Scope section");
  assert.equal(c.failureClass, FAILURE_CLASS.INVALID_SCHEMA);
  assert.equal(c.retryable, false);
});

test("a failing test with unchanged code is non-retryable", () => {
  assert.equal(classifyFailure("not ok 3 - guards the boundary").retryable, false);
  assert.equal(classifyFailure("# fail 2").retryable, false);
});

test("protected-branch controls are non-retryable", () => {
  assert.equal(classifyFailure("remote: error: GH006: Protected branch update failed").retryable, false);
});

test("transient network and provider failures ARE retryable", () => {
  for (const t of ["ECONNRESET", "socket hang up", "ETIMEDOUT", "429 Too Many Requests", "503 Service Unavailable"]) {
    assert.equal(classifyFailure(t).retryable, true, `expected retryable: ${t}`);
  }
});

test("contention is retryable — the holder eventually releases", () => {
  assert.equal(classifyFailure("Error: listen EADDRINUSE: address already in use :::8080").retryable, true);
  assert.equal(classifyFailure("fatal: Unable to create '.git/index.lock': File exists").retryable, true);
});

test("DEFECT GUARD: an unrecognised failure defaults to NON-retryable", () => {
  // Asymmetric on purpose. Wrongly not retrying costs one surfaced blocker; wrongly retrying
  // burns capacity and buries the cause -- the harm actually observed.
  const c = classifyFailure("something nobody has ever seen before happened");
  assert.equal(c.failureClass, FAILURE_CLASS.UNKNOWN);
  assert.equal(c.retryable, false);
  assert.match(c.reason, /buries the cause/);
});

test("an empty or missing failure refuses to retry blind", () => {
  assert.equal(classifyFailure("").retryable, false);
  assert.equal(classifyFailure(undefined).retryable, false);
  assert.equal(classifyFailure({}).retryable, false);
});

test("accepts an Error object and an object with stderr", () => {
  assert.equal(classifyFailure(new Error("ECONNRESET")).retryable, true);
  assert.equal(classifyFailure({ stderr: WORKFLOWS_REJECTION }).retryable, false);
  assert.equal(classifyFailure({ code: "EACCES" }).retryable, false);
});

test("a retryable failure still gives up once attempts are exhausted", () => {
  assert.equal(shouldAttemptRetry("ECONNRESET", { attempt: 0, maxAttempts: 3 }).retry, true);
  const done = shouldAttemptRetry("ECONNRESET", { attempt: 2, maxAttempts: 3 });
  assert.equal(done.retry, false);
  assert.equal(done.decision, "GIVE_UP");
});

test("explainFailure produces a legible operator line", () => {
  const line = explainFailure(WORKFLOWS_REJECTION);
  assert.match(line, /PROHIBITED_WORKFLOW_WRITE/);
  assert.match(line, /NOT retryable/);
});

test("classification never throws on malformed input", () => {
  for (const bad of [null, 0, [], { message: null }]) {
    assert.doesNotThrow(() => classifyFailure(bad));
    assert.doesNotThrow(() => shouldAttemptRetry(bad));
  }
});

// --- integration: the classifier must actually gate retryDecision, not merely exist ---

test("INTEGRATION: retryDecision FAILS FAST on the workflows rejection", () => {
  // Before this wiring, retryDecision saw only attempt count and would have returned RETRY
  // five times against a denial that could never succeed.
  const d = retryDecision({ attempt: 0, networkState: "NORMAL", failure: WORKFLOWS_REJECTION });
  assert.equal(d.decision, "FAIL_FAST");
  assert.equal(d.reason, FAILURE_CLASS.PROHIBITED_WORKFLOW_WRITE);
  assert.equal(d.backoffSeconds, null, "no backoff — there is nothing to wait for");
});

test("INTEGRATION: a transient failure still retries with backoff", () => {
  const d = retryDecision({ attempt: 0, networkState: "NORMAL", failure: "ECONNRESET" });
  assert.equal(d.decision, "RETRY");
  assert.ok(d.backoffSeconds > 0);
});

test("INTEGRATION: omitting `failure` preserves the original behaviour exactly", () => {
  // Backwards compatibility -- existing callers that pass no failure are unaffected.
  const d = retryDecision({ attempt: 0, networkState: "NORMAL" });
  assert.equal(d.decision, "RETRY");
});

test("INTEGRATION: network state still wins for an otherwise-retryable failure", () => {
  const d = retryDecision({ attempt: 0, networkState: "NETWORK_UNAVAILABLE", failure: "ECONNRESET" });
  assert.equal(d.decision, "HOLD");
});

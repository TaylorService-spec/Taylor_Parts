import test from "node:test";
import assert from "node:assert/strict";
import {
  assessStagnation, stagnationAction, isProgress, classifyStagnation,
  DEFAULT_STAGNATION_POLICY, PROGRESS, NON_PROGRESS,
} from "./progressDetection.mjs";

const T0 = 1_700_000_000_000;
const min = (n) => T0 + n * 60_000;
const ev = (kind, atMin, extra = {}) => ({ kind, at: min(atMin), ...extra });

test("a busy run with no progress signals IS stagnant", () => {
  // The exact failure mode: searching, re-reading, polling -- looks productive, moves nothing.
  const events = [
    ev("SEARCH", 0, { fingerprint: "grep:dispatch" }),
    ev("FILE_REREAD", 5, { fingerprint: "read:App.jsx" }),
    ev("LOG_POLL", 10, { fingerprint: "poll:ci" }),
    ev("SEARCH", 15, { fingerprint: "grep:dispatch2" }),
    ev("CONCLUSION_RESTATED", 20, { fingerprint: "restate" }),
    ev("LOG_POLL", 25, { fingerprint: "poll:ci2" }),
  ];
  const a = assessStagnation({ events, now: min(25), repoStateHash: "x", lastRepoStateHash: "x" });
  assert.equal(a.stagnant, true);
  assert.ok(a.reasons.some((r) => /no progress signal/.test(r)));
});

test("a commit resets the clock — genuine progress is not stagnation", () => {
  const events = [
    ev("SEARCH", 0, { fingerprint: "a" }),
    ev("FILE_REREAD", 2, { fingerprint: "b" }),
    ev("SEARCH", 4, { fingerprint: "c" }),
    ev("CODE_CHANGED", 6),
    ev("COMMIT_CREATED", 8),
    ev("SEARCH", 10, { fingerprint: "d" }),
  ];
  const a = assessStagnation({ events, now: min(12) });
  assert.equal(a.stagnant, false);
  assert.ok(a.minutesSinceProgress < DEFAULT_STAGNATION_POLICY.minutesWithoutProgress);
});

test("DEFECT GUARD: a repeated identical failure is conclusive on its own", () => {
  // The same thing failing the same way cannot become progress by being tried again.
  const events = [
    ev("FAILURE", 1, { fingerprint: "PERMISSION_DENIED:push" }),
    ev("FAILURE", 2, { fingerprint: "PERMISSION_DENIED:push" }),
    ev("FAILURE", 3, { fingerprint: "PERMISSION_DENIED:push" }),
    ev("SEARCH", 4, { fingerprint: "x" }),
    ev("SEARCH", 5, { fingerprint: "y" }),
  ];
  const a = assessStagnation({ events, now: min(5) });
  assert.equal(a.stagnant, true, "one strong signal is enough when it is a repeated failure");
  assert.equal(a.classification.cause, "REPEATED_IDENTICAL_FAILURE");
});

test("looping on the same action is detected", () => {
  const events = Array.from({ length: 6 }, (_, i) => ev("TOOL_CALL", i, { fingerprint: "same-call" }));
  const a = assessStagnation({ events, now: min(6) });
  assert.ok(a.reasons.some((r) => /same action repeated/.test(r)));
});

test("§5.2: ONE weak signal alone is not stagnation — a combination is required", () => {
  // Repo unchanged, but progress happened recently. Not enough to stop a run.
  const events = [
    ev("SEARCH", 0, { fingerprint: "a" }),
    ev("SEARCH", 1, { fingerprint: "b" }),
    ev("COMMIT_CREATED", 2),
    ev("SEARCH", 3, { fingerprint: "c" }),
    ev("SEARCH", 4, { fingerprint: "d" }),
  ];
  const a = assessStagnation({ events, now: min(5), repoStateHash: "same", lastRepoStateHash: "same" });
  assert.equal(a.signals, 1);
  assert.equal(a.stagnant, false);
});

test("DEFECT GUARD: too few observations is never judged as stagnation", () => {
  // A long single operation -- a test run, a large read -- legitimately produces few events.
  const events = [ev("SEARCH", 0, { fingerprint: "a" }), ev("SEARCH", 40, { fingerprint: "b" })];
  const a = assessStagnation({ events, now: min(45) });
  assert.equal(a.stagnant, false);
  assert.match(a.detail, /insufficient observations/);
});

test("BLOCKER_IDENTIFIED only counts as progress WITH new evidence", () => {
  assert.equal(isProgress({ kind: "BLOCKER_IDENTIFIED", newEvidence: true }), true);
  assert.equal(isProgress({ kind: "BLOCKER_IDENTIFIED" }), false, "re-announcing a known blocker is not progress");
});

test("non-progress activity is never counted as progress", () => {
  for (const k of NON_PROGRESS) assert.equal(isProgress({ kind: k }), false, k);
  for (const k of PROGRESS) {
    if (k === "BLOCKER_IDENTIFIED") continue;
    assert.equal(isProgress({ kind: k }), true, k);
  }
});

test("unchanged repo AND verification state together are enough", () => {
  const events = Array.from({ length: 6 }, (_, i) => ev("TOOL_CALL", i, { fingerprint: `call-${i}` }));
  const a = assessStagnation({
    events, now: min(6),
    repoStateHash: "r", lastRepoStateHash: "r",
    verificationStateHash: "v", lastVerificationStateHash: "v",
  });
  assert.equal(a.stagnant, true);
  assert.equal(a.signals, 2);
});

test("stagnationAction stops the SEGMENT and checkpoints — never fails the mission", () => {
  const events = [
    ev("FAILURE", 1, { fingerprint: "same" }),
    ev("FAILURE", 2, { fingerprint: "same" }),
    ev("FAILURE", 3, { fingerprint: "same" }),
    ev("SEARCH", 4, { fingerprint: "x" }),
    ev("SEARCH", 5, { fingerprint: "y" }),
  ];
  const act = stagnationAction(assessStagnation({ events, now: min(5) }));
  assert.equal(act.action, "STOP_SEGMENT");
  assert.deepEqual(act.steps, ["STOP_AGENT", "CHECKPOINT", "CLASSIFY", "DECIDE_STRATEGY"]);
  assert.equal(act.resume, "ONLY_IF_STRATEGY_CHANGES");
});

test("a healthy run returns CONTINUE", () => {
  const events = [
    ev("SEARCH", 0, { fingerprint: "a" }), ev("CODE_CHANGED", 1), ev("COMMIT_CREATED", 2),
    ev("PR_CREATED", 3), ev("CHILD_COMPLETED", 4),
  ];
  assert.equal(stagnationAction(assessStagnation({ events, now: min(5) })).action, "CONTINUE");
});

test("BUSY_BUT_INERT does not recommend resuming", () => {
  const c = classifyStagnation({ repoUnchanged: true, minutesSinceProgress: 40 });
  assert.equal(c.cause, "BUSY_BUT_INERT");
  assert.equal(c.canRetryWithDifferentStrategy, false);
});

test("never throws on malformed input", () => {
  assert.doesNotThrow(() => assessStagnation());
  assert.doesNotThrow(() => assessStagnation({ events: [null, undefined], now: 0 }));
  assert.doesNotThrow(() => stagnationAction());
  assert.doesNotThrow(() => stagnationAction(null));
});

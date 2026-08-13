import { test } from "node:test";
import assert from "node:assert/strict";
import { landItemArtifacts, landAllArtifacts, artifactPathsFor } from "./intake-landing.mjs";

// A scriptable git double: records every invocation, and returns a queued outcome per git subcommand so a test
// can simulate push rejections / cherry-pick races. Default outcome is success (code 0).
function gitDouble(script = {}) {
  const calls = [];
  const queues = {};
  for (const [k, v] of Object.entries(script)) queues[k] = [...v];
  const runGit = (args) => {
    calls.push(args);
    const key = `${args[0]}${args[0] === "diff" ? " --cached" : ""}`;
    const q = queues[key];
    const outcome = q && q.length ? q.shift() : { code: 0, stdout: args[0] === "rev-parse" ? "deadbeefcafe\n" : "" };
    return { code: outcome.code ?? 0, stdout: outcome.stdout ?? (args[0] === "rev-parse" ? "deadbeefcafe\n" : ""), stderr: "" };
  };
  runGit.calls = calls;
  return runGit;
}
const cmds = (runGit) => runGit.calls.map((a) => a.join(" "));

test("stages ONLY this requestId's work-intake paths — a PATCH item's code can never leak", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] }); // changes staged
  landItemArtifacts({ requestId: "EOS-ISSUE-852-C01", runGit });
  const addCall = runGit.calls.find((a) => a[0] === "add");
  assert.deepEqual(addCall, ["add", "--", ...artifactPathsFor("EOS-ISSUE-852-C01")]);
  // the ONLY paths mentioned anywhere are this item's work-intake paths — never functions/ or src/ etc.
  const joined = cmds(runGit).join("\n");
  assert.doesNotMatch(joined, /functions\/|firestore\.rules|(^|\s)src\//, "no code path is ever staged/committed");
});

test("lands via cherry-pick onto fresh main + push HEAD:main (branch-robust; never a bare push)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C02", runGit });
  const seq = cmds(runGit);
  assert.equal(out.landed, true);
  assert.equal(out.attempts, 1);
  // commit → rev-parse → fetch → checkout -f -B eos-writeback FETCH_HEAD → reset --hard → cherry-pick → push HEAD:main
  assert.ok(seq.some((c) => c.startsWith("commit -m")));
  assert.ok(seq.includes("fetch origin main"));
  assert.ok(seq.includes("checkout -f -B eos-writeback FETCH_HEAD"));
  assert.ok(seq.some((c) => c.startsWith("cherry-pick ")));
  assert.ok(seq.includes("push origin HEAD:main"), "pushes HEAD:main explicitly");
  assert.ok(!seq.includes("push"), "never a bare `git push`");
});

test("no staged changes → does not commit or push (idempotent re-run)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 0 }] }); // nothing staged
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C03", runGit });
  assert.equal(out.landed, false);
  assert.equal(out.reason, "no-changes");
  assert.ok(!cmds(runGit).some((c) => c.startsWith("commit")), "no commit when nothing changed");
});

test("retries when push is rejected because main moved, then succeeds", () => {
  const runGit = gitDouble({
    "diff --cached": [{ code: 1 }],
    push: [{ code: 1 }, { code: 1 }, { code: 0 }], // rejected twice, then lands
  });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C04", runGit });
  assert.equal(out.landed, true);
  assert.equal(out.attempts, 3);
  // fetch happens once per attempt (re-sync before each replay)
  assert.equal(cmds(runGit).filter((c) => c === "fetch origin main").length, 3);
});

test("cherry-pick race aborts and re-syncs on the next attempt", () => {
  const runGit = gitDouble({
    "diff --cached": [{ code: 1 }],
    "cherry-pick": [{ code: 1 }, { code: 0 }], // conflict once, then clean
  });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C05", runGit });
  assert.equal(out.landed, true);
  assert.ok(cmds(runGit).includes("cherry-pick --abort"), "aborts the raced cherry-pick");
});

test("gives up after maxAttempts without throwing (orchestrator keeps landing others)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }], push: [{ code: 1 }, { code: 1 }, { code: 1 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C06", runGit, maxAttempts: 3 });
  assert.equal(out.landed, false);
  assert.equal(out.reason, "push-failed");
  assert.equal(out.attempts, 3);
});

test("final sweep stages only the work-intake roots (never code) and lands them", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  const out = landAllArtifacts({ runGit });
  const addCall = runGit.calls.find((a) => a[0] === "add");
  assert.deepEqual(addCall, ["add", "--", "docs/orchestration/work-intake/status", "docs/orchestration/work-intake/results", "docs/orchestration/work-intake/review-ready"]);
  assert.equal(out.landed, true);
  assert.ok(cmds(runGit).includes("push origin HEAD:main"));
  assert.doesNotMatch(cmds(runGit).join("\n"), /functions\/|src\/|firestore\.rules/);
});

test("sweep is a no-op when per-item landing already committed everything", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 0 }] });
  assert.equal(landAllArtifacts({ runGit }).reason, "no-changes");
});

test("a bad requestId fails closed (no path injection)", () => {
  const runGit = gitDouble();
  for (const bad of ["", "..", "a/b", "has space", "x".repeat(81), null]) {
    assert.throws(() => landItemArtifacts({ requestId: bad, runGit }), /invalid requestId/);
  }
  assert.equal(runGit.calls.length, 0, "never touches git for an invalid id");
});

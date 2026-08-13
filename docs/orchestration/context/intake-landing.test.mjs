import { test } from "node:test";
import assert from "node:assert/strict";
import { landItemArtifacts, landAllArtifacts, artifactPathsFor } from "./intake-landing.mjs";

// A scriptable git double: records every invocation, and returns a queued outcome per git subcommand so a test
// can simulate add failures / push rejections / cherry-pick or reset races. Default outcome is success (code 0).
function gitDouble(script = {}) {
  const calls = [];
  const queues = {};
  for (const [k, v] of Object.entries(script)) queues[k] = [...v];
  // default stdout by subcommand: rev-parse → a fake sha; show (path guard) → a clean work-intake path.
  const defStdout = (a) => (a === "rev-parse" ? "deadbeefcafe\n" : a === "show" ? "docs/orchestration/work-intake/status/x.status.json\n" : "");
  const runGit = (args) => {
    calls.push(args);
    // key by subcommand, disambiguating the two reset forms: `reset -q` (pre-stage index clear) vs
    // `reset --hard` (land-loop re-sync).
    const key = args[0] === "diff" ? "diff --cached" : args[0] === "reset" ? `reset ${args[1]}` : args[0];
    const q = queues[key];
    const outcome = q && q.length ? q.shift() : { code: 0, stdout: defStdout(args[0]) };
    return { code: outcome.code ?? 0, stdout: outcome.stdout ?? defStdout(args[0]), stderr: "" };
  };
  runGit.calls = calls;
  return runGit;
}
const cmds = (runGit) => runGit.calls.map((a) => a.join(" "));
const allExist = () => true; // default: every request-scoped path is present on disk

test("stages ONLY this requestId's work-intake paths — a PATCH item's code can never leak", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  landItemArtifacts({ requestId: "EOS-ISSUE-852-C01", runGit, pathExists: allExist });
  const addCall = runGit.calls.find((a) => a[0] === "add");
  assert.deepEqual(addCall, ["add", "--", ...artifactPathsFor("EOS-ISSUE-852-C01")]);
  const joined = cmds(runGit).join("\n");
  assert.doesNotMatch(joined, /functions\/|firestore\.rules|(^|\s)src\//, "no code path is ever staged/committed");
});

test("extraPaths: a governed child's work.json lands in the SAME per-item commit (provenance durable on main)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  const workJson = "docs/orchestration/work-intake/EOS-ISSUE-864-A.work.json";
  landItemArtifacts({ requestId: "EOS-ISSUE-864-A", runGit, pathExists: allExist, extraPaths: [workJson] });
  const addCall = runGit.calls.find((a) => a[0] === "add");
  assert.deepEqual(addCall, ["add", "--", ...artifactPathsFor("EOS-ISSUE-864-A"), workJson], "the child work.json is staged alongside status/results/review-ready");
});

test("extraPaths fail-closed: a path outside work-intake/ is rejected before touching git", () => {
  const runGit = gitDouble();
  assert.throws(
    () => landItemArtifacts({ requestId: "EOS-ISSUE-864-A", runGit, pathExists: allExist, extraPaths: ["functions/src/leak.ts"] }),
    /extraPaths must be within work-intake/,
  );
  assert.equal(runGit.calls.length, 0, "never touches git when an extra path is out of bounds");
});

test("lands via cherry-pick onto fresh main + push HEAD:main (branch-robust; never a bare push)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C02", runGit, pathExists: allExist });
  const seq = cmds(runGit);
  assert.equal(out.landed, true);
  assert.equal(out.attempts, 1);
  assert.ok(seq.some((c) => c.startsWith("commit -m")));
  assert.ok(seq.includes("fetch origin main"));
  assert.ok(seq.includes("checkout -f -B eos-writeback FETCH_HEAD"));
  assert.ok(seq.some((c) => c.startsWith("cherry-pick ")));
  assert.ok(seq.includes("push origin HEAD:main"), "pushes HEAD:main explicitly");
  assert.ok(!seq.includes("push"), "never a bare `git push`");
});

test("no staged changes → does not commit or push (idempotent re-run)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 0 }] }); // nothing to commit (already landed)
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C03", runGit, pathExists: allExist });
  assert.equal(out.landed, false);
  assert.equal(out.reason, "no-changes");
  assert.ok(!cmds(runGit).some((c) => c.startsWith("commit")), "no commit when nothing changed");
});

// --- verifier correction 1: optional-path staging must fail closed, never become a false no-changes ---

test("status-only item (BLOCKED: no result/review-ready) stages ONLY the existing status path and lands it", () => {
  const statusPath = `docs/orchestration/work-intake/status/EOS-ISSUE-842.status.json`;
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-842", runGit, pathExists: (p) => p === statusPath });
  const addCall = runGit.calls.find((a) => a[0] === "add");
  assert.deepEqual(addCall, ["add", "--", statusPath], "only the present status path is staged");
  assert.equal(out.landed, true, "the truthful status still lands");
});

test("a git-add error FAILS CLOSED — never silently reported as no-changes/success", () => {
  const runGit = gitDouble({ add: [{ code: 128 }] }); // git add errors
  assert.throws(
    () => landItemArtifacts({ requestId: "EOS-ISSUE-852-C07", runGit, pathExists: allExist }),
    /git add failed/,
    "staging failure surfaces as an error, not a no-changes success",
  );
  assert.ok(!cmds(runGit).some((c) => c.startsWith("commit")), "never commits after a failed add");
});

test("per-item: zero request-scoped artifacts FAILS CLOSED (a just-executed item must have a status)", () => {
  const runGit = gitDouble();
  assert.throws(
    () => landItemArtifacts({ requestId: "EOS-ISSUE-852-C08", runGit, pathExists: () => false }),
    /no status\/result\/review-ready exists.*fail closed/,
    "no artifacts after execution must not be a successful no-op — it would silently lose the item",
  );
  assert.equal(runGit.calls.length, 0, "never touches git; refuses before staging");
});

test("per-item: a failed pre-stage index clear (git reset) fails closed before staging/commit", () => {
  const runGit = gitDouble({ "reset -q": [{ code: 1 }] }); // pre-stage index clearing fails
  assert.throws(
    () => landItemArtifacts({ requestId: "EOS-ISSUE-852-C11", runGit, pathExists: allExist }),
    /failed to clear the index/,
    "must not proceed to stage/commit from an uncleared (possibly contaminated) index",
  );
  const seq = cmds(runGit);
  assert.ok(!seq.some((c) => c.startsWith("add -- ")), "never stages after a failed reset");
  assert.ok(!seq.some((c) => c.startsWith("commit")), "never commits after a failed reset");
});

// --- shared-index contamination: a PATCH worker's staged code/workflow change must never ride the write-back ---

test("unstages the shared index before staging (a PATCH worker's staged files can't ride along)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  landItemArtifacts({ requestId: "EOS-ISSUE-852-C01", runGit, pathExists: allExist });
  const seq = cmds(runGit);
  const resetIdx = seq.indexOf("reset -q HEAD");
  const addIdx = seq.findIndex((c) => c.startsWith("add -- "));
  assert.ok(resetIdx >= 0, "index is unstaged");
  assert.ok(resetIdx < addIdx, "unstage happens BEFORE the scoped add");
});

test("path guard: refuses to push a commit that touches a workflow/code file (fail closed), never pushes it", () => {
  // Simulate the exact attempt-3 failure: the committed diff contains a .github/workflows file.
  const runGit = gitDouble({
    "diff --cached": [{ code: 1 }],
    show: [{ code: 0, stdout: "docs/orchestration/work-intake/status/x.status.json\n.github/workflows/orchestration-agent-manager-tests.yml\n" }],
  });
  assert.throws(
    () => landItemArtifacts({ requestId: "EOS-ISSUE-852-C10", runGit, pathExists: allExist }),
    /refusing to push non-artifact paths/,
    "a non-work-intake path in the commit is refused before any push",
  );
  assert.ok(!cmds(runGit).includes("push origin HEAD:main"), "never pushes a contaminated commit");
});

// --- verifier correction 2: a failed checkout/reset must retry, not cherry-pick on unknown branch state ---

test("a failed reset --hard retries on the next attempt instead of cherry-picking blindly", () => {
  const runGit = gitDouble({
    "diff --cached": [{ code: 1 }],
    "reset --hard": [{ code: 1 }, { code: 0 }], // first land-loop reset fails → must NOT cherry-pick that attempt
  });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C09", runGit, pathExists: allExist });
  assert.equal(out.landed, true);
  // exactly one cherry-pick (only the successful attempt), proving the failed-reset attempt bailed before it
  assert.equal(cmds(runGit).filter((c) => c.startsWith("cherry-pick") && c !== "cherry-pick --abort").length, 1);
});

test("retries when push is rejected because main moved, then succeeds", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }], push: [{ code: 1 }, { code: 1 }, { code: 0 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C04", runGit, pathExists: allExist });
  assert.equal(out.landed, true);
  assert.equal(out.attempts, 3);
  assert.equal(cmds(runGit).filter((c) => c === "fetch origin main").length, 3);
});

test("cherry-pick race aborts and re-syncs on the next attempt", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }], "cherry-pick": [{ code: 1 }, { code: 0 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C05", runGit, pathExists: allExist });
  assert.equal(out.landed, true);
  assert.ok(cmds(runGit).includes("cherry-pick --abort"), "aborts the raced cherry-pick");
});

test("gives up after maxAttempts without throwing (orchestrator keeps landing others)", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }], push: [{ code: 1 }, { code: 1 }, { code: 1 }] });
  const out = landItemArtifacts({ requestId: "EOS-ISSUE-852-C06", runGit, pathExists: allExist, maxAttempts: 3 });
  assert.equal(out.landed, false);
  assert.equal(out.reason, "push-failed");
  assert.equal(out.attempts, 3);
});

test("final sweep stages only the work-intake roots (never code) and lands them", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 1 }] });
  const out = landAllArtifacts({ runGit, pathExists: allExist });
  const addCall = runGit.calls.find((a) => a[0] === "add");
  assert.deepEqual(addCall, ["add", "--", "docs/orchestration/work-intake/status", "docs/orchestration/work-intake/results", "docs/orchestration/work-intake/review-ready"]);
  assert.equal(out.landed, true);
  assert.ok(cmds(runGit).includes("push origin HEAD:main"));
  assert.doesNotMatch(cmds(runGit).join("\n"), /functions\/|src\/|firestore\.rules/);
});

test("sweep is a no-op when per-item landing already committed everything", () => {
  const runGit = gitDouble({ "diff --cached": [{ code: 0 }] });
  assert.equal(landAllArtifacts({ runGit, pathExists: allExist }).reason, "no-changes");
});

test("a bad requestId fails closed (no path injection)", () => {
  const runGit = gitDouble();
  for (const bad of ["", "..", "a/b", "has space", "x".repeat(81), null]) {
    assert.throws(() => landItemArtifacts({ requestId: bad, runGit, pathExists: allExist }), /invalid requestId/);
  }
  assert.equal(runGit.calls.length, 0, "never touches git for an invalid id");
});

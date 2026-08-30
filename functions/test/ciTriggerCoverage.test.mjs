// CI trigger coverage — tests for the logic that decides whether a governance lane actually ran
// (DECISIONS #144).
//
// Every case below is a defect this tool actually shipped and then had to fix. They are pinned as
// regressions rather than written as coverage, because each one was a FALSE ALARM, and a checker
// whose alarms are usually wrong is one people learn to ignore — which would leave the #144 gate
// worse off than having no tool at all.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bucketChecks,
  globMatches,
  jobNames,
  runsOnPullRequest,
  verdict,
  workflowPaths,
} from "../../scripts/ciTriggerCoverage.lib.mjs";

test("DEFECT 1: `**` crosses directories and `*` does not", () => {
  // The original fell back to "prefix of the first star", so this pattern matched EVERY file under
  // functions/test and flagged the Rules-regression lane on a PR that never touched Rules.
  const glob = "functions/test/**Rules*.test.js";
  assert.ok(globMatches(glob, "functions/test/reorderRequestsRules.test.js"));
  assert.ok(!globMatches(glob, "functions/test/certificationPrivateAiFailClosed.test.mjs"));
  assert.ok(!globMatches(glob, "functions/test/ownershipModel.test.mjs"));

  // `*` must not cross a separator; `**` must.
  assert.ok(globMatches("functions/src/*.ts", "functions/src/index.ts"));
  assert.ok(!globMatches("functions/src/*.ts", "functions/src/ownership/typedOwner.ts"));
  assert.ok(globMatches("functions/src/**", "functions/src/ownership/typedOwner.ts"));

  // A dot is a literal, not "any character".
  assert.ok(!globMatches("firestore.rules", "firestoreXrules"));
  assert.ok(globMatches("firestore.rules", "firestore.rules"));
});

test("DEFECT 2: a job appears under its KEY when it has no explicit name", () => {
  // `gitleaks:` and `build:` appear in the rollup under bare keys. Reading only `name:` missed both
  // and reported two lanes that plainly ran as NOT TRIGGERED.
  const wf = ["name: Secret scan (gitleaks)", "on:", "  pull_request:", "jobs:", "  gitleaks:", "    runs-on: ubuntu-latest"].join("\n");
  assert.ok(jobNames(wf).includes("gitleaks"));

  const named = ["jobs:", "  ownership:", "    name: Ownership authorities (build + run)", "    runs-on: x"].join("\n");
  const names = jobNames(named);
  assert.ok(names.includes("ownership"), "the key is a candidate");
  assert.ok(names.includes("Ownership authorities (build + run)"), "the display name is a candidate");
});

test("DEFECT 3: a workflow with no pull_request trigger can never appear in a PR rollup", () => {
  assert.ok(runsOnPullRequest("on:\n  pull_request:\n    paths:\n      - \"a\"\n"));
  assert.ok(runsOnPullRequest("on:\n  pull_request_target:\n"));
  // Issue-driven and dispatch-only workflows were reported as missing from PRs they cannot join.
  assert.ok(!runsOnPullRequest("on:\n  issue_comment:\n    types: [created]\n"));
  assert.ok(!runsOnPullRequest("on:\n  workflow_dispatch:\n"));
});

test("DEFECT 4: an empty rollup is 'not started', never 'will never run'", () => {
  // The tool committed against itself the exact error it exists to catch: it read absence of checks
  // on a freshly pushed head as proof the lanes were filtered out.
  const expected = [{ present: false }];
  assert.equal(verdict({ checks: [], expected }).state, "NOT_SETTLED");

  // Still running is also not an answer.
  const pending = [{ name: "a", status: "IN_PROGRESS", conclusion: null }];
  assert.equal(verdict({ checks: pending, expected: [{ present: true }] }).state, "NOT_SETTLED");
});

test("an empty rollup with NOTHING watched is correct, not unsettled", () => {
  // A PR touching only unwatched files legitimately has zero checks. Reporting NOT_SETTLED there
  // would wait forever for an event that cannot happen.
  assert.equal(verdict({ checks: [], expected: [] }).state, "NO_MATCHING_LANE");
});

test("the settled verdict: a lane that never ran is NOT_CLEAN even with zero failures", () => {
  // This is the whole point of #144 -- green plus a missing lane is not a pass.
  const checks = [{ name: "a", conclusion: "SUCCESS" }];
  assert.equal(verdict({ checks, expected: [{ present: true }] }).state, "CLEAN");
  const v = verdict({ checks, expected: [{ present: true }, { present: false, workflowName: "Private-AI" }] });
  assert.equal(v.state, "NOT_CLEAN");
  assert.equal(v.notTriggered.length, 1);

  // And a failure is NOT_CLEAN regardless of coverage.
  assert.equal(verdict({ checks: [{ name: "a", conclusion: "FAILURE" }], expected: [{ present: true }] }).state, "NOT_CLEAN");
});

test("bucketing: skipped and neutral are not failures, cancelled and timed-out are", () => {
  const b = bucketChecks([
    { name: "s", conclusion: "SUCCESS" },
    { name: "n", conclusion: "NEUTRAL" },
    { name: "k", conclusion: "SKIPPED" },
    { name: "f", conclusion: "FAILURE" },
    { name: "c", conclusion: "CANCELLED" },
    { name: "t", conclusion: "TIMED_OUT" },
    { name: "p", status: "QUEUED", conclusion: null },
  ]);
  assert.deepEqual(b.PASS, ["s", "n", "k"]);
  assert.deepEqual(b.FAIL, ["f", "c", "t"]);
  assert.deepEqual(b.PENDING, ["p"]);
});

test("workflowPaths: a declared filter is a list, an absent one is null", () => {
  const filtered = ["on:", "  pull_request:", "    paths:", '      - "functions/src/**"', '      - "firestore.rules"', "  workflow_dispatch:"].join("\n");
  assert.deepEqual(workflowPaths(filtered), ["functions/src/**", "firestore.rules"]);
  // null means "watches everything", which is a different statement from "watches nothing".
  assert.equal(workflowPaths("on:\n  pull_request:\n  push:\n"), null);
});

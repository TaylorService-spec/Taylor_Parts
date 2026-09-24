// WORKFLOW SELF-PUSH FENCE -- what it must catch, and what it must never catch.
//
//   * the real tree passes, with exactly the three recorded self-pushing workflows;
//   * the exact file that caused the #1929 bypass, reintroduced under any name, FAILS;
//   * a pwsh push and a push behind a retry/conditional are caught, not just a bare bash line;
//   * prose ABOUT pushing -- a comment, or a workflow that merely says "never force-push" -- does
//     not trip the fence, because a fence with false positives gets allowlisted into uselessness;
//   * a stale allowlist entry FAILS, so the list can only shrink.
//
// Run: node --test scripts/workflowSelfPushFence.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_SELF_PUSH,
  auditWorkflows,
  findSelfPushLines,
  listWorkflowFiles,
} from "./workflowSelfPushFence.mjs";

const audit = (files, allowed = new Set()) =>
  auditWorkflows({ files: Object.keys(files), allowed, readFile: (f) => files[f] });

test("the committed tree is clean and the allowlist is exactly the three intake workflows", () => {
  const { violations, stale } = auditWorkflows();
  assert.deepEqual(violations, [], "a workflow pushes repository content and is not allowlisted");
  assert.deepEqual(stale, [], "an allowlist entry no longer pushes (or no longer exists)");
  assert.deepEqual([...ALLOWED_SELF_PUSH].sort(), [
    "eos-intake-writeback.yml",
    "eos-issue-intake.yml",
    "eos-patch-integrate.yml",
  ]);
  assert.ok(listWorkflowFiles().length > 100, "the workflow census should see the whole directory");
});

test("the #1929 apply workflow fails, under any name", () => {
  // Verbatim shape of .github/workflows/crm-retire-firestore-writes-apply.yml, deleted by c9399b52.
  const source = [
    "name: CRM retire Firestore writes one-shot apply",
    "on:",
    "  push:",
    "    branches:",
    "      - crm/nonprod-retire-firestore-writes",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  apply:",
    "    steps:",
    "      - run: |",
    "          git commit -m 'fix(crm): retire legacy Firestore CRM write grants'",
    "          git push origin HEAD:crm/nonprod-retire-firestore-writes",
  ].join("\n");
  const { violations } = audit({ "anything-at-all.yml": source });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].name, "anything-at-all.yml");
  assert.deepEqual(violations[0].lines, [13]);
});

test("a pwsh push and a conditional/retry push are both caught", () => {
  const pwsh = ["      - shell: pwsh", "        run: |", "          git push origin HEAD:main"].join("\n");
  const retry = ["        run: |", "          for i in 1 2 3; do git push && break; done"].join("\n");
  assert.deepEqual(findSelfPushLines(pwsh), [3]);
  assert.deepEqual(findSelfPushLines(retry), [2]);
});

test("prose about pushing does not trip the fence", () => {
  const prose = [
    "# This lane never runs `git push` -- it is read-only.",
    "#   git push origin HEAD:main",
    "name: Something Read Only",
    "jobs:",
    "  x:",
    "    steps:",
    "      - run: echo 'no pushing here'",
  ].join("\n");
  assert.deepEqual(findSelfPushLines(prose), []);
  assert.deepEqual(audit({ "read-only.yml": prose }).violations, []);
});

test("a stale allowlist entry fails -- the list may only shrink", () => {
  const gone = auditWorkflows({
    files: ["still-here.yml"],
    allowed: new Set(["retired.yml"]),
    readFile: () => "jobs:\n  x:\n    steps:\n      - run: echo hi\n",
  });
  assert.deepEqual(gone.stale, [{ name: "retired.yml", reason: "workflow no longer exists" }]);

  const quiet = auditWorkflows({
    files: ["quiet.yml"],
    allowed: new Set(["quiet.yml"]),
    readFile: () => "jobs:\n  x:\n    steps:\n      - run: echo hi\n",
  });
  assert.deepEqual(quiet.stale, [
    { name: "quiet.yml", reason: "no longer pushes repository content" },
  ]);
});

test("an allowlisted self-pushing workflow is permitted and is not reported stale", () => {
  const source = "jobs:\n  x:\n    steps:\n      - run: git push origin HEAD:main\n";
  const { violations, stale } = auditWorkflows({
    files: ["eos-patch-integrate.yml"],
    allowed: new Set(["eos-patch-integrate.yml"]),
    readFile: () => source,
  });
  assert.deepEqual(violations, []);
  assert.deepEqual(stale, []);
});

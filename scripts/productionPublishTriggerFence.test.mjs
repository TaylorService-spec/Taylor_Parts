// PRODUCTION PUBLISH TRIGGER FENCE -- what it must catch, and what it must never catch.
//
//   * the real tree passes, and deploy-field-ops.yml really is `workflow_dispatch`-only;
//   * MERGE TO main IS NOT A PUBLISH: the exact pre-ruling shape of deploy-field-ops.yml,
//     reintroduced under ANY name, FAILS;
//   * every other automatic event fails too -- including ones nobody listed, which is why the
//     rule is an allowlist of manual triggers rather than a blocklist of automatic ones;
//   * the three legal spellings of `on:` are all read correctly, so the fence cannot be slipped
//     past with `on: [push]` or a YAML list;
//   * `branches:`/`paths:`/`inputs:` are configuration, not triggers, and prose about pushing
//     does not trip the fence -- a fence with false positives gets allowlisted into uselessness;
//   * a non-publishing workflow is not fenced at all: this guard is about the production publish,
//     not about triggers in general;
//   * a stale expectation FAILS, so the guard cannot be neutered by deleting what it guards.
//
// Run: node --test scripts/productionPublishTriggerFence.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EXPECTED_PRODUCTION_PUBLISHERS,
  MANUAL_TRIGGERS,
  WORKFLOWS_DIR,
  auditWorkflows,
  declaredTriggers,
  listWorkflowFiles,
  publishesToPages,
} from "./productionPublishTriggerFence.mjs";

const audit = (files) =>
  auditWorkflows({
    files: Object.keys(files),
    expected: new Set(),
    readFile: (f) => files[f],
  });

// The verbatim shape of the `on:` block deploy-field-ops.yml carried before the Owner ruling,
// with the publish step that makes it a publisher. This is the thing being fenced.
const PRE_RULING = [
  "name: Deploy Field Ops (Vite) to GitHub Pages",
  "on:",
  "  push:",
  "    branches: [main]",
  "    paths:",
  '      - "index.html"',
  '      - "field-ops-app-vite/**"',
  "jobs:",
  "  build:",
  "    steps:",
  "      - uses: actions/upload-pages-artifact@v3",
  "  deploy:",
  "    steps:",
  "      - uses: actions/deploy-pages@v4",
].join("\n");

test("the committed tree is clean and deploy-field-ops.yml is the one known publisher", () => {
  const { publishers, violations, stale } = auditWorkflows();
  assert.deepEqual(
    violations,
    [],
    "a workflow publishes the production-identified Pages site on an automatic trigger",
  );
  assert.deepEqual(stale, [], "an expected publisher no longer publishes (or no longer exists)");
  assert.deepEqual(publishers, ["deploy-field-ops.yml"]);
  assert.deepEqual([...EXPECTED_PRODUCTION_PUBLISHERS], ["deploy-field-ops.yml"]);
  assert.ok(listWorkflowFiles().length > 100, "the workflow census should see the whole directory");
});

test("MERGE TO main IS NOT A PUBLISH -- the real workflow declares workflow_dispatch and nothing else", () => {
  // Asserted against the committed file itself, not against the audit's summary, so this states
  // the governance property in the form the Owner ruled it.
  const source = readFileSync(join(WORKFLOWS_DIR, "deploy-field-ops.yml"), "utf8");
  assert.ok(publishesToPages(source), "deploy-field-ops.yml must still be the production publisher");
  assert.deepEqual(declaredTriggers(source), ["workflow_dispatch"]);
  assert.deepEqual([...MANUAL_TRIGGERS], ["workflow_dispatch"]);
});

test("the pre-ruling push trigger fails, under any name", () => {
  const { violations } = audit({ "anything-at-all.yml": PRE_RULING });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].name, "anything-at-all.yml");
  assert.deepEqual(violations[0].automatic, ["push"]);
});

test("every automatic event is refused, not just push -- including ones no blocklist named", () => {
  for (const event of [
    "push",
    "pull_request",
    "pull_request_target",
    "schedule",
    "workflow_run",
    "workflow_call",
    "repository_dispatch",
    "release",
    "create",
    "status",
    "some_future_github_event",
  ]) {
    const source = [
      "on:",
      `  ${event}:`,
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - uses: actions/deploy-pages@v4",
    ].join("\n");
    const { violations } = audit({ "publisher.yml": source });
    assert.deepEqual(
      violations.map((v) => v.automatic),
      [[event]],
      `${event} must be refused on a production-publishing workflow`,
    );
  }
});

test("workflow_dispatch alongside an automatic trigger is still a violation", () => {
  const source = [
    "on:",
    "  workflow_dispatch:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  deploy:",
    "    steps:",
    "      - uses: actions/deploy-pages@v4",
  ].join("\n");
  const { violations } = audit({ "publisher.yml": source });
  assert.deepEqual(violations[0].automatic, ["push"]);
});

test("all three spellings of `on:` are read, so none of them is a way around the fence", () => {
  assert.deepEqual(declaredTriggers("on: push\n"), ["push"]);
  assert.deepEqual(declaredTriggers("on: [push, workflow_dispatch]\n"), [
    "push",
    "workflow_dispatch",
  ]);
  assert.deepEqual(declaredTriggers("on:\n  - push\n  - schedule\n"), ["push", "schedule"]);
  assert.deepEqual(declaredTriggers('"on":\n  push:\n    branches: [main]\n'), ["push"]);

  // Each inline form is caught end to end as well, not just parsed.
  for (const line of ["on: push", "on: [push]"]) {
    const { violations } = audit({
      "publisher.yml": [line, "jobs:", "  d:", "    steps:", "      - uses: actions/deploy-pages@v4"].join("\n"),
    });
    assert.deepEqual(violations[0].automatic, ["push"], `${line} must be caught`);
  }
});

test("branches/paths/inputs are configuration, not triggers", () => {
  const source = [
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      confirm:",
    "        required: true",
    "        type: string",
    "jobs:",
    "  deploy:",
    "    steps:",
    "      - uses: actions/deploy-pages@v4",
  ].join("\n");
  assert.deepEqual(declaredTriggers(source), ["workflow_dispatch"]);
  assert.deepEqual(audit({ "publisher.yml": source }).violations, []);
});

test("a `push:` that is not a trigger is not mistaken for one", () => {
  // `push` appearing deeper in the file -- a step name, a job id, an input -- is not an `on:` key.
  const source = [
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    "  deploy:",
    "    steps:",
    "      - name: push the artifact",
    "        push: no",
    "      - uses: actions/deploy-pages@v4",
  ].join("\n");
  assert.deepEqual(declaredTriggers(source), ["workflow_dispatch"]);
  assert.deepEqual(audit({ "publisher.yml": source }).violations, []);
});

test("prose about publishing does not make a workflow a publisher", () => {
  const prose = [
    "# This lane never publishes. It does not use actions/deploy-pages@v4 and must not.",
    "#   - uses: actions/upload-pages-artifact@v3",
    "on:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  x:",
    "    steps:",
    "      - run: echo 'no publishing here'",
  ].join("\n");
  assert.equal(publishesToPages(prose), false);
  assert.deepEqual(audit({ "read-only.yml": prose }).violations, []);
});

test("a workflow that does not publish is not fenced -- this is not a general trigger rule", () => {
  // vite-build-check.yml is the build validation that must KEEP running on push and PR. If this
  // fence ever touched it, removing the Pages push trigger would have cost real coverage.
  const buildCheck = readFileSync(join(WORKFLOWS_DIR, "vite-build-check.yml"), "utf8");
  assert.equal(publishesToPages(buildCheck), false);
  assert.deepEqual(declaredTriggers(buildCheck), ["push", "pull_request"]);
  assert.deepEqual(auditWorkflows({ expected: new Set() }).violations, []);
});

test("a stale expectation fails -- the guard cannot be neutered by deleting what it guards", () => {
  const gone = auditWorkflows({
    files: ["still-here.yml"],
    expected: new Set(["retired.yml"]),
    readFile: () => "on:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: echo hi\n",
  });
  assert.deepEqual(gone.stale, [{ name: "retired.yml", reason: "workflow no longer exists" }]);

  const quiet = auditWorkflows({
    files: ["quiet.yml"],
    expected: new Set(["quiet.yml"]),
    readFile: () => "on:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: echo hi\n",
  });
  assert.deepEqual(quiet.stale, [
    { name: "quiet.yml", reason: "no longer publishes to GitHub Pages" },
  ]);
});

test("a publishing workflow with no `on:` at all is reported rather than passing by default", () => {
  const source = "jobs:\n  deploy:\n    steps:\n      - uses: actions/deploy-pages@v4\n";
  const { violations } = audit({ "publisher.yml": source });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, "declares no triggers at all");
});

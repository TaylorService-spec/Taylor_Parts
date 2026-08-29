// A contract is CI-blind when its trigger does not include an input it READS.
//
// ════════════════════ THE DEFECT THIS EXISTS FOR ════════════════════
//
// `orchestration-collaboration-tests.yml` runs `current-state.test.mjs`, which reads
// `docs/orchestration/execution-backlog.md` and derives the selector state from it. That file was
// not among the workflow's trigger paths. So PR #1344 changed the backlog, did not select the
// contract that asserts on it, and `main` stayed red for NINE DAYS with no run to say so. It
// surfaced only because an unrelated CI change touched the workflow file itself, and a workflow's
// own filename IS in its paths.
//
// This is the DECISIONS #124 class wearing a new costume. #124 was "a suite registered nowhere".
// This is worse to spot: the suite is registered, it is listed in a workflow, its history is green,
// and it is still blind — because being *runnable* and being *selected when it matters* are
// different properties, and only the second one protects anything.
//
// ════════════════════ WHAT THIS GUARD ASSERTS ════════════════════
//
// For the orchestration collaboration workflow: every repository file that its test files READ must
// appear in the workflow's trigger paths, for BOTH the pull_request and push events. A test that
// reads a file the workflow does not watch is a contract that cannot see its own input.
//
// ════════════════════ WHAT IT DELIBERATELY IS NOT ════════════════════
//
// It is not the CI-v2 router, and it must not grow into one. It is bounded to this workflow, reads
// the YAML as text rather than modelling GitHub's path semantics, and detects the one pattern that
// actually caused the outage: a test reaching OUT of its own directory with
// `readFileSync(join(here, "..", ...))`. A general solution belongs to the contract-registry work;
// this is the specific tripwire for the specific hole, and saying so is the point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..", "..", "..");
const WORKFLOW = join(REPO, ".github", "workflows", "orchestration-collaboration-tests.yml");

const workflowText = readFileSync(WORKFLOW, "utf8");

/** The test files this workflow actually runs, as repo-relative paths. */
function testFilesRunByWorkflow() {
  return [...new Set(workflowText.match(/docs\/orchestration\/[\w/.-]+\.test\.mjs/g) ?? [])];
}

/**
 * Repo-relative files a test reads by reaching OUT of its own directory.
 *
 * Matches `join(here, "..", "x", "y.md")` — the shape that caused the outage. A test reading a
 * sibling in its own directory is already covered, because that directory is what the workflow
 * watches.
 */
function outsideInputsRead(testRelPath) {
  const abs = join(REPO, testRelPath);
  let src;
  try { src = readFileSync(abs, "utf8"); } catch { return []; }
  // Strip comments first: a read that is described in prose, or commented out, is not a read. This
  // guard scans the same directory it lives in, so without this it matches the example in its own
  // header and reports itself.
  src = src.replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "").replace(new RegExp("^\\s*//.*$", "gm"), "");
  const dir = dirname(abs);
  const found = new Set();
  for (const m of src.matchAll(/join\(\s*here\s*,\s*((?:"[^"]+"\s*,\s*)*"[^"]+")\s*\)/g)) {
    const parts = [...m[1].matchAll(/"([^"]+)"/g)].map((p) => p[1]);
    if (!parts.includes("..")) continue; // stays inside its own directory
    found.add(relative(REPO, resolve(dir, ...parts)).split(sep).join(posix.sep));
  }
  return [...found];
}

/** The trigger paths declared for one event, read as text so no YAML dependency is added. */
function triggerPaths(event) {
  const block = workflowText.split(new RegExp(`^\\s{2}${event}:\\s*$`, "m"))[1] ?? "";
  const upToNextEvent = block.split(/^\s{2}\w[\w_]*:\s*$/m)[0] ?? "";
  return [...upToNextEvent.matchAll(/^\s+- "([^"]+)"/gm)].map((m) => m[1]);
}

test("every test this workflow runs is actually selected by a change to the files it reads", () => {
  const tests = testFilesRunByWorkflow();
  assert.ok(tests.length > 0, "the workflow must name the test files it runs");

  const pr = triggerPaths("pull_request");
  const push = triggerPaths("push");
  assert.ok(pr.length > 0 && push.length > 0, "both events must declare paths");

  const blind = [];
  for (const t of tests) {
    for (const input of outsideInputsRead(t)) {
      // A path entry covers an input if it names it exactly or globs its directory.
      const covered = (paths) => paths.some((p) =>
        p === input || (p.endsWith("/**") && input.startsWith(p.slice(0, -2))));
      if (!covered(pr)) blind.push(`${input}  (read by ${t}) — missing from pull_request paths`);
      if (!covered(push)) blind.push(`${input}  (read by ${t}) — missing from push paths`);
    }
  }

  assert.deepEqual(
    blind, [],
    `These contracts read an input their workflow does not watch, so a change to it would NOT run ` +
    `them — the exact defect that left main red for nine days:\n  ${blind.join("\n  ")}`,
  );
});

test("the specific regression: a change to execution-backlog.md selects this workflow", () => {
  // Named separately from the general rule above, because this is the file that actually went
  // unwatched and a future reader should be able to see it asserted by name rather than inferred.
  const input = "docs/orchestration/execution-backlog.md";
  const reader = "docs/orchestration/context/current-state.test.mjs";

  assert.ok(
    outsideInputsRead(reader).includes(input),
    `${reader} is expected to read ${input}; if that stopped being true, this guard needs revisiting`,
  );
  for (const event of ["pull_request", "push"]) {
    assert.ok(
      triggerPaths(event).includes(input),
      `${input} must be in the ${event} trigger paths, or a backlog change cannot run the contract that asserts on it`,
    );
  }
});

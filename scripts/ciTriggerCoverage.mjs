#!/usr/bin/env node
// CI TRIGGER COVERAGE — which required lanes actually RAN against this head (DECISIONS #144).
//
// ============================ WHY THIS EXISTS ============================
//
// PR #1602 merged on "92/92 SUCCESS". That number was copied faithfully from
// `gh pr view --json statusCheckRollup`, and it was still insufficient evidence: this repository
// path-filters its workflows, so a check only re-runs when the head commit touches a path it
// watches. Two governance lanes never executed against that head, and BOTH were carrying real
// failures -- a certification target guard that could have written to the wrong project, and an
// unendorsed change to the Certification World fingerprint.
//
// The rollup was green because the checks that would have failed were NOT ASKED TO RUN.
//
// So this tool answers the question the rollup cannot:
//
//     PASS           the lane ran against this head and passed
//     NOT TRIGGERED  the lane watches a path this PR changed, but did not run
//     FAIL           the lane ran and failed
//
// A NOT TRIGGERED safety lane is an UNKNOWN, and an unknown is not a pass.
//
// ============================ WHAT IT COMPARES ============================
//
// For every workflow under .github/workflows, it reads the `paths:` filters and matches them
// against the files this branch actually changed versus its merge base. A workflow whose filter
// matches a changed file is EXPECTED to have run. It then checks whether a job from that workflow
// appears in the PR's check rollup.
//
// DELIBERATELY CONSERVATIVE. A workflow with no `paths:` filter runs on everything, so it is only
// reported when it is absent. Glob support is limited to the forms this repo actually uses
// (`dir/**`, `dir/*.ext`, exact paths) -- an unrecognised pattern is treated as MATCHING, because
// over-reporting a lane as expected is safe and under-reporting is the whole failure mode.
//
// READ-ONLY. Reads git and the GitHub API. Writes nothing, changes nothing.
//
// Usage:
//   node scripts/ciTriggerCoverage.mjs --pr 1619
//   node scripts/ciTriggerCoverage.mjs --pr 1619 --base main
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(REPO, ".github", "workflows");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: REPO, encoding: "utf8" }).trim();

/** The `paths:` globs a workflow watches, or null when it watches everything. */
function workflowPaths(source) {
  const lines = source.split(/\r?\n/);
  const globs = [];
  let inPaths = false;
  let hasTriggerBlock = false;
  for (const line of lines) {
    if (/^\s*(paths|paths-ignore):\s*$/.test(line)) {
      inPaths = /paths:/.test(line);
      hasTriggerBlock = true;
      continue;
    }
    if (inPaths) {
      const m = /^\s*-\s*"?([^"#]+?)"?\s*$/.exec(line);
      if (m) { globs.push(m[1]); continue; }
      if (line.trim() !== "") inPaths = false;
    }
  }
  return hasTriggerBlock ? globs : null;
}

/**
 * Glob -> RegExp, translated properly rather than approximated.
 *
 * The first version special-cased a few shapes and fell back to "prefix of the first star", which
 * over-matched badly: `functions/test/**Rules*.test.js` then matched EVERY file under
 * `functions/test`, so the tool reported the Rules-regression lane as NOT TRIGGERED on a PR that
 * never touched Rules. A checker that cries wolf teaches people to ignore it, which is worse than
 * not having one at all.
 *
 *   **  crosses directory separators
 *   *   does not
 */
function globToRegExp(glob) {
  let rx = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { rx += ".*"; i += 1; } else rx += "[^/]*";
    } else if (c === "?") {
      rx += "[^/]";
    } else {
      rx += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${rx}$`);
}

function globMatches(glob, file) {
  return glob === file || globToRegExp(glob).test(file);
}

const prNumber = arg("pr");
if (!prNumber) throw new Error("--pr is required.");
const base = arg("base", "main");

// The PR's OWN file list, from GitHub -- not `git diff` against the local checkout. The two differ
// whenever the working branch is not the PR's branch, and they differ ALWAYS once a PR is merged,
// which would make this tool unable to audit the very merge that motivated it. Falling back to
// local git keeps it usable offline for the current branch.
let changed;
try {
  changed = JSON.parse(sh("gh", ["pr", "view", prNumber, "--json", "files"])).files.map((f) => f.path);
} catch {
  const mergeBase = sh("git", ["merge-base", `origin/${base}`, "HEAD"]);
  changed = sh("git", ["diff", "--name-only", mergeBase, "HEAD"]).split("\n").filter(Boolean);
}

const rollup = JSON.parse(sh("gh", ["pr", "view", prNumber, "--json", "statusCheckRollup,headRefOid"]));
const head = rollup.headRefOid;
const checks = rollup.statusCheckRollup ?? [];
const ranJobNames = new Set(checks.map((c) => c.name));
const byState = { PASS: [], FAIL: [], PENDING: [] };
for (const c of checks) {
  const state = c.conclusion ?? c.status;
  if (state === "SUCCESS" || state === "NEUTRAL" || state === "SKIPPED") byState.PASS.push(c.name);
  else if (state === "FAILURE" || state === "CANCELLED" || state === "TIMED_OUT") byState.FAIL.push(c.name);
  else byState.PENDING.push(c.name);
}

// A workflow's job names are what appear in the rollup, so map workflow file -> its job `name:`s.
const expected = [];
for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml"))) {
  const src = readFileSync(path.join(WORKFLOW_DIR, file), "utf8");

  // Only workflows that actually trigger on `pull_request` can appear in a PR's check rollup.
  // Issue-driven and dispatch-only workflows (intake, patch integration, the GPT review) never do,
  // and the first version reported all three as NOT TRIGGERED -- three false alarms in a tool whose
  // entire value is that its alarms mean something.
  if (!/^\s*pull_request(_target)?:/m.test(src)) continue;

  const globs = workflowPaths(src);
  const watchesEverything = globs === null;
  const matched = watchesEverything ? changed.slice(0, 1) : changed.filter((f) => globs.some((g) => globMatches(g, f)));
  if (matched.length === 0) continue;

  const workflowName = /^name:\s*(.+)$/m.exec(src)?.[1]?.trim() ?? file;
  // A job appears in the rollup under its `name:` when it has one, and under its KEY otherwise.
  // The first version read only `name:` and so missed `gitleaks:` and `build:` entirely, reporting
  // two lanes that plainly ran as NOT TRIGGERED.
  const jobsAt = src.indexOf("\njobs:");
  const jobsBlock = jobsAt >= 0 ? src.slice(jobsAt) : "";
  const jobKeys = [...jobsBlock.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  const jobDisplayNames = [...jobsBlock.matchAll(/^\s{4}name:\s*(.+)$/gm)].map((m) =>
    m[1].trim().replace(/^["']|["']$/g, ""),
  );
  const jobNames = [...jobKeys, ...jobDisplayNames];
  const present = jobNames.some((n) => ranJobNames.has(n)) || ranJobNames.has(workflowName);
  expected.push({ file, workflowName, matched: matched.slice(0, 3), present });
}

console.log(`CI trigger coverage — PR #${prNumber}, head ${head.slice(0, 8)}\n`);
console.log(`changed files vs ${base}: ${changed.length}`);
console.log(`checks in rollup: ${checks.length}  (PASS ${byState.PASS.length} · FAIL ${byState.FAIL.length} · PENDING ${byState.PENDING.length})\n`);

// ============================ SETTLED, OR THE ANSWER IS NOT YET ============================
//
// NOT TRIGGERED is only meaningful once the run has SETTLED. On a freshly pushed head the rollup is
// empty because CI has not started -- and reading that as "these lanes will never run" is the exact
// cry-wolf failure this tool exists to avoid. It did precisely that on its own first use.
//
// So there are three answers, not two, and "not yet" is one of them.
if (checks.length === 0) {
  console.log("NOT SETTLED — no checks have appeared for this head yet. CI has not started.");
  console.log("Trigger coverage cannot be assessed until the run settles. This is not a pass and not a failure.");
  process.exitCode = 2;
} else if (byState.PENDING.length > 0) {
  console.log(`NOT SETTLED — ${byState.PENDING.length} check(s) still running.`);
  console.log("A lane absent now may simply not have started. Re-run once 0 are pending.");
  if (byState.FAIL.length > 0) {
    console.log("\nAlready FAILING (settled regardless of the rest):");
    for (const n of byState.FAIL) console.log(`  ${n}`);
  }
  process.exitCode = 2;
} else {
  reportSettled();
}

function reportSettled() {
const notTriggered = expected.filter((e) => !e.present);
console.log(`workflows whose path filter matches a changed file: ${expected.length}`);
console.log(`  of those, present in the rollup: ${expected.length - notTriggered.length}`);
console.log(`  NOT TRIGGERED: ${notTriggered.length}`);

if (byState.FAIL.length > 0) {
  console.log("\nFAIL:");
  for (const n of byState.FAIL) console.log(`  ${n}`);
}
if (byState.PENDING.length > 0) {
  console.log("\nPENDING:");
  for (const n of byState.PENDING) console.log(`  ${n}`);
}
if (notTriggered.length > 0) {
  console.log("\nNOT TRIGGERED — these watch a path this PR changed but did not run:");
  for (const e of notTriggered) console.log(`  ${e.workflowName}  (${e.file})  e.g. ${e.matched[0]}`);
  console.log("\nA lane that did not run is an UNKNOWN, not a pass (DECISIONS #144).");
}

const clean = byState.FAIL.length === 0 && notTriggered.length === 0;
console.log(`\n${clean ? "CLEAN: every matching lane ran, and none failed." : "NOT CLEAN — see above."}`);
process.exitCode = clean ? 0 : 1;
}

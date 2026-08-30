// CI TRIGGER COVERAGE — the pure logic (DECISIONS #144).
//
// Split out from ciTriggerCoverage.mjs so it can be tested without shelling out to git and gh. The
// CLI keeps the I/O; every decision that can be wrong lives here.
//
// It earned tests the hard way. Four defects in its first hour, each one a false alarm, and a
// checker that cries wolf is worse than no checker:
//
//   1. glob fallback "prefix of the first star" -- `functions/test/**Rules*.test.js` matched every
//      file under functions/test, flagging the Rules lane on a PR that never touched Rules
//   2. job names read only from `name:`, missing `gitleaks:` and `build:` which appear under bare
//      job keys, so two lanes that plainly ran were reported as never having run
//   3. workflows with no `pull_request` trigger treated as watching everything, so three
//      issue-driven workflows were reported as missing from a PR they can never appear in
//   4. an empty rollup read as "will never run" when it actually meant "has not started" -- the
//      tool committing, against itself, the exact error it exists to catch

/**
 * Glob -> RegExp. `**` crosses directory separators, `*` does not.
 *
 * Translated properly rather than pattern-matched on a few known shapes, which is what produced
 * defect 1.
 */
export function globToRegExp(glob) {
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

export function globMatches(glob, file) {
  return glob === file || globToRegExp(glob).test(file);
}

/** The `paths:` globs a workflow watches, or null when it declares no path filter. */
export function workflowPaths(source) {
  const globs = [];
  let inPaths = false;
  let hasTriggerBlock = false;
  for (const line of source.split(/\r?\n/)) {
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

/** Only a workflow with a `pull_request` trigger can appear in a PR's check rollup (defect 3). */
export function runsOnPullRequest(source) {
  return /^\s*pull_request(_target)?:/m.test(source);
}

/**
 * The names a workflow's jobs appear under in the rollup: the job KEY, plus any explicit `name:`
 * (defect 2).
 */
export function jobNames(source) {
  // Anchored to start-of-LINE, not to a preceding newline. Searching for "\njobs:" silently
  // returned nothing when the block began at position 0 -- found by the test below, which is the
  // fifth defect this file has had and the first one caught before it could produce a false alarm.
  const m = /^jobs:\s*$/m.exec(source);
  const block = m ? source.slice(m.index) : "";
  return [
    ...[...block.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]),
    ...[...block.matchAll(/^\s{4}name:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^["']|["']$/g, "")),
  ];
}

/** How a settled/unsettled rollup is bucketed. */
export function bucketChecks(checks) {
  const out = { PASS: [], FAIL: [], PENDING: [] };
  for (const c of checks) {
    const state = c.conclusion ?? c.status;
    if (state === "SUCCESS" || state === "NEUTRAL" || state === "SKIPPED") out.PASS.push(c.name);
    else if (state === "FAILURE" || state === "CANCELLED" || state === "TIMED_OUT") out.FAIL.push(c.name);
    else out.PENDING.push(c.name);
  }
  return out;
}

/**
 * The verdict. FOUR outcomes, because collapsing any two of them is how this tool lied:
 *
 *   NO_MATCHING_LANE  nothing in the diff is watched. An empty rollup is CORRECT.
 *   NOT_SETTLED       lanes are expected but have not appeared, or are still running.
 *   NOT_CLEAN         settled, and something failed or a watched lane never ran.
 *   CLEAN             settled, every matching lane ran, none failed.
 */
export function verdict({ checks, expected, mergeable }) {
  const buckets = bucketChecks(checks);
  // A CONFLICTING PR cannot produce checks at all: GitHub builds no merge commit, so no
  // `pull_request` run is created -- not even for lanes with no path filter. This is what actually
  // stranded PR #1619, and the tool sat on NOT_SETTLED waiting for runs that could never arrive.
  // Reporting "not started" for a state that will never change is the same lie in a new costume.
  if (mergeable === "CONFLICTING" && checks.length === 0) return { state: "CONFLICTED", buckets };
  if (checks.length === 0 && expected.length === 0) return { state: "NO_MATCHING_LANE", buckets };
  if (checks.length === 0) return { state: "NOT_SETTLED", buckets };
  if (buckets.PENDING.length > 0) return { state: "NOT_SETTLED", buckets };
  const notTriggered = expected.filter((e) => !e.present);
  if (buckets.FAIL.length > 0 || notTriggered.length > 0) return { state: "NOT_CLEAN", buckets, notTriggered };
  return { state: "CLEAN", buckets, notTriggered: [] };
}

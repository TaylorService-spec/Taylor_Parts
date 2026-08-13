// Hardened, LOCALLY-TESTABLE landing of an intake execution's artifacts onto main.
//
// Why this exists: the execute write-back was fragile shared-runner infra debugged in a ~1-hour loop. Two live
// failures — a 30-min timeout that lost a whole multi-child pass (end-of-loop batch commit never reached), and a
// bare `git push` that failed because a PATCH_PRODUCER item left the shared working tree on a stray branch — both
// stranded completed work. This module moves the git sequence + its guards into code that is unit-tested with an
// injected git runner, so the class of bug is caught in `node --test`, not on the self-hosted runner.
//
// Two hardening properties, by construction:
//   • PER-ITEM + PER-REQUEST ISOLATION — only THIS requestId's work-intake paths are ever staged. A PATCH item's
//     code changes can never enter the write-back, and each finished item lands the moment it completes, so an
//     interruption preserves everything already landed (no all-or-nothing).
//   • BRANCH-ROBUST — the artifact-only commit is replayed onto a freshly-reset origin/main via cherry-pick and
//     pushed with `push origin HEAD:main`, independent of whatever branch the runner was left on, and retried as
//     main moves. A bare `git push` (which assumes an upstream) is never used.

import { spawnSync } from "node:child_process";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;

/** The exact, deterministic set of work-intake paths a single intake execution may write — and NOTHING else. */
export function artifactPathsFor(requestId) {
  if (!SAFE_ID.test(requestId || "")) throw new Error("artifactPathsFor: invalid requestId");
  return [
    `docs/orchestration/work-intake/status/${requestId}.status.json`,
    `docs/orchestration/work-intake/results/${requestId}`,
    `docs/orchestration/work-intake/review-ready/${requestId}.json`,
  ];
}

/** Real git runner: shells to git, returns {code, stdout, stderr}. Injected in tests. */
export function makeGitRunner({ cwd } = {}) {
  return (args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    return { code: typeof r.status === "number" ? r.status : 1, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
}

// Work-intake artifact roots — the ONLY paths any landing may stage. A final full-sweep uses these to catch
// status refreshes for items the execute loop didn't run (e.g. intake-ingest-ci's status derivation), without
// ever reaching outside work-intake/.
const ARTIFACT_ROOTS = Object.freeze([
  "docs/orchestration/work-intake/status",
  "docs/orchestration/work-intake/results",
  "docs/orchestration/work-intake/review-ready",
]);

/**
 * Shared landing CORE: assumes the caller has already `git add`-ed exactly the intended (work-intake-only) paths.
 * Commits the staged changes as an artifact-only commit, then replays that commit onto a fresh origin/main via
 * cherry-pick and pushes HEAD:main, retrying as main moves or a cherry-pick races. Never throws for a transient
 * push/cherry-pick failure — returns a result so an orchestrator can keep going. `label` is only for the result.
 * @returns {{label, landed:boolean, attempts:number, reason?:string, commit?:string}}
 */
export function landStaged({ runGit, message, label = "write-back", maxAttempts = 5 } = {}) {
  if (typeof runGit !== "function") throw new Error("landStaged: runGit is required");
  // `diff --cached --quiet` exits 0 when nothing is staged, 1 when there are staged changes.
  if (runGit(["diff", "--cached", "--quiet"]).code === 0) {
    return Object.freeze({ label, landed: false, attempts: 0, reason: "no-changes" });
  }
  if (runGit(["commit", "-m", message]).code !== 0) throw new Error(`landStaged: commit failed for ${label}`);
  const wb = runGit(["rev-parse", "HEAD"]).stdout.trim();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (runGit(["fetch", "origin", "main"]).code !== 0) continue;      // transient network → retry
    runGit(["checkout", "-f", "-B", "eos-writeback", "FETCH_HEAD"]);   // clean main, discard any stray-branch state
    runGit(["reset", "--hard", "FETCH_HEAD"]);
    if (runGit(["cherry-pick", wb]).code !== 0) { runGit(["cherry-pick", "--abort"]); continue; } // race → re-sync
    if (runGit(["push", "origin", "HEAD:main"]).code === 0) {
      return Object.freeze({ label, landed: true, attempts: attempt, commit: wb });
    }
    // push rejected (main moved) → loop: fetch latest, re-replay, push again
  }
  return Object.freeze({ label, landed: false, attempts: maxAttempts, reason: "push-failed", commit: wb });
}

/**
 * Land exactly ONE intake execution's artifacts onto main — durable per-item write-back. Stages ONLY that
 * requestId's work-intake paths (the whole isolation guarantee: a PATCH item's code can never enter), then
 * delegates to the shared core. Called immediately after each item's execution so completed work lands the
 * moment it finishes, surviving any later timeout/interruption.
 */
export function landItemArtifacts({ requestId, runGit, maxAttempts = 5, message } = {}) {
  if (!SAFE_ID.test(requestId || "")) throw new Error("landItemArtifacts: invalid requestId");
  if (typeof runGit !== "function") throw new Error("landItemArtifacts: runGit is required");
  runGit(["add", "--", ...artifactPathsFor(requestId)]);
  const out = landStaged({ runGit, label: requestId, maxAttempts, message: message || `eos: intake execution result write-back for ${requestId} [skip ci]` });
  return Object.freeze({ requestId, landed: out.landed, attempts: out.attempts, ...(out.reason ? { reason: out.reason } : {}), ...(out.commit ? { commit: out.commit } : {}) });
}

/**
 * Final full-sweep: land ANY remaining work-intake changes (e.g. status refreshes for items the loop skipped).
 * Stages the whole work-intake artifact roots — still never anything outside them — and lands them. A no-op when
 * per-item landing already committed everything.
 */
export function landAllArtifacts({ runGit, maxAttempts = 5 } = {}) {
  if (typeof runGit !== "function") throw new Error("landAllArtifacts: runGit is required");
  runGit(["add", "--", ...ARTIFACT_ROOTS]);
  return landStaged({ runGit, label: "sweep", maxAttempts, message: "eos: intake status/result write-back sweep [skip ci]" });
}

// CLI:
//   node intake-landing.mjs --id <requestId>   → durable per-item land (after that item's execution)
//   node intake-landing.mjs --sweep            → final full-sweep for any remaining work-intake changes
// The execute workflow calls --id per item, then --sweep once at the end.
function main() {
  const runGit = makeGitRunner();
  if (process.argv.includes("--sweep")) {
    const out = landAllArtifacts({ runGit });
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(out.landed || out.reason === "no-changes" ? 0 : 1);
  }
  const i = process.argv.indexOf("--id");
  const requestId = i !== -1 ? process.argv[i + 1] : null;
  if (!requestId) { process.stderr.write("usage: intake-landing.mjs (--id <requestId> | --sweep)\n"); process.exit(2); }
  const out = landItemArtifacts({ requestId, runGit });
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(out.landed || out.reason === "no-changes" ? 0 : 1);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

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
import { existsSync } from "node:fs";

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

  // Defense-in-depth: the committed diff MUST touch only work-intake paths. A PATCH_PRODUCER worker in the shared
  // job can stage a code/workflow change into the shared index, and a plain `git commit` would sweep it into the
  // write-back — which then either leaks to main or (for a .github/workflows/* file) is rejected outright because
  // GITHUB_TOKEN lacks `workflows` permission. If anything outside work-intake/ slipped in, refuse to push and
  // fail closed rather than carrying it to main. (The unstage-before-stage in the callers prevents this; this is
  // the belt-and-suspenders that guarantees it can never happen.)
  const touched = runGit(["show", "--name-only", "--format=", wb]).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const outside = touched.filter((p) => !p.startsWith("docs/orchestration/work-intake/"));
  if (outside.length) throw new Error(`landStaged: refusing to push non-artifact paths (${label}): ${outside.join(", ")}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (runGit(["fetch", "origin", "main"]).code !== 0) continue;      // transient network → retry
    // Getting onto clean main must SUCCEED before we replay — a failed checkout/reset leaves the runner on
    // unknown branch state, and cherry-picking there could land the artifact on the wrong base. Fail the attempt
    // and re-sync rather than proceeding blindly.
    if (runGit(["checkout", "-f", "-B", "eos-writeback", "FETCH_HEAD"]).code !== 0) continue;
    if (runGit(["reset", "--hard", "FETCH_HEAD"]).code !== 0) continue;
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
export function landItemArtifacts({ requestId, runGit, pathExists = existsSync, maxAttempts = 5, message } = {}) {
  if (!SAFE_ID.test(requestId || "")) throw new Error("landItemArtifacts: invalid requestId");
  if (typeof runGit !== "function") throw new Error("landItemArtifacts: runGit is required");
  // Only SOME request-scoped paths exist for a given disposition: a non-COMPLETE item (e.g. BLOCKED) writes a
  // status but NO result/review-ready. `git add` of an absent pathspec errors and stages nothing, which — if its
  // exit code were ignored — a later `diff --cached --quiet` would read as "no-changes" and FALSELY land nothing
  // while reporting success, stranding the truthful status. So: stage only the paths that actually exist, and if
  // the add still errors, FAIL CLOSED (never fall through to no-changes).
  // A just-executed eligible intake MUST have produced at least a truthful status artifact. Zero request-scoped
  // artifacts means execution emitted nothing (bug / path drift / write failure) — that is NOT a benign no-op, it
  // would silently lose the item's disposition while reporting success. Fail closed. (An idempotent re-run where
  // the status exists but is unchanged is handled downstream as no-changes, which IS a valid success.)
  const present = artifactPathsFor(requestId).filter((p) => pathExists(p));
  if (present.length === 0) throw new Error(`landItemArtifacts: no status/result/review-ready exists for ${requestId} — refusing to report success (fail closed)`);
  // Unstage EVERYTHING first: a PATCH_PRODUCER worker earlier in the shared job may have `git add`-ed its own
  // code/workflow changes, and a later `git commit` would include them. Clearing the index guarantees the commit
  // carries only the paths we stage next — so a failure to clear it must also fail closed, not proceed from a
  // possibly-contaminated index.
  if (runGit(["reset", "-q", "HEAD"]).code !== 0) throw new Error(`landItemArtifacts: failed to clear the index before staging ${requestId} (fail closed)`);
  if (runGit(["add", "--", ...present]).code !== 0) throw new Error(`landItemArtifacts: git add failed for ${requestId}`);
  const out = landStaged({ runGit, label: requestId, maxAttempts, message: message || `eos: intake execution result write-back for ${requestId} [skip ci]` });
  return Object.freeze({ requestId, landed: out.landed, attempts: out.attempts, ...(out.reason ? { reason: out.reason } : {}), ...(out.commit ? { commit: out.commit } : {}) });
}

/**
 * Final full-sweep: land ANY remaining work-intake changes (e.g. status refreshes for items the loop skipped).
 * Stages the whole work-intake artifact roots — still never anything outside them — and lands them. A no-op when
 * per-item landing already committed everything.
 */
export function landAllArtifacts({ runGit, pathExists = existsSync, maxAttempts = 5 } = {}) {
  if (typeof runGit !== "function") throw new Error("landAllArtifacts: runGit is required");
  // Same fail-closed staging: a root that doesn't exist is filtered out (not an add error masked as no-changes);
  // a genuine add error still fails closed.
  // Sweep no-artifacts IS benign (the roots legitimately may not exist / nothing left to land) — the per-item
  // landing already carries the mandatory-status guarantee; the sweep only mops up leftovers.
  const present = ARTIFACT_ROOTS.filter((p) => pathExists(p));
  if (present.length === 0) return Object.freeze({ label: "sweep", landed: false, attempts: 0, reason: "no-artifacts" });
  if (runGit(["reset", "-q", "HEAD"]).code !== 0) throw new Error("landAllArtifacts: failed to clear the index before staging (fail closed)");
  if (runGit(["add", "--", ...present]).code !== 0) throw new Error("landAllArtifacts: git add failed");
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
    process.exit(out.landed || out.reason === "no-changes" || out.reason === "no-artifacts" ? 0 : 1);
  }
  const i = process.argv.indexOf("--id");
  const requestId = i !== -1 ? process.argv[i + 1] : null;
  if (!requestId) { process.stderr.write("usage: intake-landing.mjs (--id <requestId> | --sweep)\n"); process.exit(2); }
  // landItemArtifacts throws (→ nonzero exit) if the item produced no artifacts; a clean disposition is either
  // landed or an idempotent no-changes. There is no benign no-artifacts for a single executed item.
  const out = landItemArtifacts({ requestId, runGit });
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(out.landed || out.reason === "no-changes" ? 0 : 1);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

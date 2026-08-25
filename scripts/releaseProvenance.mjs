// RELEASE PROVENANCE — is THIS commit allowed to become a deployed sandbox release?
//
// ════════════════════ WHAT WENT WRONG ════════════════════
//
// platform-sandbox was deployed from 3aed0c0c, the head of an unmerged feature branch. The later
// squash-merge (1373eff2) produced a byte-identical tree, so the CONTENT that shipped was exactly
// what review approved — and that is the trap. "The tree is identical" is a statement about this
// one lucky occasion, not about the process. The same sequence with one extra commit on the branch,
// or a rebase, or a review change requested after the deploy, ships something main never contained
// and nothing would have said so.
//
// _sandboxDeployGuard.mjs already proves WHERE the release is going (sandbox, never production).
// Nothing proved WHAT it was built from. That is the gap this closes.
//
// ════════════════════ THE INVARIANT ════════════════════
//
// For the normal refresh path: HEAD must BE the release branch's current commit — merged main.
//
// Not "an ancestor of main", which would permit shipping a commit main has already moved past, and
// not "content matches", which is the excuse this guard exists to refuse. An explicitly authored
// manifest may name an older commit for a deliberate re-deploy or rollback; nothing else may.
//
// ════════════════════ WORKTREES ARE LEGITIMATE ════════════════════
//
// This repository is worked in several worktrees at once, and `main` is frequently checked out in
// one of them. So the guard NEVER assumes one physical checkout and never runs `git checkout`. It
// asks what THIS working copy is on, by branch name and commit, and compares that to the remote
// release ref. A release run from a worktree whose HEAD is the current main is perfectly valid.
import { execFileSync } from "node:child_process";

export const DEFAULT_RELEASE_BRANCH = "main";

/** Narrow shell surface: read-only plumbing only, never a command that can move a ref. */
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Everything the decision needs, gathered in one place so the RULE below is pure and testable.
 * A caller may supply this itself (the tests do) instead of touching a repository.
 */
export function readRepoState(cwd = process.cwd()) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const head = git(["rev-parse", "HEAD"], cwd);
  // --porcelain is empty exactly when the tree is clean. Untracked scratch files DO count: a release
  // built from a tree containing unknown files is a release nobody can reproduce.
  const dirty = git(["status", "--porcelain"], cwd);
  let remoteHead = null;
  try { remoteHead = git(["rev-parse", `origin/${DEFAULT_RELEASE_BRANCH}`], cwd); } catch { remoteHead = null; }
  let mergedIntoRelease = false;
  try {
    git(["merge-base", "--is-ancestor", head, `origin/${DEFAULT_RELEASE_BRANCH}`], cwd);
    mergedIntoRelease = true;
  } catch { mergedIntoRelease = false; }
  return { branch, head, remoteHead, dirty, mergedIntoRelease };
}

export const PROVENANCE_FAILURE = Object.freeze({
  NOT_RELEASE_BRANCH: "NOT_RELEASE_BRANCH",
  UNMERGED_COMMIT: "UNMERGED_COMMIT",
  BEHIND_RELEASE: "BEHIND_RELEASE",
  DIRTY_WORKTREE: "DIRTY_WORKTREE",
  NO_REMOTE_RELEASE: "NO_REMOTE_RELEASE",
});

/**
 * THE RULE. Pure: takes a state, returns a verdict. No git, no filesystem, no exit codes.
 *
 * @param state              from readRepoState
 * @param opts.releaseBranch the approved release branch
 * @param opts.allowCommit   an explicitly authored exception (a deliberate re-deploy or rollback).
 *                           It must still be a commit that is MERGED — an exception permits an older
 *                           release, never an unreviewed one.
 */
export function evaluateReleaseProvenance(state, { releaseBranch = DEFAULT_RELEASE_BRANCH, allowCommit = null } = {}) {
  const failures = [];
  const detail = [];

  if (state.dirty && state.dirty.length > 0) {
    failures.push(PROVENANCE_FAILURE.DIRTY_WORKTREE);
    detail.push(`the working tree has uncommitted or untracked changes:\n${state.dirty.split("\n").slice(0, 8).join("\n")}`);
  }

  if (!state.remoteHead) {
    failures.push(PROVENANCE_FAILURE.NO_REMOTE_RELEASE);
    detail.push(`origin/${releaseBranch} could not be resolved — fetch before releasing`);
  }

  // THE CENTRAL CHECK, and the one the byte-identical branch head must fail.
  if (!state.mergedIntoRelease) {
    failures.push(PROVENANCE_FAILURE.UNMERGED_COMMIT);
    detail.push(
      `HEAD ${state.head?.slice(0, 8)} is not contained in origin/${releaseBranch}. ` +
        "A tree identical to main is NOT provenance: merge first, then release what merged.",
    );
  } else if (state.remoteHead && state.head !== state.remoteHead) {
    // Merged, but not the tip. Permitted only when explicitly named.
    if (allowCommit && (allowCommit === state.head || state.head.startsWith(allowCommit))) {
      detail.push(`HEAD ${state.head.slice(0, 8)} is behind origin/${releaseBranch} but explicitly authorized`);
    } else {
      failures.push(PROVENANCE_FAILURE.BEHIND_RELEASE);
      detail.push(
        `HEAD ${state.head.slice(0, 8)} is merged but is not the tip of origin/${releaseBranch} ` +
          `(${state.remoteHead.slice(0, 8)}). Pass --allow-commit to release an older commit deliberately.`,
      );
    }
  }

  // Branch NAME is advisory, not the control: a worktree may sit on a detached HEAD at the exact
  // release commit, which is a legitimate way to build a release. The commit identity above is what
  // decides; this only reports.
  if (state.branch && state.branch !== releaseBranch && state.branch !== "HEAD") {
    detail.push(`(note: on branch '${state.branch}', not '${releaseBranch}' — allowed while the COMMIT is the release commit)`);
  }

  return { ok: failures.length === 0, failures, detail };
}

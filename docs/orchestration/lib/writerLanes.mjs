// Writer-lane isolation — the orchestration state that makes parallel agents safe.
//
// THE INCIDENT THIS EXISTS FOR. Two write-capable agents and the controller all operated
// in one checkout. One agent switched the branch mid-commit, the controller's commit
// landed on that agent's branch, a remote branch was created with contaminated ancestry,
// and an agent then asked the controller to force-push over it. Nothing was lost, but only
// because the collision happened to be noticed.
//
// The rule is one writer, one worktree, one branch, one task lane. This module is that
// rule expressed as checkable state rather than as a paragraph somebody has to remember:
// a lane that shares a worktree, shares a branch, or has no worktree at all is a
// validation failure before an agent is ever dispatched.
//
// NOT A NEW FRAMEWORK. Lanes attach to metadata-program ledger entries by task id. The
// ledger already answers "what work exists and what state is it in"; this answers "who
// owns the checkout it is being done in", which is the question the incident proved was
// unanswerable.
//
// WHAT TOOLING CANNOT DO. It cannot prove a dependency assumption was sound, that a diff
// matches intent, or that a worker's summary is honest. Controller inspection stays
// mandatory (§7); these checks only catch the mechanical failures that are detectable.

export const LANE_STATUS = Object.freeze([
  "ASSIGNED",   // owner and worktree recorded, no commits yet
  "WORKING",    // agent is writing
  "PUSHED",     // branch pushed, no PR yet
  "PR_OPEN",    // PR verified to exist against the owned branch
  "MERGED",     // landed
  "ABANDONED",  // lane closed without merging; requires a reason
]);

/** Read-only lanes may share a checkout, because they mutate nothing. */
export const LANE_KIND = Object.freeze(["WRITER", "SCOUT"]);

export function makeLane(input = {}) {
  return Object.freeze({
    taskId: input.taskId,
    kind: input.kind ?? "WRITER",
    branch: input.branch ?? null,
    worktree: input.worktree ?? null,
    baseSha: input.baseSha ?? null,
    owner: input.owner ?? null,
    status: input.status ?? "ASSIGNED",
    pr: input.pr ?? null,
    headSha: input.headSha ?? null,
    // Recovery is recorded, never hidden inside a normal completion summary (§8).
    recoveryEvents: Object.freeze([...(input.recoveryEvents ?? [])]),
    abandonedReason: input.abandonedReason ?? null,
  });
}

const problem = (code, message) => Object.freeze({ code, message });

/**
 * Validate one lane.
 *
 * A WRITER without a worktree is the precise condition that caused the incident, so it is
 * an error rather than a warning: the dispatch is what has to fail, not the recovery.
 */
export function validateLane(lane) {
  const problems = [];
  const at = `lane ${lane?.taskId ?? "(unnamed)"}`;

  if (!lane?.taskId) problems.push(problem("NO_TASK", `${at}: a lane must name the task it owns`));
  if (!LANE_KIND.includes(lane?.kind)) problems.push(problem("BAD_KIND", `${at}: kind "${lane?.kind}" is not known`));
  if (!LANE_STATUS.includes(lane?.status)) problems.push(problem("BAD_STATUS", `${at}: status "${lane?.status}" is not known`));

  if (lane?.kind === "WRITER") {
    if (!lane.worktree) {
      problems.push(problem("NO_WORKTREE", `${at}: a WRITER must own an isolated worktree — sharing the controller's checkout is what causes cross-lane contamination`));
    }
    if (!lane.branch) problems.push(problem("NO_BRANCH", `${at}: a WRITER must own a branch`));
    if (!lane.baseSha) {
      // An unrecorded base makes "did unrelated commits appear?" unanswerable after the
      // fact, which is exactly the check the controller has to perform.
      problems.push(problem("NO_BASE", `${at}: a WRITER must record the base SHA it was dispatched from`));
    }
    if (!lane.owner) problems.push(problem("NO_OWNER", `${at}: a WRITER must name its owning agent — a lane with no owner has no accountable writer`));
  }

  // A PR is state only once GitHub confirms it. A number recorded from a failed command is
  // the specific failure that put a phantom PR in this ledger once already.
  if (lane?.status === "PR_OPEN" && !lane.pr) {
    problems.push(problem("PR_UNVERIFIED", `${at}: PR_OPEN requires the verified PR number`));
  }
  if (lane?.status === "PR_OPEN" && !lane.headSha) {
    problems.push(problem("NO_HEAD", `${at}: PR_OPEN requires the head SHA the PR was verified against`));
  }
  if (lane?.status === "ABANDONED" && !lane.abandonedReason) {
    problems.push(problem("NO_REASON", `${at}: an abandoned lane requires a reason — an unexplained abandonment hides whether work was preserved`));
  }
  return Object.freeze(problems);
}

/** Lanes that can still be written to. A merged or abandoned lane owns nothing. */
const isActive = (lane) => !["MERGED", "ABANDONED"].includes(lane?.status);

/**
 * Validate the whole set.
 *
 * The collision checks apply to ACTIVE lanes only: two merged lanes may share a branch
 * name historically without anyone being at risk, and treating that as a conflict would
 * make the check noisy enough to ignore.
 */
export function validateLaneSet(lanes = []) {
  const problems = [];
  for (const lane of lanes) problems.push(...validateLane(lane));

  const active = lanes.filter(isActive);

  const byWorktree = new Map();
  const byBranch = new Map();
  const byTask = new Map();

  for (const lane of active) {
    if (lane.kind === "WRITER" && lane.worktree) {
      const other = byWorktree.get(lane.worktree);
      if (other) {
        problems.push(problem("SHARED_WORKTREE", `lanes ${other} and ${lane.taskId} both own worktree ${lane.worktree} — two writers in one checkout is the collision condition itself`));
      }
      byWorktree.set(lane.worktree, lane.taskId);
    }
    if (lane.branch) {
      const other = byBranch.get(lane.branch);
      if (other) {
        problems.push(problem("SHARED_BRANCH", `lanes ${other} and ${lane.taskId} both own branch ${lane.branch} — a branch has exactly one owning lane at a time`));
      }
      byBranch.set(lane.branch, lane.taskId);
    }
    const prior = byTask.get(lane.taskId);
    if (prior) problems.push(problem("DUPLICATE_TASK", `task ${lane.taskId} has more than one active lane`));
    byTask.set(lane.taskId, lane.taskId);
  }
  return Object.freeze(problems);
}

/**
 * Compare recorded lanes against what GitHub actually reports.
 *
 * `observed` is { pr: { headRef, headSha, baseRef } }, read from GitHub by the caller.
 * The controller must not accept a worker's word for branch integrity (§7), and this is
 * the mechanical half of that: a recorded PR whose head does not match the owned branch
 * means the PR was opened from somewhere else.
 */
export function reconcileLanes(lanes = [], observed = {}) {
  const disagreements = [];
  for (const lane of lanes) {
    if (!lane.pr) continue;
    const seen = observed[lane.pr];
    if (!seen) {
      disagreements.push(problem("PR_NOT_FOUND", `lane ${lane.taskId}: PR #${lane.pr} was recorded but GitHub does not report it`));
      continue;
    }
    if (lane.branch && seen.headRef && seen.headRef !== lane.branch) {
      disagreements.push(problem("PR_WRONG_BRANCH", `lane ${lane.taskId}: PR #${lane.pr} head is ${seen.headRef}, not the owned branch ${lane.branch}`));
    }
    if (lane.headSha && seen.headSha && seen.headSha !== lane.headSha) {
      disagreements.push(problem("PR_MOVED", `lane ${lane.taskId}: PR #${lane.pr} head is ${seen.headSha.slice(0, 8)}, recorded ${lane.headSha.slice(0, 8)}`));
    }
  }
  return Object.freeze(disagreements);
}

/**
 * Destructive git actions a worker may never decide on its own.
 *
 * Exported as data so a dispatch prompt and a review check can reference ONE list. "An
 * agent asked me to" is never authority: a subagent may recommend, and the controller
 * decides.
 */
export const CONTROLLER_ONLY_ACTIONS = Object.freeze([
  "force-push",
  "hard-reset",
  "destructive-rebase",
  "delete-branch-with-unmerged-work",
  "remove-worktree-with-uncommitted-work",
  "overwrite-remote-branch",
  "history-rewrite",
]);

export function isControllerOnly(action) {
  return CONTROLLER_ONLY_ACTIONS.includes(action);
}

/**
 * The preferred recovery order, as data rather than prose.
 *
 * The ordering is the substance: preservation precedes cleanup, and a clean new branch is
 * tried before any history rewrite. Contamination is not solved by destroying the
 * evidence of it.
 */
export const RECOVERY_ORDER = Object.freeze([
  "inspect",
  "preserve",
  "fresh-branch-or-worktree",
  "cherry-pick-verified-commits",
  "diff-against-intended-scope",
  "run-tests",
  "abandon-contaminated-lane",
]);

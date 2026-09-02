// GOAL PROGRESS -- pairing a governed TARGET with a governed ACTUAL for display.
//
// This module is the client half of the one invariant the Performance Goal Authority exists to keep:
//
//     DOMAIN AUTHORITY OWNS THE ACTUAL.
//     PERFORMANCE GOAL AUTHORITY OWNS THE TARGET.
//     THE DASHBOARD COMPARES THEM.
//
// It receives both, already computed by their own authorities, and decides only how the PAIR reads.
// It does not fetch, derive, sum, or estimate either half -- if this file ever grows a query, the
// invariant has been broken and the dashboard has become a second implementation of domain logic.
//
// ============================ WHY THE STATES ARE NOT ONE EMPTY ============================
//
// Four different things can leave a goal tile without a number, and a reader must be able to tell
// them apart because each implies a different next action:
//
//   NO_GOAL     nobody has set a target. The gap is a management act, and saying so invites it.
//   DENIED      the target is outside this viewer's governed reach. A permission fact, not an error.
//   NO_ACTUAL   the target exists and the MEASUREMENT does not -- the honest shape of "we know what
//               you should do and cannot yet tell you how you did". Names its blocker.
//   UNRESOLVED  a target exists but its version chain is contradictory. A data defect, and showing
//               "no goal" here would hide it behind a state that looks deliberate.
//
// Collapsing any two of these is how "you may not see this" becomes "there isn't one".

export const GOAL_PROGRESS_STATE = Object.freeze({
  READY: "READY",
  NO_GOAL: "NO_GOAL",
  DENIED: "DENIED",
  NO_ACTUAL: "NO_ACTUAL",
  UNRESOLVED: "UNRESOLVED",
});

/**
 * UNKNOWN IS NOT A NUMBER, and this is the gate that keeps it from becoming one.
 *
 * A domain read may legitimately answer "unknown" -- an ATP over a part with an unknown on-hand, a
 * technician with no recorded working schedule. Those arrive here as null/undefined/NaN, and every
 * one resolves to NO_ACTUAL rather than to zero. The subtraction that would produce "you are 100%
 * below target" from an unknown is not reachable from this function.
 */
function isRealNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Compare ONE already-computed actual against ONE goal read.
 *
 * @param goalResult one entry from listCurrentPerformanceGoals -- { goal, denied, unavailableReason }.
 * @param actual     the number the DOMAIN produced, or null/undefined when it could not.
 * @param actualBlocker one sentence naming why the actual is missing, when it is. Shown verbatim.
 */
export function goalProgress(goalResult, actual, actualBlocker = null) {
  if (!goalResult || typeof goalResult !== "object") {
    return { state: GOAL_PROGRESS_STATE.NO_GOAL, goal: null, actual: null };
  }
  if (goalResult.denied === true) {
    return { state: GOAL_PROGRESS_STATE.DENIED, goal: null, actual: null };
  }
  if (typeof goalResult.unavailableReason === "string" && goalResult.unavailableReason.length > 0) {
    return { state: GOAL_PROGRESS_STATE.UNRESOLVED, goal: null, actual: null, reason: goalResult.unavailableReason };
  }

  const goal = goalResult.goal ?? null;
  if (!goal) return { state: GOAL_PROGRESS_STATE.NO_GOAL, goal: null, actual: null };

  if (!isRealNumber(actual)) {
    // The target is real and shown; the actual is not, and says why. Deliberately NOT "0 of 400".
    return {
      state: GOAL_PROGRESS_STATE.NO_ACTUAL,
      goal,
      actual: null,
      reason: actualBlocker ?? "This measurement is not available yet.",
    };
  }

  const met =
    goal.direction === "AT_LEAST" ? actual >= goal.targetValue
      : goal.direction === "AT_MOST" ? actual <= goal.targetValue
        : actual === goal.targetValue;

  // Percent of target -- ONLY for AT_LEAST, where "80% of goal" is the conventional and unambiguous
  // reading, and only when the target is above zero. For AT_MOST there is no number a reader would
  // agree on ("80% attainment" of a past-due target of 5 means what?), and a plausible number is
  // worse than none. This mirrors evaluateGoal() on the server rather than inventing a second rule.
  const attainmentPercent =
    goal.direction === "AT_LEAST" && goal.targetValue > 0
      ? Math.round((actual / goal.targetValue) * 100)
      : null;

  // How much is left. Null where the direction makes "remaining" meaningless, and zero once met --
  // "remaining to goal" on a goal already met is 0, not a negative number dressed as a shortfall.
  const remaining =
    goal.direction === "AT_LEAST" ? Math.max(0, goal.targetValue - actual)
      : goal.direction === "AT_MOST" ? Math.max(0, actual - goal.targetValue)
        : null;

  return {
    state: GOAL_PROGRESS_STATE.READY,
    goal,
    actual,
    met,
    attainmentPercent,
    /** For AT_LEAST this is "still to do"; for AT_MOST it is the OVERAGE. The label must say which. */
    remaining,
    variance: actual - goal.targetValue,
  };
}

/**
 * The bar's fill, 0..100.
 *
 * Clamped at 100 on purpose: a bar that overflows its track to show 140% attainment stops being a
 * bar. The number beside it carries the overshoot, and the number is the thing that is precise.
 * Returns null where there is nothing honest to draw -- an AT_MOST goal has no "progress toward" it,
 * only a threshold it is inside or outside of.
 */
export function goalBarPercent(progress) {
  if (!progress || progress.state !== GOAL_PROGRESS_STATE.READY) return null;
  if (progress.attainmentPercent === null) return null;
  return Math.max(0, Math.min(100, progress.attainmentPercent));
}

/**
 * The tone a goal reads as. Tone is paired with a WORD everywhere it is used -- never colour alone --
 * so this returns a vocabulary term rather than a colour.
 *
 * Note the deliberate absence of a "warning" band. A threshold that turned 80% amber would be
 * inventing a policy nobody set: no repository authority defines what proportion of a target counts
 * as at-risk, and picking one here would make it real by rendering it.
 */
export function goalTone(progress) {
  if (!progress || progress.state !== GOAL_PROGRESS_STATE.READY) return "neutral";
  return progress.met ? "positive" : "attention";
}

// Issue #214 PR-3 -- pure presentation helpers for workflow action confirmation.
// Dependency-free so they are node-importable and unit-tested directly
// (test/workflowActionOrder.test.mjs). NONE of this decides authorization or which
// actions are allowed -- the canonical resolver (getAllowedActions), Firestore
// Rules, and the Cloud Functions remain the sole authorities.

// Actions that WITHDRAW a plan rather than advance the work. Today this is only ND-18's Unschedule,
// which returns a SCHEDULED Work Order to the Ready queue.
//
// It is not destructive — nothing is lost, the job goes back in the queue — so it is not Cancel. But
// it is also not what a dispatcher looking at a scheduled job usually wants next, and it is the first
// action in this system that is neither. Before ND-18 every status offered at most one
// non-destructive action, so "emphasize the first" was a rule that could not be wrong. Now SCHEDULED
// offers Dispatch and Unschedule, and `getAllowedActions` returns them in ACTION_TO_STATUS key order
// — which puts Unschedule first. Emphasizing by position would fill the withdraw button and outline
// the one that moves the job forward.
const WITHDRAWING_ACTIONS = new Set(["Unschedule"]);

// Keep the canonical resolver's list, but present non-destructive actions first, name the ONE that
// should be emphasized, and separate the destructive Cancel. Nothing is added or removed here —
// this is ordering and weighting of the same allowed list, and it decides no authorization.
export function orderWorkflowActions(allowedActions = []) {
  const primary = allowedActions.filter((a) => a !== "Cancel");
  const cancelAllowed = allowedActions.includes("Cancel");
  // The action that advances the lifecycle leads. When every available action withdraws (which no
  // status currently produces), nothing is emphasized rather than something arbitrary being filled.
  const emphasized = primary.find((a) => !WITHDRAWING_ACTIONS.has(a)) ?? null;
  return { primary, cancelAllowed, emphasized };
}

// The ConfirmDialog gate: a confirm may proceed only when a required reason is
// non-blank. A presentation guard only -- a blank required reason must never
// reach the write, and Rules/Functions independently re-enforce it.
export function canConfirm({ requireReason = false, reason = "" } = {}) {
  if (!requireReason) return true;
  return String(reason).trim().length > 0;
}

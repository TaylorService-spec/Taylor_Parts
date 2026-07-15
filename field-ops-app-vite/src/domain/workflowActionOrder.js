// Issue #214 PR-3 -- pure presentation helpers for workflow action confirmation.
// Dependency-free so they are node-importable and unit-tested directly
// (test/workflowActionOrder.test.mjs). NONE of this decides authorization or which
// actions are allowed -- the canonical resolver (getAllowedActions), Firestore
// Rules, and the Cloud Functions remain the sole authorities.

// Keep the canonical resolver's list, but present non-destructive actions first
// and the destructive Cancel separated (never added, never removed here).
export function orderWorkflowActions(allowedActions = []) {
  const primary = allowedActions.filter((a) => a !== "Cancel");
  const cancelAllowed = allowedActions.includes("Cancel");
  return { primary, cancelAllowed };
}

// The ConfirmDialog gate: a confirm may proceed only when a required reason is
// non-blank. A presentation guard only -- a blank required reason must never
// reach the write, and Rules/Functions independently re-enforce it.
export function canConfirm({ requireReason = false, reason = "" } = {}) {
  if (!requireReason) return true;
  return String(reason).trim().length > 0;
}

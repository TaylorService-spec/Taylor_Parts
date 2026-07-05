// Work Order Engine v1.2 -- client-side mirror of
// functions/src/transitionEngine.ts. Intentional defense-in-depth
// duplication (the spec requires enforcement in both the UI layer and
// the Cloud Function) -- no shared/monorepo tooling exists in this repo
// to unify them, so if either file's transition table or permission
// matrix changes, change the other to match.
//
// Has no caller yet in this pass -- Phase 2's action buttons
// (WorkOrderDetail.jsx) will call getAllowedActions() to decide which
// buttons to show/enable. That's expected, not dead code to prune.

// Same linear table as transitionEngine.ts's TRANSITIONS, with
// CANCELLED as an explicit literal entry per non-terminal status rather
// than a special case, and a "MarkReady" action (CREATED ->
// READY_TO_DISPATCH) added to reach the one status the spec's original
// 9 named actions never targeted -- see transitionEngine.ts's header
// comment for how this was found (emulator-based verification, not just
// review).
const WORK_ORDER_TRANSITIONS = {
  CREATED: ["READY_TO_DISPATCH", "CANCELLED"],
  READY_TO_DISPATCH: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["WORK_IN_PROGRESS", "CANCELLED"],
  WORK_IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionWorkOrder(currentStatus, nextStatus) {
  return WORK_ORDER_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

// Exported (was private) so services/workOrderActions.ts's
// resolveTargetState() reuses this exact map instead of redefining it
// a third time (server transitionEngine.ts, this file, and a
// hypothetical third copy) -- see workOrderActions.ts's header comment.
export const ACTION_TO_STATUS = {
  MarkReady: "READY_TO_DISPATCH",
  Schedule: "SCHEDULED",
  Dispatch: "DISPATCHED",
  Accept: "ACCEPTED",
  Travel: "EN_ROUTE",
  Arrive: "ARRIVED",
  WorkStart: "WORK_IN_PROGRESS",
  Complete: "COMPLETED",
  Close: "CLOSED",
  Cancel: "CANCELLED",
};

// Mirrors transitionEngine.ts's ACTION_PERMISSIONS.
const ACTION_PERMISSIONS = {
  MarkReady: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
  Schedule: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
  Dispatch: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
  Close: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
  Cancel: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
  Accept: { roles: ["technician"], requiresOwnAssignment: true },
  Travel: { roles: ["technician"], requiresOwnAssignment: true },
  Arrive: { roles: ["technician"], requiresOwnAssignment: true },
  WorkStart: { roles: ["technician"], requiresOwnAssignment: true },
  Complete: { roles: ["technician"], requiresOwnAssignment: true },
};

// Mirrors transitionEngine.ts's getAllowedActions(status, role, isOwnAssignment).
export function getAllowedActions(status, role, isOwnAssignment) {
  return Object.keys(ACTION_TO_STATUS).filter((action) => {
    const nextStatus = ACTION_TO_STATUS[action];
    if (!canTransitionWorkOrder(status, nextStatus)) return false;

    const permission = ACTION_PERMISSIONS[action];
    if (!role || !permission.roles.includes(role)) return false;
    if (permission.requiresOwnAssignment && !isOwnAssignment) return false;

    return true;
  });
}

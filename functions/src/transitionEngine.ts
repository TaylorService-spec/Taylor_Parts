// Work Order Engine v1.2 -- pure state-machine logic. No Firestore
// access here on purpose -- independently testable without an emulator.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/domain/workOrderWorkflow.js, which the
// UI layer uses for defense-in-depth transition/permission checks
// (disabling invalid actions client-side) alongside this file's
// server-side enforcement. If either file's TRANSITIONS table or
// permission matrix changes, change the other to match.
import type { Role } from "./callerContext";
import type { WorkOrderStatus, ActionName } from "./types/workOrder";

// The spec's linear transition table, with two gaps resolved (found via
// emulator-based verification, not just review -- see the throwaway
// verification script this was caught by):
// 1. CANCELLED added as an explicit literal entry for every non-terminal
//    status (the original spec had no incoming edges to CANCELLED at
//    all).
// 2. A "MarkReady" action added (see ACTION_TO_STATUS/ACTION_PERMISSIONS
//    below) for the CREATED -> READY_TO_DISPATCH transition -- the
//    original spec's permissions matrix named 9 actions (Create/
//    Schedule/Dispatch/Accept/Travel/WorkStart/Complete/Close/Cancel)
//    but none of them targets READY_TO_DISPATCH, making that status
//    unreachable as originally specified. Admin/dispatcher-only, same
//    bucket as Schedule/Dispatch. COMPLETED only goes to CLOSED (not cancellable). CLOSED and
// CANCELLED are terminal (no outgoing transitions). This makes
// canTransition() below a pure table lookup -- the entire state
// machine, cancellation included, is visible in one data structure,
// with no special-case branch to keep in sync with it separately.
// ND-18 (Owner ruling 2026-08-27) -- SCHEDULED -> READY_TO_DISPATCH is the FIRST REVERSE EDGE in
// this table, and it is deliberately the only one. Returning a scheduled job to the Ready queue
// genuinely changes its operational readiness, so un-scheduling belongs in the state machine rather
// than beside it (unlike Reschedule, which only re-times a job and is therefore a separate callable
// that never touches this table -- see ND-19 and scheduling/schedulingCommands.ts).
//
// The edge exists from SCHEDULED and nowhere else. Once a technician has been dispatched the job is
// committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have no way back.
// Any future reverse edge is its own decision and may not appeal to this one.
export const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  CREATED: ["READY_TO_DISPATCH", "CANCELLED"],
  READY_TO_DISPATCH: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["DISPATCHED", "READY_TO_DISPATCH", "CANCELLED"],
  DISPATCHED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["WORK_IN_PROGRESS", "CANCELLED"],
  WORK_IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: ReadonlySet<WorkOrderStatus> = new Set([
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
]);

export function canTransition(current: WorkOrderStatus, next: WorkOrderStatus): boolean {
  return TRANSITIONS[current]?.includes(next) ?? false;
}

// Which status each action produces, and which timestamp field records
// when it happened. Actions (not raw statuses) are the vocabulary
// transitionWorkOrder() accepts, so a client can never smuggle an
// arbitrary transition by naming a status directly -- it must name an
// action, and the server resolves the status.
export const ACTION_TO_STATUS: Record<ActionName, WorkOrderStatus> = {
  MarkReady: "READY_TO_DISPATCH",
  Unschedule: "READY_TO_DISPATCH",
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

// Only actions that write a genuine "this happened right now" immutable
// execution timestamp are listed here. "Schedule" is deliberately
// excluded: scheduledStart/scheduledEnd/scheduledTechId are Planning
// (mutable) fields per the spec's WorkOrder interface -- a dispatcher-
// chosen future date/time, not "the instant Schedule was invoked" -- so
// transitionWorkOrder.ts handles Schedule as a special case that writes
// caller-supplied planning fields instead of a serverTimestamp() here.
// "Dispatch" also needs special handling: it's the action that sets
// assignedTechId (who is actually being dispatched), in addition to its
// own dispatchedAt execution timestamp below.
export const ACTION_TIMESTAMP_FIELD: Partial<Record<ActionName, string>> = {
  Dispatch: "dispatchedAt",
  Accept: "acceptedAt",
  Travel: "enRouteAt",
  Arrive: "arrivedAt",
  WorkStart: "workStartedAt",
  Complete: "completedAt",
  Close: "closedAt",
  Cancel: "closedAt", // CANCELLED has no dedicated timestamp field in the spec; reuses closedAt as "when this WO stopped being active"
};

// Permissions matrix (spec, section "PERMISSIONS MATRIX"): who may
// invoke each action, and whether it's restricted to the technician
// assigned to this specific WO (vs. any technician).
interface ActionPermission {
  roles: Role[];
  requiresOwnAssignment: boolean;
}

// ND-18 consequence, and the reason this table has to exist at all.
//
// `canTransition` answers a question about STATUSES, and two different actions may now produce the
// SAME status: MarkReady and Unschedule both target READY_TO_DISPATCH. Without this table, adding
// the reverse edge SCHEDULED -> READY_TO_DISPATCH would silently make `MarkReady` legal from
// SCHEDULED as well -- a second, unaudited, reason-free way to un-schedule a job, created as a side
// effect of allowing the first one.
//
// So: an action listed here is legal ONLY from the statuses named. An action absent from this table
// is unconstrained beyond `canTransition` (its target status is reached by no other action, so the
// edge alone identifies it). This is what makes "Unschedule refuses from DISPATCHED onward" a
// property of the table rather than a check someone has to remember to write.
export const ACTION_ALLOWED_FROM: Partial<Record<ActionName, readonly WorkOrderStatus[]>> = {
  MarkReady: ["CREATED"],
  Unschedule: ["SCHEDULED"],
};

export const ACTION_PERMISSIONS: Record<ActionName, ActionPermission> = {
  MarkReady: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
  // Same role bucket as Schedule/Dispatch, by Owner ruling 2026-08-27: no new capability family is
  // registered for the scheduling commands, because doing so would open a second authorization
  // pattern before there is any demonstrated need for finer separation.
  Unschedule: { roles: ["admin", "dispatcher"], requiresOwnAssignment: false },
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

// Given the WO's current status and the caller's role/ownership, which
// actions are both a valid transition from `status` AND permitted for
// this caller? Used server-side (transitionWorkOrder.ts) to validate a
// requested action, and mirrored client-side
// (workOrderWorkflow.js) to decide which buttons to show/enable in a
// future UI pass (Phase 2) -- has no caller yet in this pass, which is
// expected, not dead code.
export function getAllowedActions(
  status: WorkOrderStatus,
  role: Role | null,
  isOwnAssignment: boolean
): ActionName[] {
  return (Object.keys(ACTION_TO_STATUS) as ActionName[]).filter((action) => {
    const nextStatus = ACTION_TO_STATUS[action];
    if (!canTransition(status, nextStatus)) return false;

    // See ACTION_ALLOWED_FROM: two actions may share a target status, so the edge alone is no longer
    // enough to identify which action is legal here.
    const allowedFrom = ACTION_ALLOWED_FROM[action];
    if (allowedFrom && !allowedFrom.includes(status)) return false;

    const permission = ACTION_PERMISSIONS[action];
    if (!role || !permission.roles.includes(role)) return false;
    if (permission.requiresOwnAssignment && !isOwnAssignment) return false;

    return true;
  });
}

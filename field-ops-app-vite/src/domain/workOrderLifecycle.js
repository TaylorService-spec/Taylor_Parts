import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";

// DEPRECATED for new consumers as of Work Order Engine v1.2 (Epic 1, see
// docs/architecture/ADR-002). Source of truth for Work Order state is
// now fieldops_wos.status (a real, persisted field, written only by the
// createWorkOrder/transitionWorkOrder Cloud Functions) -- not an
// aggregate computed from Jobs.
//
// After W4's one-model reconciliation, exactly ONE jobs-based export
// remains here: computeWorkOrderState(), whose sole consumer is
// domain/timelineBuilder.js (its call site has only a jobs array, no WO
// doc; out of scope for the v1.2 migration). The other jobs-based exports
// (isActiveWorkOrder, isCompletedWorkOrder, explainWorkOrderState) were
// verified zero-consumer and RETIRED in W4. No new code may call
// computeWorkOrderState() -- if timelineBuilder is ever migrated to the
// real model, delete it outright rather than extending it.
//
// New consumers (modules/controlTower/WorkOrderDetail.jsx, ControlTower.jsx)
// use mapWoStatusToLifecycleState()/explainWorkOrder() below instead --
// both are pure MAPS from a real fieldops_wos doc's `status` field, never
// inference from a jobs array.

// Computes a Work Order's aggregate state from its child Jobs.
//
//   - COMPLETED: every job is JOB_STATUS.COMPLETE
//   - IN_PROGRESS: at least one job is JOB_STATUS.IN_PROGRESS
//   - READY: no job is in progress, but at least one is ASSIGNED
//     (a technician is lined up -- work is about to start)
//   - BLOCKED: none of the above -- nothing is assigned or moving
//     (this also covers an empty job list)
export function computeWorkOrderState(jobs) {
  if (jobs.length === 0) return WORK_ORDER_STATE.BLOCKED;

  const allComplete = jobs.every((j) => j.status === JOB_STATUS.COMPLETE);
  if (allComplete) return WORK_ORDER_STATE.COMPLETED;

  const anyInProgress = jobs.some((j) => j.status === JOB_STATUS.IN_PROGRESS);
  if (anyInProgress) return WORK_ORDER_STATE.IN_PROGRESS;

  const anyAssigned = jobs.some((j) => j.status === JOB_STATUS.ASSIGNED);
  if (anyAssigned) return WORK_ORDER_STATE.READY;

  return WORK_ORDER_STATE.BLOCKED;
}

// --- New, map-only exports for Work Order Engine v1.2 consumers ---
// (see the file header above -- these derive purely from a real
// fieldops_wos doc's `status`, never from a jobs array.)

// 11-value WorkOrderStatus (functions/src/types/workOrder.ts /
// field-ops-app-vite/src/types/workOrder.ts) -> legacy 4-value
// WORK_ORDER_STATE, for display compatibility with existing badge
// styling (.wo-ready/.wo-blocked/.wo-in_progress/.wo-completed CSS
// classes). CANCELLED maps to BLOCKED (closest existing visual
// treatment) but is NOT silently indistinguishable from a normal
// blocked WO -- callers must check the separate `isCancelled` flag.
const WO_STATUS_TO_LIFECYCLE_STATE = {
  CREATED: WORK_ORDER_STATE.BLOCKED,
  READY_TO_DISPATCH: WORK_ORDER_STATE.BLOCKED,
  SCHEDULED: WORK_ORDER_STATE.READY,
  DISPATCHED: WORK_ORDER_STATE.READY,
  ACCEPTED: WORK_ORDER_STATE.READY,
  EN_ROUTE: WORK_ORDER_STATE.IN_PROGRESS,
  ARRIVED: WORK_ORDER_STATE.IN_PROGRESS,
  WORK_IN_PROGRESS: WORK_ORDER_STATE.IN_PROGRESS,
  COMPLETED: WORK_ORDER_STATE.COMPLETED,
  CLOSED: WORK_ORDER_STATE.COMPLETED,
  CANCELLED: WORK_ORDER_STATE.BLOCKED,
};

export function mapWoStatusToLifecycleState(woStatus) {
  return {
    state: WO_STATUS_TO_LIFECYCLE_STATE[woStatus] ?? WORK_ORDER_STATE.BLOCKED,
    isCancelled: woStatus === "CANCELLED",
  };
}

// True when `status` is one of the 11 governed fieldops_wos values (as opposed
// to a legacy lowercase JOB_STATUS literal). timelineBuilder.js uses this to
// tell a governed Work Order doc apart from a legacy Job record so it derives
// state from the real status instead of comparing it against JOB_STATUS
// literals it can never equal.
export function isGovernedWorkOrderStatus(status) {
  return Object.prototype.hasOwnProperty.call(WO_STATUS_TO_LIFECYCLE_STATE, status);
}

// Real-doc analog of the retired explainWorkOrderState(jobs) -- same return
// shape ({ state, reasons, metrics }), but derived purely from a
// fieldops_wos doc's own fields, never a jobs array.
export function explainWorkOrder(workOrderDoc) {
  const { state, isCancelled } = mapWoStatusToLifecycleState(workOrderDoc.status);

  // The doc has no history of what status preceded CANCELLED, so this
  // deliberately doesn't guess at one.
  const reasons = isCancelled
    ? ["This Work Order has been cancelled."]
    : [`Status: ${workOrderDoc.status}`];

  return {
    state,
    isCancelled,
    reasons,
    metrics: {
      woNumber: workOrderDoc.woNumber,
      status: workOrderDoc.status,
      priority: workOrderDoc.priority,
    },
  };
}

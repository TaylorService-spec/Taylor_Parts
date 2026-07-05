import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";

// DEPRECATED for new consumers as of Work Order Engine v1.2 (Epic 1, see
// docs/architecture/ADR-002). Source of truth for Work Order state is
// now fieldops_wos.status (a real, persisted field, written only by the
// createWorkOrder/transitionWorkOrder Cloud Functions) -- not an
// aggregate computed from Jobs.
//
// The four exports below (computeWorkOrderState/isActiveWorkOrder/
// isCompletedWorkOrder/explainWorkOrderState) are kept byte-identical
// and FROZEN, serving exactly one remaining consumer:
// domain/timelineBuilder.js, whose call site only has a jobs array (no
// WO doc) to work with and is out of scope for this migration. No new
// code may call these four -- if timelineBuilder.js is ever migrated to
// the real model, delete these four outright rather than extending them
// further.
//
// New consumers (modules/controlTower/WorkOrderDetail.jsx,
// ControlTower.jsx) use mapWoStatusToLifecycleState()/explainWorkOrder()
// below instead -- both are pure MAPS from a real fieldops_wos doc's
// `status` field, never inference from a jobs array.

// Computes a Work Order's aggregate state from its child Jobs.
//
//   - COMPLETED: every job is JOB_STATUS.COMPLETE
//   - IN_PROGRESS: at least one job is JOB_STATUS.IN_PROGRESS
//   - READY: no job is in progress, but at least one is ASSIGNED
//     (a technician is lined up -- work is about to start)
//   - BLOCKED: none of the above -- nothing is assigned or moving
//     (this also covers an empty job list; see workOrderValidation.js
//     for flagging that as an operational anomaly rather than a normal
//     lifecycle state)
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

// A Work Order is "active" if it has work remaining and isn't blocked --
// i.e. something is either ready to start or already moving.
export function isActiveWorkOrder(jobs) {
  const state = computeWorkOrderState(jobs);
  return state === WORK_ORDER_STATE.READY || state === WORK_ORDER_STATE.IN_PROGRESS;
}

// A Work Order is "completed" only when every one of its jobs is
// JOB_STATUS.COMPLETE.
export function isCompletedWorkOrder(jobs) {
  return computeWorkOrderState(jobs) === WORK_ORDER_STATE.COMPLETED;
}

function countByStatus(jobs, status) {
  return jobs.filter((j) => j.status === status).length;
}

// Sprint 3.4.2: explains *why* a Work Order is in the state
// computeWorkOrderState() says it's in, so Control Tower can show a
// reason instead of just a badge. Same aggregation logic as
// computeWorkOrderState() -- this doesn't recompute state independently,
// it narrates the same decision.
//
// Returns:
//   {
//     state,             // one of WORK_ORDER_STATE
//     reasons: string[],  // human-readable explanation(s)
//     metrics: { totalJobs, openJobs, assignedJobs, inProgressJobs, completedJobs },
//   }
export function explainWorkOrderState(jobs) {
  const metrics = {
    totalJobs: jobs.length,
    openJobs: countByStatus(jobs, JOB_STATUS.OPEN),
    assignedJobs: countByStatus(jobs, JOB_STATUS.ASSIGNED),
    inProgressJobs: countByStatus(jobs, JOB_STATUS.IN_PROGRESS),
    completedJobs: countByStatus(jobs, JOB_STATUS.COMPLETE),
  };

  const state = computeWorkOrderState(jobs);
  const reasons = [];

  switch (state) {
    case WORK_ORDER_STATE.COMPLETED:
      reasons.push(`All ${metrics.totalJobs} job(s) are complete`);
      break;
    case WORK_ORDER_STATE.IN_PROGRESS:
      reasons.push(`${metrics.inProgressJobs} job(s) in progress`);
      if (metrics.openJobs > 0) reasons.push(`${metrics.openJobs} job(s) still unassigned`);
      break;
    case WORK_ORDER_STATE.READY:
      reasons.push(`${metrics.assignedJobs} job(s) assigned, waiting to start`);
      if (metrics.openJobs > 0) reasons.push(`${metrics.openJobs} job(s) still unassigned`);
      break;
    case WORK_ORDER_STATE.BLOCKED:
    default:
      reasons.push(
        metrics.totalJobs === 0
          ? "No jobs are attached to this work order"
          : "No job is assigned or in progress -- waiting for technician assignment"
      );
      break;
  }

  return { state, reasons, metrics };
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

// Real-doc analog of explainWorkOrderState(jobs) above -- same return
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

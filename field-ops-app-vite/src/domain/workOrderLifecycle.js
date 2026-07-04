import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";

// The single Work Order aggregation engine (Sprint 3.4). Every module
// that needs to know "is this Work Order active / blocked / ready /
// complete" -- Jobs, Dispatch, Control Tower, Reporting -- routes through
// this file. There is exactly one aggregation implementation; nothing
// else in the codebase is allowed to recompute Work Order state from raw
// job data.
//
// A Work Order never owns its own status and never transitions
// independently:
//
//   Jobs -> aggregate -> Work Order State -> Control Tower -> Reporting
//
// Jobs remain the only mutable workflow entity (OPEN -> ASSIGNED ->
// IN_PROGRESS -> COMPLETE, via domain/jobActions.js). This module is
// pure derivation: no Firestore access, no writes, no side effects.

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

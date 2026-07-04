import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";
import { createSignal, SEVERITY } from "./controlTower/types";

// Computes Work Order readiness state. Derived only -- never persisted,
// never written back to Firestore. JOB_STATUS remains the single source
// of truth; this just summarizes a set of jobs already grouped under one
// work order.
export const computeWorkOrderStatus = (jobs) => {
  const completed = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const inProgress = jobs.filter((j) => j.status === JOB_STATUS.IN_PROGRESS).length;

  if (completed === jobs.length) return WORK_ORDER_STATE.COMPLETED;
  if (inProgress > 0) return WORK_ORDER_STATE.IN_PROGRESS;
  if (jobs.some((j) => j.status === JOB_STATUS.ASSIGNED)) return WORK_ORDER_STATE.READY;
  return WORK_ORDER_STATE.BLOCKED;
};

// WORK_ORDER_STATE is a discrete state, not a continuous magnitude (a
// work order isn't "60% blocked"), so its score/severity are a fixed
// mapping rather than something derived from a formula the way risk/
// dispatch scores are.
const STATE_SEVERITY = {
  [WORK_ORDER_STATE.BLOCKED]: SEVERITY.HIGH,
  [WORK_ORDER_STATE.IN_PROGRESS]: SEVERITY.MEDIUM,
  [WORK_ORDER_STATE.READY]: SEVERITY.LOW,
  [WORK_ORDER_STATE.COMPLETED]: SEVERITY.LOW,
};

const STATE_SCORE = {
  [WORK_ORDER_STATE.BLOCKED]: 75,
  [WORK_ORDER_STATE.IN_PROGRESS]: 50,
  [WORK_ORDER_STATE.READY]: 25,
  [WORK_ORDER_STATE.COMPLETED]: 0,
};

// Canonical WorkOrderSignal for Control Tower's panels: wraps
// computeWorkOrderStatus() in the shared { id, score, severity, label,
// metadata } envelope (see domain/controlTower/types.js) so every panel
// renders work orders the same way it renders risk/dispatch signals.
export function computeWorkOrderSignal(workOrderId, jobs) {
  const state = computeWorkOrderStatus(jobs);
  const completed = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const inProgress = jobs.filter((j) => j.status === JOB_STATUS.IN_PROGRESS).length;
  const pending = jobs.length - completed - inProgress;

  return createSignal({
    id: workOrderId,
    score: STATE_SCORE[state],
    severity: STATE_SEVERITY[state],
    label: `Work Order ${workOrderId}: ${state}`,
    metadata: { state, jobCount: jobs.length, pending, inProgress, completed },
  });
}

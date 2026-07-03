import { JOB_STATUS, WORK_ORDER_STATE } from "./constants";

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

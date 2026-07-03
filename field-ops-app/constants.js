// ---------- Shared constants ----------
//
// JOB_STATUS is the single source of truth for job lifecycle status.
// Lifecycle: pending -> in_progress -> completed

const JOB_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
};

const JOB_STATUS_ORDER = [JOB_STATUS.PENDING, JOB_STATUS.IN_PROGRESS, JOB_STATUS.COMPLETED];

const JOB_STATUS_LABEL = {
  [JOB_STATUS.PENDING]: "Pending",
  [JOB_STATUS.IN_PROGRESS]: "In Progress",
  [JOB_STATUS.COMPLETED]: "Completed",
};

// Aggregates a set of job statuses into a single Work Order status:
// any pending -> pending, else any in_progress -> in_progress, else completed.
function aggregateWorkOrderStatus(jobs) {
  if (jobs.length === 0) return JOB_STATUS.PENDING;
  if (jobs.some((j) => j.status === JOB_STATUS.PENDING)) return JOB_STATUS.PENDING;
  if (jobs.some((j) => j.status === JOB_STATUS.IN_PROGRESS)) return JOB_STATUS.IN_PROGRESS;
  return JOB_STATUS.COMPLETED;
}

window.FieldOps = window.FieldOps || {};
window.FieldOps.JOB_STATUS = JOB_STATUS;
window.FieldOps.JOB_STATUS_ORDER = JOB_STATUS_ORDER;
window.FieldOps.JOB_STATUS_LABEL = JOB_STATUS_LABEL;
window.FieldOps.aggregateWorkOrderStatus = aggregateWorkOrderStatus;

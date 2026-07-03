// JOB_STATUS is the single source of truth for job lifecycle status.
// Lifecycle: pending -> in_progress -> completed

export const JOB_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
};

export const JOB_STATUS_ORDER = [JOB_STATUS.PENDING, JOB_STATUS.IN_PROGRESS, JOB_STATUS.COMPLETED];

export const JOB_STATUS_LABEL = {
  [JOB_STATUS.PENDING]: "Pending",
  [JOB_STATUS.IN_PROGRESS]: "In Progress",
  [JOB_STATUS.COMPLETED]: "Completed",
};

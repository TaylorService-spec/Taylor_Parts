import { JOB_STATUS } from "./constants";

// Computes Work Order readiness state.
// `jobs` is expected to be the set of jobs already grouped under one
// workOrderId, so "unassigned" here means "no technician on the job" —
// checking workOrderId itself would be a no-op against a pre-grouped set.
export const computeWorkOrderStatus = (jobs = []) => {
  if (!jobs.length) return "BLOCKED";

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === JOB_STATUS.COMPLETED).length;
  const inProgress = jobs.filter((j) => j.status === JOB_STATUS.IN_PROGRESS).length;
  const unassigned = jobs.filter((j) => !j.technicianId).length;

  const completionRate = completed / total;

  if (unassigned > 0) return "BLOCKED";
  if (completionRate === 1) return "COMPLETED";
  if (inProgress > 0 || completionRate >= 0.3) return "IN_PROGRESS";

  return "READY";
};

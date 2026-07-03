import { JOB_STATUS } from "./constants";

const jobTransitions = {
  [JOB_STATUS.OPEN]: [JOB_STATUS.ASSIGNED],
  [JOB_STATUS.ASSIGNED]: [JOB_STATUS.IN_PROGRESS, JOB_STATUS.OPEN],
  [JOB_STATUS.IN_PROGRESS]: [JOB_STATUS.COMPLETE],
  [JOB_STATUS.COMPLETE]: [],
};

export function canTransitionJob(currentStatus, nextStatus) {
  return jobTransitions[currentStatus]?.includes(nextStatus);
}

export const JOB_STATUS = {
  OPEN: "open",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
};

export const TECH_STATUS = {
  AVAILABLE: "available",
  ON_JOB: "on_job",
  OFF_SHIFT: "off_shift",
};

const jobTransitions = {
  open: ["assigned"],
  assigned: ["in_progress", "open"],
  in_progress: ["complete"],
  complete: [],
};

export function canTransitionJob(currentStatus, nextStatus) {
  return jobTransitions[currentStatus]?.includes(nextStatus);
}

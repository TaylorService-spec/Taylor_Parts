import { jobsStore } from "../firebase/collectionStore";
import { canTransitionJob } from "./jobWorkflow";

export function updateJobStatus(job, nextStatus) {
  if (!canTransitionJob(job.status, nextStatus)) {
    throw new Error(
      `Invalid transition: ${job.status} → ${nextStatus}`
    );
  }

  return jobsStore.update(job.id, { status: nextStatus });
}

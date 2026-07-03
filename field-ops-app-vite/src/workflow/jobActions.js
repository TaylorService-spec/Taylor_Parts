import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { jobsStore, techniciansStore } from "../firebase/collectionStore";
import { canTransitionJob, JOB_STATUS, TECH_STATUS } from "./jobWorkflow";

// The only place allowed to write job.status or technician.status.
// Components must call these instead of jobsStore/techniciansStore.update()
// directly, so every transition goes through canTransitionJob().

export async function updateJobStatus(job, nextStatus) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }

  if (!canTransitionJob(job.status, nextStatus)) {
    throw new Error(`Invalid transition: ${job.status} → ${nextStatus}`);
  }

  await jobsStore.update(job.id, { status: nextStatus });

  if (nextStatus === JOB_STATUS.COMPLETE && job.technicianId) {
    await techniciansStore.update(job.technicianId, { status: TECH_STATUS.AVAILABLE });
  }
}

export async function assignJob(job, technician) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }

  if (!job || !technician) throw new Error("Missing job or technician");

  if (!canTransitionJob(job.status, JOB_STATUS.ASSIGNED)) {
    throw new Error(`Invalid transition: ${job.status} → assigned`);
  }

  return runTransaction(db, async (tx) => {
    const techRef = doc(db, "fieldops_technicians", technician.id);
    const jobRef = doc(db, "fieldops_jobs", job.id);

    const techSnap = await tx.get(techRef);

    if (techSnap.data().status !== TECH_STATUS.AVAILABLE) {
      throw new Error("Technician no longer available");
    }

    tx.update(jobRef, {
      technicianId: technician.id,
      status: JOB_STATUS.ASSIGNED,
    });

    tx.update(techRef, {
      status: TECH_STATUS.ON_JOB,
    });
  });
}

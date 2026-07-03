import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { jobsStore, techniciansStore, JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "../firebase/collectionStore";
import { canTransitionJob } from "./jobWorkflow";
import { JOB_STATUS, TECH_STATUS } from "./constants";
import { AssignmentConflictError } from "./errors";

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

  try {
    await jobsStore.update(job.id, { status: nextStatus });

    if (nextStatus === JOB_STATUS.COMPLETE && job.technicianId) {
      await techniciansStore.update(job.technicianId, { status: TECH_STATUS.AVAILABLE });
    }
  } catch (e) {
    console.error("Firestore write failed:", e);
    throw e;
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

  try {
    return await runTransaction(db, async (tx) => {
      const techRef = doc(db, TECHNICIANS_COLLECTION, technician.id);
      const jobRef = doc(db, JOBS_COLLECTION, job.id);

      const techSnap = await tx.get(techRef);

      if (!techSnap.exists() || techSnap.data().status !== TECH_STATUS.AVAILABLE) {
        throw new AssignmentConflictError("Technician no longer available");
      }

      tx.update(jobRef, {
        technicianId: technician.id,
        status: JOB_STATUS.ASSIGNED,
      });

      tx.update(techRef, {
        status: TECH_STATUS.ON_JOB,
      });
    });
  } catch (e) {
    if (!(e instanceof AssignmentConflictError)) {
      console.error("Firestore write failed:", e);
    }
    throw e;
  }
}

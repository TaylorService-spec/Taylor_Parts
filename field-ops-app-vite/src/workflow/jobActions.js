import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { jobsStore, techniciansStore } from "../firebase/collectionStore";
import { canTransitionJob, JOB_STATUS, TECH_STATUS } from "./jobWorkflow";

// The only place allowed to write job.status or technician.status.
// Components must call these instead of jobsStore/techniciansStore.update()
// directly, so every transition goes through canTransitionJob().

// Thrown when a technician is no longer available at commit time (the normal
// outcome of two dispatchers racing for the same tech) -- distinguished from
// genuine Firestore failures so it isn't logged as "Firestore write failed".
class AssignmentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssignmentConflictError";
  }
}

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
      const techRef = doc(db, "fieldops_technicians", technician.id);
      const jobRef = doc(db, "fieldops_jobs", job.id);

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

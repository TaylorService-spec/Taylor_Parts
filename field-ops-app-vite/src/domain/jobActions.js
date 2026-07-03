import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { jobsStore, techniciansStore } from "../firebase/collectionStore";
import { canTransitionJob } from "./jobWorkflow";
import { JOB_STATUS, TECH_STATUS, JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "./constants";
import { AssignmentConflictError } from "./errors";

// The only place allowed to write job/technician data. Components must call
// these instead of touching jobsStore/techniciansStore or Firestore directly,
// so every transition goes through canTransitionJob().

export function createJob(customer, description) {
  return jobsStore.add({ customer, description, status: JOB_STATUS.OPEN, technicianId: null });
}

export function createTechnician(name, phone) {
  return techniciansStore.add({ name, phone, status: TECH_STATUS.AVAILABLE });
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

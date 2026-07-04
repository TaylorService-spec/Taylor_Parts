import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { jobsStore, techniciansStore } from "../firebase/collectionStore";
import { canTransitionJob } from "./jobWorkflow";
import { JOB_STATUS, TECH_STATUS, JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "./constants";
import { AssignmentConflictError } from "./errors";
import { isWriteBlocked } from "../config/env";

// The only place allowed to write job/technician data. Components must call
// these instead of touching jobsStore/techniciansStore or Firestore directly,
// so every transition goes through canTransitionJob().
//
// Jobs never own customer data directly -- they resolve upward via
// workOrderId: job -> workOrder -> customer. See domain/workOrders.js.
//
// createJob()/createTechnician() write through jobsStore/techniciansStore
// (firebase/collectionStore.js), which already gate through
// lib/firebaseSafe.js. assignJob()/updateJobStatus() write via
// runTransaction()/tx.update() directly (for the atomicity guarantees
// described below), which firebaseSafe.js's safe*Doc wrappers don't
// cover -- so each checks isWriteBlocked() itself, before ever opening a
// transaction, returning the same { blocked: true } sentinel.

export function createJob(customer, description) {
  return jobsStore.add({
    customer,
    description,
    status: JOB_STATUS.OPEN,
    technicianId: null,
    workOrderId: null,
  });
}

export function createTechnician(name, phone) {
  return techniciansStore.add({ name, phone, status: TECH_STATUS.AVAILABLE });
}

export async function updateJobStatus(job, nextStatus) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }

  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (updateJobStatus)", job.id, nextStatus);
    return { blocked: true };
  }

  try {
    return await runTransaction(db, async (tx) => {
      const jobRef = doc(db, JOBS_COLLECTION, job.id);
      const jobSnap = await tx.get(jobRef);

      if (!jobSnap.exists()) {
        throw new Error("Job not found");
      }

      const currentStatus = jobSnap.data().status;

      if (!canTransitionJob(currentStatus, nextStatus)) {
        throw new Error(`Invalid transition: ${currentStatus} → ${nextStatus}`);
      }

      const technicianId = jobSnap.data().technicianId;
      let techRef = null;

      if (nextStatus === JOB_STATUS.COMPLETE && technicianId) {
        techRef = doc(db, TECHNICIANS_COLLECTION, technicianId);
        await tx.get(techRef);
      }

      tx.update(jobRef, { status: nextStatus });

      if (techRef) {
        tx.update(techRef, { status: TECH_STATUS.AVAILABLE });
      }
    });
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

  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (assignJob)", job.id, technician.id);
    return { blocked: true };
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

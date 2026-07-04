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

// address: { street, city, state, zip } -- optional, additive field.
// `geo` (lat/lng) is intentionally not implemented yet; reserved for a
// future sprint once a geocoding source is chosen. Backward compatible:
// omitting address entirely (as every call site before this field
// existed did) still works, jobs simply have no address recorded.
// priority/scheduledFor/estimatedDuration: optional, additive fields
// (same pattern as address above). Left null unless explicitly passed --
// no default priority is written here; dispatchEngine.js's scoring
// treats an absent priority as "medium" on read instead.
export function createJob(
  customer,
  description,
  address = null,
  { priority = null, scheduledFor = null, estimatedDuration = null } = {}
) {
  return jobsStore.add({
    customer,
    description,
    status: JOB_STATUS.OPEN,
    technicianId: null,
    workOrderId: null,
    address,
    priority,
    scheduledFor,
    estimatedDuration,
  });
}

// active/maxConcurrentJobs/region: optional, additive fields. currentJobId
// starts explicitly null (rather than omitted) so every technician doc
// has a consistent shape for dispatchEngine.js/Dispatch.jsx's workload
// panel to read -- assignJob() is the only place that later sets it.
export function createTechnician(
  name,
  phone,
  { active = true, maxConcurrentJobs = 1, region = null } = {}
) {
  return techniciansStore.add({
    name,
    phone,
    status: TECH_STATUS.AVAILABLE,
    active,
    currentJobId: null,
    maxConcurrentJobs,
    region,
    lastActive: Date.now(),
  });
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
      // ASSIGNED -> OPEN (demotion/unassignment, allowed by jobWorkflow.js)
      // must clear the technician exactly like completing a job does --
      // otherwise the job goes back to unassigned while technicianId,
      // technician.status, and technician.currentJobId all stay stale,
      // producing a "ghost assignment" that skews workload display and
      // dispatchEngine.js's ranking.
      const isUnassigning = nextStatus === JOB_STATUS.OPEN;

      if ((nextStatus === JOB_STATUS.COMPLETE || isUnassigning) && technicianId) {
        techRef = doc(db, TECHNICIANS_COLLECTION, technicianId);
        await tx.get(techRef);
      }

      tx.update(jobRef, isUnassigning ? { status: nextStatus, technicianId: null } : { status: nextStatus });

      if (techRef) {
        tx.update(techRef, {
          status: TECH_STATUS.AVAILABLE,
          currentJobId: null,
          lastActive: Date.now(),
        });
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
        assignedAt: Date.now(),
      });

      tx.update(techRef, {
        status: TECH_STATUS.ON_JOB,
        currentJobId: job.id,
        lastActive: Date.now(),
      });
    });
  } catch (e) {
    if (!(e instanceof AssignmentConflictError)) {
      console.error("Firestore write failed:", e);
    }
    throw e;
  }
}

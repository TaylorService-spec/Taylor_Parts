import { doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import {
  createJob as createJobPrimitive,
  assignJob as assignJobPrimitive,
  updateJobStatus as updateJobStatusPrimitive,
} from "../domain/jobActions";
import { JOBS_COLLECTION, JOB_STATUS, JOB_PHASE } from "../domain/constants";
import { canTransitionPhase } from "../domain/jobPhaseWorkflow";
import { InvalidPhaseTransitionError } from "../domain/errors";
import { isWriteBlocked } from "../config/env";
import { logJobEvent } from "./jobEventService";
import { safeUpdateDoc } from "../lib/firebaseSafe";

// Sprint 4 Epic 2/5: composes the EXISTING, unmodified
// domain/jobActions.js primitives (createJob/assignJob/updateJobStatus --
// still the only functions that ever transition job.status/technicianId)
// with the new, additive job.phase tracking and persisted event log.
// Nothing in this file touches JOB_STATUS or rewrites a sanctioned
// status-transition function; it only layers job.phase writes and
// event-log entries around calls to the primitives that already existed,
// per this sprint's hard rule against rewriting working lifecycle code.
//
// Scope note: this sprint does not wire phase-advancement into the live
// Dispatch/Field Mode UI (modules/dispatch/Dispatch.jsx,
// modules/mobile/FieldMode.jsx) -- those are Sprint 3.6's UI layer,
// explicitly "unchanged logically" per this sprint's architecture
// principle. The service layer here is complete and independently
// usable (see modules/opsDebug/OperationalDebugView.jsx, Task 4.12);
// wiring it into the production screens is a natural next-sprint step
// once this core is proven stable.

export async function advanceJobPhase(job, nextPhase) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (advanceJobPhase)", job.id, nextPhase);
    return { blocked: true };
  }

  const jobRef = doc(db, JOBS_COLLECTION, job.id);

  return runTransaction(db, async (tx) => {
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists()) {
      throw new Error("Job not found");
    }

    const currentPhase = jobSnap.data().phase ?? JOB_PHASE.CREATED;
    if (!canTransitionPhase(currentPhase, nextPhase)) {
      throw new InvalidPhaseTransitionError(`Invalid phase transition: ${currentPhase} -> ${nextPhase}`);
    }

    tx.update(jobRef, { phase: nextPhase });
    logJobEvent(tx, job.id, "PHASE_CHANGED", { from: currentPhase, to: nextPhase });
  });
}

// Wraps the existing createJob() (domain/jobActions.js, unchanged) and
// attaches the additive partsRequired/phase/partsReserved fields with one
// follow-up write. partsRequired: { [partId]: quantity }.
export async function createJobWithParts(customer, description, partsRequired = {}) {
  const job = await createJobPrimitive(customer, description);
  if (job?.blocked) return job;

  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (createJobWithParts partsRequired)", job.id);
    return job;
  }

  await safeUpdateDoc(doc(db, JOBS_COLLECTION, job.id), {
    phase: JOB_PHASE.CREATED,
    partsRequired,
    partsReserved: {},
  });
  await logJobEvent(null, job.id, "JOB_CREATED", { customer, description, partsRequired });

  return { ...job, phase: JOB_PHASE.CREATED, partsRequired, partsReserved: {} };
}

// Wraps the existing assignJob() (domain/jobActions.js, unchanged) and
// advances job.phase to ASSIGNED once the real assignment succeeds.
//
// Not a single atomic operation across both writes -- true atomicity
// would require modifying assignJob() itself, which this sprint's hard
// rules forbid ("do not rewrite working job lifecycle functions"). If
// the phase-advance step fails after a successful assignment, the job is
// still correctly ASSIGNED in JOB_STATUS (the real source of truth) --
// only its phase tracking lags, a cosmetic gap, not a data-integrity one.
export async function assignJobWithPhase(job, technician) {
  const result = await assignJobPrimitive(job, technician);
  if (result?.blocked) return result;

  await advanceJobPhase(job, JOB_PHASE.ASSIGNED);
  return result;
}

// Wraps the existing updateJobStatus() (domain/jobActions.js, unchanged)
// for the COMPLETE transition, and advances job.phase to COMPLETED
// alongside it (same non-atomic-but-safe composition as
// assignJobWithPhase above).
export async function completeJobWithPhase(job) {
  const result = await updateJobStatusPrimitive(job, JOB_STATUS.COMPLETE);
  if (result?.blocked) return result;

  const currentPhase = job.phase ?? JOB_PHASE.CREATED;
  if (canTransitionPhase(currentPhase, JOB_PHASE.COMPLETED)) {
    await advanceJobPhase(job, JOB_PHASE.COMPLETED);
  }

  return result;
}

import { JOB_STATUS } from "./constants";

// Sprint 3.4.5: read-only operational invariant checks for a Work Order's
// jobs. No Firestore access, no writes, no mutation -- this only detects
// and reports anomalies; it never corrects them. Intended for Control
// Tower / reporting to surface data-quality problems, not for gating any
// workflow.

const KNOWN_STATUSES = new Set(Object.values(JOB_STATUS));

// Statuses that can only exist on a job that has been through
// assignJob() -- which always sets technicianId at the same time it sets
// status to ASSIGNED, inside one transaction (see domain/jobActions.js).
// A job in one of these statuses without a technicianId means that
// invariant was violated somewhere (data imported incorrectly, manual
// Firestore edit, etc.) -- it can't happen via the app's own write path.
const REQUIRES_TECHNICIAN = new Set([JOB_STATUS.ASSIGNED, JOB_STATUS.IN_PROGRESS, JOB_STATUS.COMPLETE]);

const LARGE_WORK_ORDER_JOB_COUNT = 20;

function findDuplicateJobIds(jobs) {
  const seen = new Set();
  const duplicates = new Set();

  jobs.forEach((job) => {
    if (seen.has(job.id)) duplicates.add(job.id);
    seen.add(job.id);
  });

  return [...duplicates];
}

// Checks one Work Order's jobs for structural/operational anomalies.
// Returns { warnings: string[], errors: string[] }. Errors indicate data
// that should be impossible under the app's own write path (assignJob()/
// updateJobStatus()) and likely means external data corruption; warnings
// are softer signals worth a human's attention but not necessarily wrong.
export function validateWorkOrder(workOrderId, jobs) {
  const errors = [];
  const warnings = [];

  if (jobs.length === 0) {
    errors.push(`Work order ${workOrderId} has no jobs`);
    return { errors, warnings };
  }

  const duplicateIds = findDuplicateJobIds(jobs);
  if (duplicateIds.length > 0) {
    errors.push(`Work order ${workOrderId} has duplicate job id(s): ${duplicateIds.join(", ")}`);
  }

  jobs.forEach((job) => {
    if (!KNOWN_STATUSES.has(job.status)) {
      errors.push(`Job ${job.id} has an unknown status: ${JSON.stringify(job.status)}`);
      return;
    }

    const hasTechnician = Boolean(job.technicianId);
    const shouldHaveTechnician = REQUIRES_TECHNICIAN.has(job.status);

    if (shouldHaveTechnician && !hasTechnician) {
      errors.push(
        `Job ${job.id} is ${job.status} but has no technicianId -- impossible via assignJob()`
      );
    } else if (!shouldHaveTechnician && hasTechnician) {
      errors.push(
        `Job ${job.id} is ${job.status} but has a technicianId set -- impossible via assignJob()`
      );
    }
  });

  if (jobs.length >= LARGE_WORK_ORDER_JOB_COUNT) {
    warnings.push(
      `Work order ${workOrderId} has ${jobs.length} jobs, unusually large for one work order`
    );
  }

  return { errors, warnings };
}

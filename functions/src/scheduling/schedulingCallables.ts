// Dispatch & Scheduler -- thin onCall adapters for the Scheduling command service.
//
// Same pattern as truckRegistry/truckRegistryCallables.ts and access/accessCommandCallables.ts:
// derive actorUid ONLY from request.auth.uid (never request.data), pass request.data straight into
// the service, and map thrown service errors to HttpsError through a sanitized class-per-reason
// table. All real logic lives in the service so both stay independently testable.
//
// Authorization is admin/dispatcher, enforced inside the service (Owner ruling 2026-08-27) -- the
// same bucket ACTION_PERMISSIONS already uses for Schedule and Dispatch. No new capability.
import { onCall, HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";
import {
  createTechnicianBlockedTime,
  deleteTechnicianBlockedTime,
  reassignScheduledWorkOrder,
  rescheduleWorkOrder,
  setTechnicianWorkingAvailability,
  setWorkOrderEstimatedDuration,
} from "./schedulingCommands";
import { readTechnicianAvailability } from "./schedulingReadService";
import { SchedulingError, type SchedulingFailureCode } from "./types";

// One generic message per code. The service's own messages name technician ids, Work Order ids and
// stored windows -- useful in logs, and none of a caller's business past the trust boundary. The
// stable `code` is what a client acts on, and it is the only thing that crosses.
//
// The three warning-vs-refusal outcomes of ND-20 are visible in this table: BLOCKED_TIME_CONFLICT,
// START_IN_PAST, TECHNICIAN_INELIGIBLE and SCHEDULE_CONFLICT are all failed-precondition refusals.
// "Outside working hours" appears nowhere here, because it is not a refusal -- it comes back on a
// SUCCESSFUL response as a warning.
const FAILURE_MAP: Record<SchedulingFailureCode, { code: FunctionsErrorCode; message: string }> = {
  INVALID_INPUT: { code: "invalid-argument", message: "The request is missing or has invalid fields." },
  PERMISSION_DENIED: { code: "permission-denied", message: "You are not authorized to change a schedule." },
  WORK_ORDER_NOT_FOUND: { code: "not-found", message: "No Work Order exists at that id." },
  NOT_SCHEDULED: { code: "failed-precondition", message: "That Work Order is not scheduled, so its schedule cannot be changed." },
  REASON_REQUIRED: { code: "invalid-argument", message: "A reason is required for this change." },
  TECHNICIAN_NOT_FOUND: { code: "not-found", message: "No technician exists at that id." },
  TECHNICIAN_INELIGIBLE: { code: "failed-precondition", message: "That technician cannot be scheduled." },
  SCHEDULE_CONFLICT: { code: "failed-precondition", message: "That technician is already scheduled for overlapping work." },
  BLOCKED_TIME_CONFLICT: { code: "failed-precondition", message: "That technician has blocked time overlapping that window." },
  START_IN_PAST: { code: "failed-precondition", message: "A Work Order cannot be scheduled to start in the past." },
  STALE_WORK_ORDER: { code: "aborted", message: "The schedule changed since it was loaded. Reload and try again." },
};

/** Exported for direct sanitization tests: a known failure surfaces ONLY its generic per-code message. */
export function mapError(err: unknown): HttpsError {
  if (err instanceof SchedulingError) {
    const mapped = FAILURE_MAP[err.code] ?? { code: "internal" as FunctionsErrorCode, message: "The request could not be completed." };
    return new HttpsError(mapped.code, mapped.message, { code: err.code });
  }
  if (err instanceof HttpsError) return err;
  return new HttpsError("internal", "The request could not be completed.");
}

type Handler<T> = (actorUid: string, data: unknown) => Promise<T>;

function adapt<T>(handler: Handler<T>) {
  return onCall({ region: "us-central1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    try {
      return await handler(request.auth.uid, request.data);
    } catch (err) {
      throw mapError(err);
    }
  });
}

export const rescheduleWorkOrderCallable = adapt(rescheduleWorkOrder);
export const reassignScheduledWorkOrderCallable = adapt(reassignScheduledWorkOrder);
export const setWorkOrderEstimatedDurationCallable = adapt(setWorkOrderEstimatedDuration);
export const setTechnicianWorkingAvailabilityCallable = adapt(setTechnicianWorkingAvailability);
export const createTechnicianBlockedTimeCallable = adapt(createTechnicianBlockedTime);
export const deleteTechnicianBlockedTimeCallable = adapt(deleteTechnicianBlockedTime);

// The board's only way in. Both availability collections deny client reads, so without this the
// North Star's lane shading and capacity indicators would have no source.
export const readTechnicianAvailabilityCallable = adapt(readTechnicianAvailability);

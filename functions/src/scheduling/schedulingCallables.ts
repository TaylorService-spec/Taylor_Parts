// Dispatch & Scheduler -- thin onCall adapters for the Scheduling command service.
//
// Same pattern as truckRegistry/truckRegistryCallables.ts and access/accessCommandCallables.ts:
// derive actorUid ONLY from request.auth.uid (never request.data), pass request.data straight into
// the service, and map thrown service errors to HttpsError through a sanitized class-per-reason
// table. All real logic lives in the service so both stay independently testable.
//
// Authorization is admin/dispatcher, enforced inside the service (Owner ruling 2026-08-27) -- the
// same bucket ACTION_PERMISSIONS already uses for Schedule and Dispatch. No new capability.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createTechnicianBlockedTime,
  deleteTechnicianBlockedTime,
  reassignScheduledWorkOrder,
  rescheduleWorkOrder,
  setTechnicianWorkingAvailability,
  setWorkOrderEstimatedDuration,
} from "./schedulingCommands";
import { readTechnicianAvailability } from "./schedulingReadService";
import { mapError } from "./errorMapping";
import { SchedulingError } from "./types";

// The SchedulingError -> HttpsError table moved to ./errorMapping.ts (ND-24), because
// transitionWorkOrder now raises SchedulingErrors too and must not import this module -- whose top
// level defines seven onCall handlers -- merely to reach an error table. Re-exported here so every
// existing importer, including the direct sanitization tests, is unaffected.
export { mapError } from "./errorMapping";

type Handler<T> = (actorUid: string, data: unknown) => Promise<T>;

function adapt<T>(handler: Handler<T>) {
  return onCall({ region: "us-central1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    try {
      return await handler(request.auth.uid, request.data);
    } catch (err) {
      // LOG BEFORE SANITIZING. mapError deliberately collapses anything it does not recognise into a
      // generic "internal" so no internal state crosses the trust boundary -- which is right, and
      // which also means an unexpected failure would otherwise leave NO trace anywhere of what
      // actually went wrong. This lane found that out the hard way: an intermittent Firestore
      // transaction error surfaced as an unexplainable "The request could not be completed." and took
      // an instrumented rerun to identify. The client still learns nothing it should not; the server
      // log keeps what an operator needs. Recognised SchedulingErrors are not logged here -- they are
      // ordinary refusals, not faults.
      if (!(err instanceof SchedulingError)) {
        console.error("scheduling command failed with an unrecognised error", err);
      }
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

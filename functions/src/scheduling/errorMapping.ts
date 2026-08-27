// Dispatch & Scheduler -- the sanitized SchedulingError -> HttpsError table.
//
// ============================ WHY THIS IS ITS OWN MODULE (ND-24) ============================
//
// It used to live in schedulingCallables.ts, which is fine while the only thing that raises a
// SchedulingError is a scheduling callable. ND-24 made transitionWorkOrder raise them too, by putting
// the initial Schedule placement onto the shared placement policy -- and transitionWorkOrder must not
// import a module whose top level DEFINES seven onCall handlers just to reach an error table.
//
// So the table moved here. schedulingCallables.ts re-exports mapError, so its own importers and the
// direct sanitization tests are unaffected. There is still exactly one table: a refusal means the
// same thing to a caller whichever path produced it, which is the entire point of ND-24 restated at
// the trust boundary.
import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";

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

// gRPC status codes that mean "this did not happen, and trying again may work" rather than "this is
// broken". Firestore raises them when a transaction loses a contention race or runs out of time --
// which these commands provoke ON PURPOSE, by serializing every schedule-touching write for one
// technician on a single sentinel document.
//
// Found by the emulator suite (see docs/design/governed-scheduling-domain.md): a transaction lock
// timeout was reaching the caller as `internal`. That is a 500 -- it tells a dispatcher the system is
// broken, when the truthful answer is "somebody else was moving this, try again". The distinction is
// not cosmetic: one is a bug report and the other is a button press.
const RETRYABLE_FIRESTORE_CODES = new Set([
  4, // DEADLINE_EXCEEDED
  10, // ABORTED -- contention, including the emulator's transaction lock timeout
  14, // UNAVAILABLE
]);

/** Exported for direct sanitization tests: a known failure surfaces ONLY its generic per-code message. */
export function mapError(err: unknown): HttpsError {
  if (err instanceof SchedulingError) {
    const mapped = FAILURE_MAP[err.code] ?? { code: "internal" as FunctionsErrorCode, message: "The request could not be completed." };
    return new HttpsError(mapped.code, mapped.message, { code: err.code });
  }
  if (err instanceof HttpsError) return err;
  // Same sanitization posture as everything else here -- the code crosses, the detail does not. The
  // reused STALE_WORK_ORDER code is deliberate: from the caller's side a lost contention race and a
  // stale board are the same situation and have the same remedy.
  const grpcCode = (err as { code?: unknown } | null)?.code;
  if (typeof grpcCode === "number" && RETRYABLE_FIRESTORE_CODES.has(grpcCode)) {
    return new HttpsError("aborted", FAILURE_MAP.STALE_WORK_ORDER.message, { code: "STALE_WORK_ORDER" });
  }
  return new HttpsError("internal", "The request could not be completed.");
}

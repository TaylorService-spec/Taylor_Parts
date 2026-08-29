// Dispatch North Star P1 -- governed refusal codes, in words.
//
// The artifact is explicit about this (1b): *"The chip springs back; never raw backend codes."* A
// dispatcher who is told `BLOCKED_TIME_CONFLICT` has been handed the server's internal vocabulary and
// asked to translate it under time pressure.
//
// ════════════════════ THIS IS NOT A SECOND COPY OF THE POLICY ════════════════════
//
// Every sentence here is a RENDERING of an outcome the server already decided. Nothing in this file
// predicts, pre-empts or duplicates a refusal: the board proposes, the trusted command decides, and
// this turns the decision into English. The placement policy lives in
// functions/src/scheduling/placementPolicy.ts and has exactly one implementation (ND-24).
//
// The codes are the server's STABLE contract -- `details.code` on the HttpsError, the same values
// schedulingCallables.ts's FAILURE_MAP emits. They are matched exactly rather than by substring,
// because a code this file does not recognise must fall through to the generic sentence rather than
// be guessed at.
import { resolveTechnicianIdentity } from "./actorDisplayName.js";

const BLOCKED_KIND_WORDS = Object.freeze({
  PTO: "time off",
  LUNCH: "a lunch break",
  TRAINING: "training",
  MEETING: "a meeting",
  TRUCK_SERVICE: "truck service",
  UNAVAILABLE: "recorded unavailable time",
  COMPANY_CLOSURE: "a company closure",
});

/** The governed blocked-time vocabulary as a display word. Unknown kinds read as "blocked time". */
export function blockedKindLabel(kind) {
  return BLOCKED_KIND_WORDS[kind] ?? "blocked time";
}

/** Title-cased for a chip label: PTO stays PTO, TRUCK_SERVICE becomes Truck service. */
export function blockedKindChipLabel(kind) {
  if (!kind) return "Blocked";
  if (kind === "PTO") return "PTO";
  const words = String(kind).toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A sentence for a governed refusal.
 *
 * @param errorCode   the server's stable `details.code`, or null
 * @param errorStatus the HttpsError code, used only when there is no governed code
 * @param context     { technicianName, workOrderRef } — named where the server named them generically
 */
export function schedulingRefusalMessage(errorCode, errorStatus, context = {}) {
  const who = context.technicianName ? context.technicianName : "that technician";
  const ref = context.workOrderRef ? context.workOrderRef : "this work order";

  switch (errorCode) {
    case "SCHEDULE_CONFLICT":
      return `Refused — ${who} already has work scheduled in that window.`;
    case "BLOCKED_TIME_CONFLICT":
      return `Refused — that window overlaps ${who}'s blocked time.`;
    case "START_IN_PAST":
      return "Refused — a work order cannot be scheduled to start in the past.";
    case "TECHNICIAN_INELIGIBLE":
      return `Refused — ${who} cannot be scheduled.`;
    case "TECHNICIAN_NOT_FOUND":
      return "Refused — that technician record no longer exists.";
    case "NOT_SCHEDULED":
      return `Refused — ${ref} has no scheduled window to change.`;
    case "WORK_ORDER_NOT_FOUND":
      return `Refused — ${ref} no longer exists.`;
    case "REASON_REQUIRED":
      return "A reason is required for this change.";
    // A lost contention race and a stale board are the same situation to a dispatcher, and have the
    // same remedy. The server deliberately reuses one code for both (see schedulingCallables.ts).
    case "STALE_WORK_ORDER":
      return "The schedule changed while you were moving this. The board has refreshed — try again.";
    case "INVALID_INPUT":
      return "Refused — that placement is not valid.";
    case "PERMISSION_DENIED":
      return "You are not authorized to change a schedule.";
    default:
      break;
  }

  // No governed code. Fall back on the transport status, and say the least that is still true.
  switch (errorStatus) {
    case "permission-denied":
      return "You are not authorized to change a schedule.";
    case "unauthenticated":
      return "Your session has expired. Sign in again to continue.";
    case "not-found":
      return `Refused — ${ref} no longer exists.`;
    case "aborted":
      return "The schedule changed while you were moving this. The board has refreshed — try again.";
    default:
      return "That change could not be completed. Nothing was changed.";
  }
}

/**
 * Sentences for the warnings that ride along with a SUCCESSFUL placement (ND-20).
 *
 * These are not failures and must never be styled as ones. The placement committed; the dispatcher
 * is being told something about it that they would otherwise have to notice themselves. Silently
 * dropping them is the failure mode -- the placement then looks unremarkable when it is not.
 */
export function schedulingWarningMessage(code, context = {}) {
  const who = context.technicianName ? context.technicianName : "that technician";
  switch (code) {
    case "OUTSIDE_WORKING_HOURS":
      return `Scheduled outside ${who}'s recorded working hours.`;
    case "NO_WORKING_AVAILABILITY_RECORDED":
      return `Scheduled — ${who} has no working hours recorded, so this could not be checked against a shift.`;
    default:
      return null;
  }
}

/** Every warning on a command result, as sentences, in order. Unknown codes are dropped, not guessed. */
export function schedulingWarningMessages(warnings, context = {}) {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((w) => schedulingWarningMessage(w?.code, context)).filter(Boolean);
}

/** Resolve a technician id to the name the rest of the board shows, for use in these sentences. */
export function refusalContextFor(technicians, technicianId, workOrder) {
  // resolveTechnicianIdentity, not a local find(...)?.name -- it is the governed resolver and it keeps
  // unset / loading / error / resolved / unknown apart. Only a RESOLVED name is used in a sentence;
  // anything else falls back to "that technician" rather than printing a document id at a dispatcher.
  const identity = resolveTechnicianIdentity(technicianId, { technicians });
  return {
    technicianName: identity.state === "resolved" ? identity.name : null,
    workOrderRef: workOrder?.woNumber ?? null,
  };
}

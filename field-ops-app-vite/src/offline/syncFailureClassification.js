// WHY A SYNC ATTEMPT FAILED — four answers, and they lead to four different places.
//
// ============================ WHY FOUR AND NOT TWO ============================
//
// domain/offlineSubmissionQueue.js already answers "would retrying ever help?" for the warehouse
// queue, and that answer is REUSED here rather than restated — TERMINAL_ERROR_CODES is imported, not
// copied, so the two runtimes cannot drift into disagreeing about what a refusal is.
//
// But retryable-or-not is not enough for a technician. Three things that are all "do not retry" want
// completely different words on a phone:
//
//   REFUSED          the server said no and means it. You are not authorized, or the job is not in a
//                    state that accepts this. Nothing you do on this screen changes it.
//   CONFLICT         the world moved. The machine was installed by somebody else, the job was
//                    reassigned, the Work Order is already complete. Your work is not wrong — it is
//                    about a situation that no longer exists.
//   NEEDS_ATTENTION  we cannot decide this for you. Somebody has to look.
//
// Collapsing those into "failed" is how a technician ends up standing in a plant room being told
// "error" about a machine somebody else installed an hour ago.
//
// ============================ THE BIAS, STATED ============================
//
// Anything unrecognized is RETRYABLE. Retrying a transient failure costs one request; giving up on
// one loses a technician's work. But retryable is BOUNDED — see nextBackoffMillis and MAX_ATTEMPTS —
// because an unbounded retry is just a slower way to lose it.
import { TERMINAL_ERROR_CODES } from "../domain/offlineSubmissionQueue.js";
import { SYNC_STATE } from "../domain/technicianHandheld.js";

export const FAILURE_CLASS = Object.freeze({
  RETRYABLE: "RETRYABLE",
  CONFLICT: "CONFLICT",
  REFUSED: "REFUSED",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
});

/** Where each class leaves the intent. Attention states are terminal without a person. */
export const CLASS_TO_STATE = Object.freeze({
  [FAILURE_CLASS.RETRYABLE]: SYNC_STATE.PENDING_SYNC,
  [FAILURE_CLASS.CONFLICT]: SYNC_STATE.CONFLICT,
  [FAILURE_CLASS.REFUSED]: SYNC_STATE.REFUSED,
  [FAILURE_CLASS.NEEDS_ATTENTION]: SYNC_STATE.NEEDS_ATTENTION,
});

/**
 * Business codes that mean THE WORLD MOVED rather than YOU MAY NOT.
 *
 * Every one of these is returned by a command this runtime actually calls, and each describes a
 * situation that was true when the technician captured the intent and is not true now. They arrive as
 * `failed-precondition` / `not-found`, which the transport-level list would call a flat refusal —
 * true, but useless to the person holding the box.
 */
export const CONFLICT_DETAILS = Object.freeze([
  "ASSET_INSTALLED_ELSEWHERE",
  "ASSET_NOT_INSTALLABLE",
  "ALREADY_INSTALLED_FOR_THIS_WORK_ORDER",
  "WORK_ORDER_STATE_INVALID",
  "NOT_ASSIGNED_TECHNICIAN",
  "IDEMPOTENCY_CONFLICT",
  "OVERLAPPING_ENTRY",
  "ENTRY_ALREADY_REVERSED",
  "INVALID_TRANSITION",
]);

/**
 * Details that mean a person has to decide, and no amount of machinery will.
 *
 * A conflicting idempotency key is the sharp one: the same act id arrived carrying a different
 * request. Somebody must say which is right. Guessing would either lose an edit or duplicate an
 * effect, and both are worse than asking.
 */
export const ATTENTION_DETAILS = Object.freeze([
  "IDEMPOTENCY_CONFLICT",
  "PAYLOAD_FINGERPRINT_MISMATCH",
]);

const strip = (raw) => {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("functions/") ? s.slice("functions/".length) : s;
};

/**
 * Classify one failure.
 *
 * `details` is the command's own business code (every callable in this platform passes one as the
 * HttpsError details) and it is consulted FIRST, because it is the more specific fact. The transport
 * code is the fallback for everything that never reached a command.
 */
export function classifyFailure({ code = null, details = null, offline = false } = {}) {
  // A capture made with no connection is not a refusal by anybody. It never reached a server to be
  // refused BY. This is checked before anything else so a stale code from a previous attempt cannot
  // turn a network outage into a permanent "not accepted".
  if (offline) return FAILURE_CLASS.RETRYABLE;

  const detail = typeof details === "string" ? details.toUpperCase() : "";
  if (ATTENTION_DETAILS.includes(detail)) return FAILURE_CLASS.NEEDS_ATTENTION;
  if (CONFLICT_DETAILS.includes(detail)) return FAILURE_CLASS.CONFLICT;

  const transport = strip(code);
  if (transport === "unauthenticated" || transport === "permission-denied") return FAILURE_CLASS.REFUSED;
  // An invalid request will not become valid by being sent again, and a phone cannot fix it.
  if (transport === "invalid-argument") return FAILURE_CLASS.REFUSED;
  if (transport === "not-found" || transport === "failed-precondition") return FAILURE_CLASS.CONFLICT;
  if (TERMINAL_ERROR_CODES.includes(transport)) return FAILURE_CLASS.REFUSED;
  return FAILURE_CLASS.RETRYABLE;
}

/**
 * How many times a retryable failure is retried before it stops being treated as transient.
 *
 * Eight, which with the backoff below is roughly half an hour of trying. A phone that has failed
 * eight times over half an hour is not in a dead zone — something is wrong that retrying will not
 * fix, and continuing to retry hides it. The intent is not lost: it becomes NEEDS_ATTENTION, stays in
 * the queue, and can be sent again deliberately.
 */
export const MAX_ATTEMPTS = 8;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Bounded exponential backoff.
 *
 * Capped at five minutes so a technician walking back into signal is not left waiting on a delay that
 * doubled its way to an hour while their phone was in a basement.
 */
export function nextBackoffMillis(attemptCount) {
  const n = Math.max(0, Number(attemptCount) || 0);
  return Math.min(BASE_BACKOFF_MS * 2 ** n, MAX_BACKOFF_MS);
}

/**
 * The whole outcome of a failed attempt: where it goes, and when it may go again.
 *
 * Retryable-but-exhausted is deliberately NOT re-classified as REFUSED. The server never refused it;
 * we stopped asking. Saying "not accepted" would put words in the platform's mouth.
 */
export function applyFailure(intent, { code = null, details = null, offline = false, at = 0 } = {}) {
  const failureClass = classifyFailure({ code, details, offline });
  const attemptCount = (intent?.attemptCount ?? 0) + 1;
  const exhausted = failureClass === FAILURE_CLASS.RETRYABLE && attemptCount >= MAX_ATTEMPTS;
  const state = exhausted ? SYNC_STATE.NEEDS_ATTENTION : CLASS_TO_STATE[failureClass];
  return Object.freeze({
    ...intent,
    state,
    failureClass,
    attemptCount,
    lastAttemptAt: at,
    nextEligibleAt: failureClass === FAILURE_CLASS.RETRYABLE && !exhausted
      ? at + nextBackoffMillis(attemptCount)
      : Number.POSITIVE_INFINITY,
    lastServerError: Object.freeze({ code: code ?? null, details: details ?? null, offline }),
  });
}

// OFFLINE / RETRY — the shared reliability contract. PURE: no I/O, no JSX, no timers, no storage.
//
// ============================ WHAT AN OFFLINE SUBMISSION IS ============================
//
// A warehouse has dead zones. An operator finishes a stow behind a steel rack, presses confirm, and
// the request does not leave the phone. The question this module answers is not "how do we retry" —
// that part is easy — but **what do we tell them it means in the meantime**.
//
// The answer is UNVERIFIED, and it is a first-class state, not a spinner. It means: we have your
// submission, we have not been told it worked, and we will not pretend otherwise. An operator who
// believes a stow committed and walks away has left the warehouse in a state nobody recorded.
//
// ============================ IT NEVER INTERPRETS A SUBMISSION ============================
//
// The queue stores a callable NAME, an opaque PAYLOAD, and the operation's own idempotency KEY. It
// does not know what a put-away is, cannot read a quantity, and cannot merge two submissions.
//
// That is deliberate: the brief's warning against collapsing domain commands into one generic
// movement service applies exactly here. A queue that understood payloads would start making
// domain decisions — combining stows, reordering counts — with none of the authority to do so.
//
// ============================ COMMITTED GROUPS ARE NEVER REPLAYED ============================
//
// Every command in this platform already derives a STABLE id from its idempotency key: `rcvc_` for
// canonical receipts, `plc_` for placements, `ret_` for returns. So a replay is safe at the server.
//
// The queue is stricter anyway: once a submission is CONFIRMED it is never sent again, and its key
// is remembered so a stale copy — restored from storage on another tab, say — cannot resurrect it.
// Safe-to-replay and will-replay are different promises, and only the second is ours to make.

/** Where one submission has got to. */
export const SUBMISSION_STATE = Object.freeze({
  /** Queued, not yet attempted. */
  PENDING: "PENDING",
  /** Sent, no answer. NOT done — the operator is told exactly this. */
  UNVERIFIED: "UNVERIFIED",
  /** The server said yes. Terminal, and never sent again. */
  CONFIRMED: "CONFIRMED",
  /** The server said no, for a reason retrying will not change. Terminal, and needs a human. */
  REJECTED: "REJECTED",
  /** The attempt failed in a way that may succeed later. Retryable. */
  FAILED: "FAILED",
});

export const TERMINAL_STATES = Object.freeze([SUBMISSION_STATE.CONFIRMED, SUBMISSION_STATE.REJECTED]);

export const SUBMISSION_STATE_TEXT = Object.freeze({
  [SUBMISSION_STATE.PENDING]: "Waiting to send.",
  // The wording matters more than anything else in this module.
  [SUBMISSION_STATE.UNVERIFIED]: "Sent, but not confirmed yet — do not assume it is done.",
  [SUBMISSION_STATE.CONFIRMED]: "Confirmed.",
  [SUBMISSION_STATE.REJECTED]: "Refused — this needs sorting out before it can go again.",
  [SUBMISSION_STATE.FAILED]: "Could not send. It will try again.",
});

/**
 * Error codes that mean "this will never work by retrying".
 *
 * Everything NOT on this list is treated as retryable, which is the safe direction: retrying a
 * transient failure costs one request, while giving up on one loses the operator's work.
 */
export const TERMINAL_ERROR_CODES = Object.freeze([
  "permission-denied",
  "invalid-argument",
  "failed-precondition",
  "not-found",
  "unauthenticated",
]);

/**
 * The largest number of submissions sent in one pass.
 *
 * Deliberately small. A phone coming out of a dead zone with forty queued stows should not open
 * forty concurrent requests on a connection that is barely back — that is how a marginal link is
 * turned into a failed one, and how a server sees a burst indistinguishable from an attack.
 */
export const MAX_BATCH = 5;

const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Create a queue entry.
 *
 * @param callable       the name of the callable to invoke. Opaque to this module.
 * @param payload        the request. NEVER read, only carried.
 * @param idempotencyKey the operation's OWN key — the same one the command derives its id from, so
 *                       a replay lands on the same document rather than a second one.
 */
export function makeSubmission({ callable, payload, idempotencyKey, describe = null, at = 0 } = {}) {
  if (!isNonBlank(callable)) return { valid: false, reason: "callable_required" };
  if (!isNonBlank(idempotencyKey)) return { valid: false, reason: "idempotency_key_required" };
  return {
    valid: true,
    value: Object.freeze({
      callable,
      payload: payload ?? null,
      idempotencyKey,
      /** A short human label, so a queue of pending work is legible without decoding payloads. */
      describe: isNonBlank(describe) ? describe : callable,
      state: SUBMISSION_STATE.PENDING,
      attempts: 0,
      lastError: null,
      queuedAt: at,
      updatedAt: at,
    }),
  };
}

/**
 * Which submissions to send now.
 *
 * PENDING and FAILED are sendable. UNVERIFIED is NOT re-sent automatically: we do not know whether
 * the first attempt landed, and hammering an unknown is how one stow becomes two. Resolving an
 * UNVERIFIED submission is a deliberate act — see `resolveUnverified`.
 */
export function nextBatch(queue, { limit = MAX_BATCH } = {}) {
  return Object.freeze(
    (queue ?? [])
      .filter((s) => s.state === SUBMISSION_STATE.PENDING || s.state === SUBMISSION_STATE.FAILED)
      .slice(0, Math.max(0, limit)),
  );
}

/** Has this key already been confirmed? A confirmed group is never sent again. */
export function isAlreadyConfirmed(queue, idempotencyKey) {
  return (queue ?? []).some(
    (s) => s.idempotencyKey === idempotencyKey && s.state === SUBMISSION_STATE.CONFIRMED,
  );
}

/** Add a submission, refusing a duplicate key that is already confirmed or in flight. */
export function enqueue(queue, submission) {
  const existing = (queue ?? []).find((s) => s.idempotencyKey === submission.idempotencyKey);
  // A key already in the queue IS the same operation. Adding it twice would create two records of
  // one physical act, which is exactly what the derived ids exist to prevent.
  if (existing) return Object.freeze([...(queue ?? [])]);
  return Object.freeze([...(queue ?? []), submission]);
}

const replace = (queue, key, next) =>
  Object.freeze((queue ?? []).map((s) => (s.idempotencyKey === key ? Object.freeze(next(s)) : s)));

/** Mark a submission as sent-but-unanswered. */
export function markUnverified(queue, idempotencyKey, at = 0) {
  return replace(queue, idempotencyKey, (s) => ({
    ...s,
    state: SUBMISSION_STATE.UNVERIFIED,
    attempts: s.attempts + 1,
    updatedAt: at,
  }));
}

/** The server said yes. Terminal. */
export function markConfirmed(queue, idempotencyKey, at = 0) {
  return replace(queue, idempotencyKey, (s) => ({
    ...s,
    state: SUBMISSION_STATE.CONFIRMED,
    lastError: null,
    updatedAt: at,
  }));
}

/**
 * The attempt failed. Whether that is terminal depends on WHY.
 *
 * A refusal will not become an acceptance by trying again, and retrying it forever would bury the
 * one submission that needs a human among ones that do not.
 */
export function markFailed(queue, idempotencyKey, errorCode, at = 0) {
  const terminal = TERMINAL_ERROR_CODES.includes(errorCode);
  return replace(queue, idempotencyKey, (s) => ({
    ...s,
    state: terminal ? SUBMISSION_STATE.REJECTED : SUBMISSION_STATE.FAILED,
    attempts: s.attempts + 1,
    lastError: errorCode ?? "unknown",
    updatedAt: at,
  }));
}

/**
 * Resolve an UNVERIFIED submission against what the server actually holds.
 *
 * THIS IS THE RECONNECTION STEP, and it is a READ, never a blind re-send. `serverHasIt` is the
 * caller's answer to "does a record with this idempotency key exist?" — asked through whatever read
 * that domain has.
 *
 * `null` means the caller could not find out. That stays UNVERIFIED: not knowing is its own answer,
 * and turning it into either "done" or "failed" would be a guess with a warehouse on the other end.
 */
export function resolveUnverified(queue, idempotencyKey, serverHasIt, at = 0) {
  if (serverHasIt === null || serverHasIt === undefined) return Object.freeze([...(queue ?? [])]);
  return serverHasIt
    ? markConfirmed(queue, idempotencyKey, at)
    : replace(queue, idempotencyKey, (s) => ({
        // It never landed, so it is safe to send again — and the derived id means a late-arriving
        // first attempt would write the same document anyway.
        ...s,
        state: SUBMISSION_STATE.PENDING,
        updatedAt: at,
      }));
}

/** Drop terminal work, so a queue does not grow forever. Rejections are kept: they need a human. */
export function pruneConfirmed(queue) {
  return Object.freeze((queue ?? []).filter((s) => s.state !== SUBMISSION_STATE.CONFIRMED));
}

/**
 * What to show the operator.
 *
 * `settled` is deliberately NOT reported as a single "done" count next to the others: a rejection is
 * not a completion, and a queue summary that adds them together would let one refusal hide inside
 * a tally of successes.
 */
export function summarize(queue) {
  const all = queue ?? [];
  const count = (state) => all.filter((s) => s.state === state).length;
  return Object.freeze({
    pending: count(SUBMISSION_STATE.PENDING) + count(SUBMISSION_STATE.FAILED),
    unverified: count(SUBMISSION_STATE.UNVERIFIED),
    confirmed: count(SUBMISSION_STATE.CONFIRMED),
    rejected: count(SUBMISSION_STATE.REJECTED),
    /** True while anything is not yet settled — the operator has unfinished business. */
    outstanding: all.some((s) => !TERMINAL_STATES.includes(s.state)),
  });
}

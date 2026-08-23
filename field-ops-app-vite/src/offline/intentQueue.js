// THE QUEUE — what may go, in what order, and what one failure is allowed to stop.
//
// PURE. No storage, no clock, no network. Given a queue and a time it says what to send; it never
// sends anything and never decides whether a thing is authorized. That is the executor's job, using
// the server's answer.
//
// ============================ TWO KINDS OF DEPENDENCY ============================
//
// A dependency edge carries `required: true | false`, and the difference is the most load-bearing
// decision in this file.
//
//   REQUIRED (`required: true`) — a REQUIREMENT. The dependent must not be sent unless the dependency
//   SUCCEEDED. The one real instance in V1 is EQUIPMENT_INSTALL -> WORK_ORDER_COMPLETE: a completed
//   installation job whose installation never happened is a lie about a machine at a customer site,
//   and the whole install-first ordering exists to make it unreachable. A required dependency that
//   fails blocks its dependent permanently, and the dependent says so.
//
//   OPTIONAL (`required: false`) — a SEQUENCING edge. Notes, labor and parts usage before completion.
//   Completion does NOT require them: a technician who wrote no note has still finished the job, and
//   blocking completion on an absent note would be inventing a business rule nobody asked for.
//
// But an optional dependency is NOT ignored, and here is why. `recordWorkOrderLabor` and
// `updateWorkOrderExecutionData` are both refused once a Work Order leaves execution. So sending
// Complete while labor is still queued does not merely reorder two requests — it makes the labor
// request PERMANENTLY IMPOSSIBLE, and a technician's hours end up needing a manager's correction.
//
// So an optional dependency blocks its dependent WHILE THE DEPENDENCY IS STILL LIVE — still pending,
// still retrying, still capable of succeeding — and stops blocking the moment it lands in a state
// that needs a person. Completion waits for work that might still land. It does not wait forever for
// work that has already stopped.
//
// This is deliberately stricter than "do not block completion on optional notes", and the reason is
// written here so a later reader can disagree with it knowingly rather than by accident.
//
// ============================ ORDER IS DERIVED, NEVER INHERITED ============================
//
// Nothing here depends on array insertion order, on the order a component rendered, or on the order
// a hook happened to fire. Order comes from the dependency graph first, then from a declared type
// precedence, and only then from the capture clock as a tie-breaker. A future refactor that changes
// when a component mounts therefore cannot reorder business effects.
import { SYNC_STATE } from "../domain/technicianHandheld.js";
import { INTENT_PRECEDENCE, needsAttention } from "./technicianIntent.js";

/** Why an intent is not being sent right now. */
export const HOLD_REASON = Object.freeze({
  /** A required dependency has not succeeded yet. */
  AWAITING_REQUIRED: "AWAITING_REQUIRED",
  /** A required dependency failed. Nothing will send this without a person. */
  BLOCKED_BY_FAILED_REQUIREMENT: "BLOCKED_BY_FAILED_REQUIREMENT",
  /** An optional dependency may still succeed, and must go first while it can. */
  AWAITING_SEQUENCED: "AWAITING_SEQUENCED",
  /** Backing off after a retryable failure. */
  BACKOFF: "BACKOFF",
  /** Already settled, or already waiting on a person. */
  NOT_SENDABLE: "NOT_SENDABLE",
});

/** States from which an intent may still be attempted. */
const SENDABLE_STATES = Object.freeze([SYNC_STATE.PENDING_SYNC]);

/** Still capable of succeeding on its own — has not stopped and does not need a person. */
export const isLive = (intent) =>
  intent?.state === SYNC_STATE.PENDING_SYNC || intent?.state === SYNC_STATE.SYNCING;

const byId = (queue) => new Map((queue ?? []).map((i) => [i.intentId, i]));

/**
 * May this intent be sent now, and if not, why?
 *
 * A dependency that is not in the queue at all is treated as SATISFIED. That is not a shrug: an
 * intent whose dependency already synced and was pruned is exactly this case, and the alternative —
 * blocking forever on an id nobody can find — would strand real work behind successful work.
 */
export function evaluateIntent(intent, queue, now = 0) {
  if (!SENDABLE_STATES.includes(intent?.state)) {
    return { sendable: false, reason: HOLD_REASON.NOT_SENDABLE };
  }
  if ((intent.nextEligibleAt ?? 0) > now) {
    return { sendable: false, reason: HOLD_REASON.BACKOFF, until: intent.nextEligibleAt };
  }
  const index = byId(queue);
  for (const edge of intent.dependsOn ?? []) {
    const dep = index.get(edge.intentId);
    if (!dep) continue; // Absent means already settled and pruned. See the note above.
    if (dep.state === SYNC_STATE.SYNCED) continue;

    if (edge.required) {
      return needsAttention(dep)
        ? { sendable: false, reason: HOLD_REASON.BLOCKED_BY_FAILED_REQUIREMENT, blockedBy: dep.intentId }
        : { sendable: false, reason: HOLD_REASON.AWAITING_REQUIRED, blockedBy: dep.intentId };
    }
    // Optional: yield only while the dependency can still land. Once it has stopped, it stops
    // holding anything up — a note that will never send must not strand a finished job.
    if (isLive(dep)) {
      return { sendable: false, reason: HOLD_REASON.AWAITING_SEQUENCED, blockedBy: dep.intentId };
    }
  }
  return { sendable: true, reason: null };
}

/**
 * Everything sendable right now, in the order it must go.
 *
 * Sorted by dependency depth first — an intent can never sort ahead of something it depends on, no
 * matter what its type precedence says — then by type precedence, then by capture time, then by id.
 * The final tie-break on id exists so the order is TOTAL and therefore reproducible: two intents
 * captured in the same millisecond must not swap places between runs.
 */
export function readyIntents(queue, now = 0) {
  const index = byId(queue);
  const depthOf = (intent, seen = new Set()) => {
    if (seen.has(intent.intentId)) return 0; // A cycle cannot be ordered; treat it as flat and let
    seen.add(intent.intentId);                // the requirement check refuse to send it.
    let max = 0;
    for (const edge of intent.dependsOn ?? []) {
      const dep = index.get(edge.intentId);
      if (dep) max = Math.max(max, 1 + depthOf(dep, seen));
    }
    return max;
  };
  return Object.freeze(
    (queue ?? [])
      .filter((i) => evaluateIntent(i, queue, now).sendable)
      .map((i) => ({ intent: i, depth: depthOf(i) }))
      .sort((a, b) =>
        a.depth - b.depth
        || (INTENT_PRECEDENCE[a.intent.type] ?? 50) - (INTENT_PRECEDENCE[b.intent.type] ?? 50)
        || (a.intent.createdAtLocal ?? 0) - (b.intent.createdAtLocal ?? 0)
        || a.intent.intentId.localeCompare(b.intent.intentId))
      .map((e) => e.intent),
  );
}

/** Add an intent. A key already present IS the same act — adding it twice would record one act twice. */
export function enqueueIntent(queue, intent) {
  if ((queue ?? []).some((i) => i.intentId === intent.intentId)) return Object.freeze([...(queue ?? [])]);
  return Object.freeze([...(queue ?? []), intent]);
}

const replace = (queue, intentId, next) =>
  Object.freeze((queue ?? []).map((i) => (i.intentId === intentId ? Object.freeze(next(i)) : i)));

export function markSyncing(queue, intentId, at = 0) {
  return replace(queue, intentId, (i) => ({ ...i, state: SYNC_STATE.SYNCING, lastAttemptAt: at }));
}

/**
 * The server accepted it. Terminal, and the only state allowed to claim the work is real.
 *
 * `resultingServerIds` is what makes an intent auditable afterwards: "this queued install became that
 * Equipment record". Without it, a synced intent is an assertion with nothing behind it.
 */
export function markSynced(queue, intentId, { serverIds = null, at = 0 } = {}) {
  return replace(queue, intentId, (i) => ({
    ...i,
    state: SYNC_STATE.SYNCED,
    attemptCount: i.attemptCount + 1,
    lastAttemptAt: at,
    lastServerError: null,
    nextEligibleAt: 0,
    resultingServerIds: serverIds ? Object.freeze({ ...serverIds }) : null,
  }));
}

/** Put a stopped intent back in play — a deliberate act by a person, never automatic. */
export function retryIntent(queue, intentId, at = 0) {
  return replace(queue, intentId, (i) => ({
    ...i, state: SYNC_STATE.PENDING_SYNC, attemptCount: 0, nextEligibleAt: at, lastServerError: null,
  }));
}

/** Drop an intent a person has decided against. Only ever called from an explicit discard. */
export function discardIntent(queue, intentId) {
  return Object.freeze((queue ?? []).filter((i) => i.intentId !== intentId));
}

/**
 * Forget SYNCED intents, so a device's queue does not grow for the life of the phone.
 *
 * Attention states are KEPT. They are the whole point of a queue a person can see, and pruning them
 * would quietly delete the only record that a technician's work was refused.
 */
export function pruneSynced(queue) {
  return Object.freeze((queue ?? []).filter((i) => i.state !== SYNC_STATE.SYNCED));
}

/**
 * What the technician is told, in one object.
 *
 * `unsynced` deliberately counts everything that has not landed, including the things that need a
 * person — a queue summary that reported only the healthy pending work would let a refusal hide
 * behind a reassuring number.
 */
export function summarizeQueue(queue) {
  const all = queue ?? [];
  const count = (state) => all.filter((i) => i.state === state).length;
  const attention = all.filter(needsAttention);
  return Object.freeze({
    pending: count(SYNC_STATE.PENDING_SYNC),
    syncing: count(SYNC_STATE.SYNCING),
    synced: count(SYNC_STATE.SYNCED),
    conflicted: count(SYNC_STATE.CONFLICT),
    refused: count(SYNC_STATE.REFUSED),
    needsAttention: count(SYNC_STATE.NEEDS_ATTENTION),
    /** Anything at all that is not on the server. The number Home shows. */
    unsynced: all.filter((i) => i.state !== SYNC_STATE.SYNCED).length,
    /** Anything a person has to deal with. Reported separately — it is not "pending". */
    attentionCount: attention.length,
    attentionWorkOrderIds: Object.freeze([...new Set(attention.map((i) => i.workOrderId))]),
  });
}

/**
 * The queue as diagnostics — ids, states, attempts, error codes. No payloads.
 *
 * Support staff need to answer "my work will not sync", which needs the shape of the failure, not its
 * contents. Payloads carry customer names, site details and serial numbers, and none of that belongs
 * in a diagnostic somebody pastes into a chat window.
 */
export function diagnosticView(queue) {
  return Object.freeze((queue ?? []).map((i) => Object.freeze({
    intentId: i.intentId,
    type: i.type,
    workOrderId: i.workOrderId,
    state: i.state,
    attemptCount: i.attemptCount,
    lastAttemptAt: i.lastAttemptAt,
    nextEligibleAt: Number.isFinite(i.nextEligibleAt) ? i.nextEligibleAt : null,
    lastErrorCode: i.lastServerError?.code ?? null,
    lastErrorDetails: i.lastServerError?.details ?? null,
    resultingServerIds: i.resultingServerIds ?? null,
    dependsOn: (i.dependsOn ?? []).map((d) => `${d.intentId}${d.required ? "" : "?"}`),
  })));
}

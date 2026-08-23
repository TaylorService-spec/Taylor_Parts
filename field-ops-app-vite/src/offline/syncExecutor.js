// THE SYNC EXECUTOR — what happens when the signal comes back.
//
// ============================ OFFLINE PERMISSION IS NOT PERMISSION ============================
//
// The single most important property of this file: an intent captured at 09:00 is authorized at the
// moment it is SENT, not at the moment it was captured. A technician removed from a job at 11:00 does
// not get to complete it at 13:00 because their phone was in a basement in between.
//
// That recheck is NOT performed here, and could not honestly be. Every command this runtime calls
// resolves the caller's capability on the server, inside its own transaction, against current
// roleAssignments — `recordWorkOrderLabor` reads authority THROUGH the transaction precisely so a
// revocation mid-flight conflicts the commit rather than being missed. A client-side capability check
// would be a second, weaker, staler opinion, and the only thing it could add is false confidence.
//
// So what this file does is make sure the server GETS THE CHANCE to say no: it never replays a stored
// authorization, never caches an allow, and sends every intent as a fresh authenticated request whose
// refusal is believed.
//
// `refreshAuthority` exists as an injected seam for clients that keep a cached capability projection
// and want it re-read before a batch. It is an OPTIMIZATION — it can spare a doomed request — and it
// is never the thing that makes a decision.
//
// ============================ THE PRECHECK IS ALSO NOT THE AUTHORITY ============================
//
// Several bindings supply a `precheck` that re-reads current server state before submitting. It has
// two legitimate uses: recognising work the server ALREADY holds (a lost response, §17), and avoiding
// a request that is certain to be refused (§10, a reassigned job).
//
// It is never a substitute for the command's own refusal. A precheck that passes and a command that
// refuses is a normal race, and the command wins.
//
// ============================ ONE PASS, ORDERED, ISOLATED ============================
//
// A pass takes everything ready, in dependency order, and stops on nothing. A conflict on one Work
// Order must not hold up an unrelated Work Order — the queue is one list, but the dependency graph is
// the only thing that couples any two entries in it, so unrelated work simply never meets.
import {
  readyIntents, markSyncing, markSynced, summarizeQueue,
} from "./intentQueue.js";
import { applyFailure, FAILURE_CLASS } from "./syncFailureClassification.js";
import { SYNC_STATE } from "../domain/technicianHandheld.js";

/** Why a whole pass did not run. A pass that does nothing says which nothing it did. */
export const PASS_OUTCOME = Object.freeze({
  RAN: "RAN",
  /** Nobody is signed in. Not a failure — there is simply no authority to send under. */
  NO_SESSION: "NO_SESSION",
  /** Signed in as somebody else. The queue is not theirs and is not touched. */
  PRINCIPAL_MISMATCH: "PRINCIPAL_MISMATCH",
  /** Nothing was eligible: all settled, all blocked, or all backing off. */
  NOTHING_READY: "NOTHING_READY",
});

/**
 * The largest number of intents sent in one pass.
 *
 * Small, and for the same reason the warehouse queue's batch is small: a phone coming out of a dead
 * zone with a day of queued work should not open twenty requests on a connection that has barely
 * returned. That is how a marginal link is turned into a failed one.
 */
export const MAX_PASS = 5;

const nowOr = (fn) => (typeof fn === "function" ? fn() : 0);

/**
 * Run one synchronisation pass.
 *
 * @param queue            the current queue.
 * @param principalUid     whose queue this is.
 * @param deps.session     () => ({ uid }) | null. The CURRENT session, re-read every pass.
 * @param deps.commands    { [INTENT_TYPE]: (intent, ctx) => Promise<Outcome> } — the canonical command.
 * @param deps.prechecks   { [INTENT_TYPE]: (intent, ctx) => Promise<Precheck> } — optional.
 * @param deps.refreshAuthority optional; awaited once before the batch. Advisory only.
 * @param deps.now         () => millis, server-independent local clock for backoff arithmetic.
 * @param deps.onProgress  called with the queue after every individual change, so a screen updates as
 *                         work lands rather than all at once when the pass finishes.
 *
 * Outcome from a command is one of:
 *   { ok: true, serverIds?, replayed? }            accepted (or recognised as already accepted)
 *   { ok: false, code?, details?, offline? }       refused, conflicted, or unreachable
 */
export async function runSyncPass(queue, { principalUid, deps = {} } = {}) {
  const { session, commands = {}, prechecks = {}, refreshAuthority, now, onProgress } = deps;

  const current = typeof session === "function" ? await session() : null;
  if (!current?.uid) return { outcome: PASS_OUTCOME.NO_SESSION, queue, sent: 0 };
  // The queue belongs to whoever built it. A different signed-in user does not inherit it, does not
  // see it, and above all does not send it under their own authority.
  if (current.uid !== principalUid) return { outcome: PASS_OUTCOME.PRINCIPAL_MISMATCH, queue, sent: 0 };

  const at = nowOr(now);
  const batch = readyIntents(queue, at).slice(0, MAX_PASS);
  if (batch.length === 0) return { outcome: PASS_OUTCOME.NOTHING_READY, queue, sent: 0 };

  if (typeof refreshAuthority === "function") {
    // Advisory. A failure to refresh is not a reason to stop: the server decides anyway.
    try { await refreshAuthority(); } catch { /* the commands still ask on their own behalf */ }
  }

  let working = queue;
  let sent = 0;
  const emit = () => { if (typeof onProgress === "function") onProgress(working); };

  for (const intent of batch) {
    // Re-evaluated against the LIVE working queue, not the snapshot the batch was chosen from. An
    // intent whose required dependency just failed earlier in this same pass must not now be sent.
    const stillReady = readyIntents(working, nowOr(now)).some((i) => i.intentId === intent.intentId);
    if (!stillReady) continue;

    working = markSyncing(working, intent.intentId, nowOr(now));
    emit();

    const ctx = { principalUid, sessionUid: current.uid, at: nowOr(now) };
    let outcome;
    let sending = intent;
    try {
      // Step one: does the server already hold this, or is it certain to refuse?
      const precheck = typeof prechecks[intent.type] === "function"
        ? await prechecks[intent.type](intent, ctx)
        : null;

      // A precheck may RESOLVE an identifier the device could only capture raw — a scanned serial
      // becoming a serialized asset id. The resolution is written back onto the queued intent so it
      // survives to the next attempt and appears in diagnostics: an intent that resolved to a
      // machine, and then resolved to a different one on a later pass, is a fact somebody needs to
      // be able to see rather than a difference that quietly disappears.
      if (precheck?.resolve) {
        working = resolvePayload(working, intent.intentId, precheck.resolve);
        sending = working.find((i) => i.intentId === intent.intentId) ?? intent;
        emit();
      }

      if (precheck?.alreadySatisfied) {
        // §17: a lost response is not a reason to act twice. The server's state already matches what
        // this intent intended, so it is reconciled as done rather than transitioned again.
        outcome = { ok: true, serverIds: precheck.serverIds ?? null, replayed: true };
      } else if (precheck && precheck.proceed === false) {
        outcome = { ok: false, code: precheck.code ?? null, details: precheck.details ?? null };
      } else {
        const command = commands[intent.type];
        if (typeof command !== "function") {
          // An intent type with no bound command is a build error, not a technician's problem. It
          // must never be silently dropped — it goes to a person.
          outcome = { ok: false, code: "failed-precondition", details: "NO_COMMAND_BOUND" };
        } else {
          outcome = await command(sending, ctx);
        }
      }
    } catch (err) {
      // A thrown transport error is treated as unreachable rather than refused. We were not told no;
      // we were not told anything.
      outcome = { ok: false, code: err?.code ?? null, details: err?.details ?? null, offline: true };
    }

    if (outcome?.ok) {
      working = markSynced(working, intent.intentId, { serverIds: outcome.serverIds ?? null, at: nowOr(now) });
      sent += 1;
    } else {
      working = applyFailureTo(working, intent.intentId, outcome, nowOr(now));
    }
    emit();
  }

  return { outcome: PASS_OUTCOME.RAN, queue: working, sent, summary: summarizeQueue(working) };
}

/**
 * Write a precheck's resolution onto the queued intent.
 *
 * The intent id is UNCHANGED — it is the identity of the ACT, and resolving which machine the act
 * refers to does not make it a different act. The fingerprint is deliberately NOT recomputed for the
 * same reason: it describes what the technician intended, and this is the platform's answer about
 * what they were pointing at, recorded separately as `resolvedBySync`.
 */
function resolvePayload(queue, intentId, resolution) {
  return Object.freeze(queue.map((i) => (i.intentId === intentId
    ? Object.freeze({
        ...i,
        payload: Object.freeze({ ...i.payload, ...resolution }),
        resolvedBySync: Object.freeze({ ...resolution }),
      })
    : i)));
}

function applyFailureTo(queue, intentId, outcome, at) {
  return Object.freeze(queue.map((i) => (i.intentId === intentId
    ? applyFailure(i, {
        code: outcome?.code ?? null, details: outcome?.details ?? null,
        offline: outcome?.offline === true, at,
      })
    : i)));
}

/**
 * Drain the queue: passes until nothing more is ready.
 *
 * Bounded by `maxPasses`, because a pass that keeps producing newly-ready work is either genuinely
 * draining a backlog or is a loop, and from in here those look identical. The bound makes the second
 * one stop.
 *
 * Note what this does NOT do: it does not wait out backoff. An intent that failed retryably during
 * this drain has a future eligibility time, is not ready, and ends the drain. The next reconnection
 * or the next scheduled attempt picks it up — sitting in a loop burning battery until a five-minute
 * backoff expires is not synchronisation, it is a spin.
 */
export async function drainQueue(queue, { principalUid, deps = {}, maxPasses = 10 } = {}) {
  let working = queue;
  let totalSent = 0;
  let last = PASS_OUTCOME.NOTHING_READY;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const result = await runSyncPass(working, { principalUid, deps });
    working = result.queue;
    last = result.outcome;
    totalSent += result.sent;
    if (result.outcome !== PASS_OUTCOME.RAN || result.sent === 0) break;
  }
  return { queue: working, sent: totalSent, outcome: last, summary: summarizeQueue(working) };
}

/**
 * CONNECTIVITY — a hint, never a proof.
 *
 * `navigator.onLine` answers "does this device have a network interface that thinks it is attached".
 * It says nothing about whether our server is reachable, and it is famously true on a captive-portal
 * wifi that resolves nothing. Hotel wifi, plant-floor guest networks and half the sites a technician
 * visits behave exactly this way.
 *
 * So it is used for two things: deciding whether to bother ATTEMPTING a pass, and choosing what to
 * say on screen. The authoritative answer to "can we reach the platform" is always a real request
 * that either landed or did not.
 */
export function connectivityHint(nav) {
  if (!nav || typeof nav.onLine !== "boolean") return { likelyOnline: true, known: false };
  return { likelyOnline: nav.onLine, known: true };
}

/**
 * Should a pass be attempted at all?
 *
 * Deliberately biased toward trying. `navigator.onLine === false` is the one signal trustworthy in
 * the negative direction — a device that knows it has no interface really does have none — so it is
 * honoured. Everything else attempts, and lets the request answer the question.
 */
export function shouldAttemptSync(queue, { hint = { likelyOnline: true }, now = 0 } = {}) {
  if (hint.likelyOnline === false) return { attempt: false, reason: "device_reports_offline" };
  if (readyIntents(queue, now).length === 0) return { attempt: false, reason: "nothing_ready" };
  return { attempt: true, reason: null };
}

/** Is anything at all outstanding? The one question Home asks. */
export function hasUnsyncedWork(queue) {
  return (queue ?? []).some((i) => i.state !== SYNC_STATE.SYNCED);
}

export { FAILURE_CLASS };

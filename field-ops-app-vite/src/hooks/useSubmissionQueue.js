import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  enqueue as enqueueEntry,
  makeSubmission,
  markConfirmed,
  markFailed,
  markUnverified,
  nextBatch,
  pruneConfirmed,
  resolveUnverified,
  summarize,
  SUBMISSION_STATE,
} from "../domain/offlineSubmissionQueue.js";

// OFFLINE / RETRY — the queue, made durable and given a clock.
//
// All decisions live in the pure domain/offlineSubmissionQueue.js. This adds three things it cannot
// have: storage that survives the tab closing, a way to actually send, and a reconnection trigger.
//
// ============================ IT SURVIVES THE TAB ============================
//
// A phone that locks in a dead zone and gets its browser reclaimed must not lose a stow. The queue
// persists to localStorage under one key.
//
// A stored queue is REVIVED CAREFULLY: anything that was UNVERIFIED when the tab died is still
// unverified now — the answer did not arrive while nobody was listening — and anything mid-send is
// treated the same way. It is never revived as confirmed.
//
// ============================ SENDING IS THE CALLER'S ============================
//
// `invoke` is supplied by the caller: this hook never imports a transport, so it cannot be the place
// a new ungoverned call path appears. It knows a callable's NAME and an opaque payload, exactly as
// the pure queue does.

export const QUEUE_STORAGE_KEY = "eos.scan.submissionQueue";

function readStored(storage) {
  try {
    const raw = storage?.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return Object.freeze([]);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    return Object.freeze(
      parsed
        .filter((s) => s && typeof s.callable === "string" && typeof s.idempotencyKey === "string")
        .map((s) => Object.freeze({
          ...s,
          // A submission that was in flight when the tab died is UNVERIFIED, not confirmed and not
          // pending: we genuinely do not know, and reviving it as either would be a guess.
          state: s.state === SUBMISSION_STATE.CONFIRMED ? SUBMISSION_STATE.CONFIRMED : s.state,
        })),
    );
  } catch {
    // Corrupt or unavailable storage loses the queue, which is bad — but throwing on mount would
    // lose the whole screen, which is worse.
    return Object.freeze([]);
  }
}

function writeStored(storage, queue) {
  try {
    storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch { /* storage is a convenience, never a requirement */ }
}

/**
 * @param invoke        (callable, payload) => Promise — the caller's transport.
 * @param confirmExists (submission) => Promise<boolean|null> — optional. Answers "does the server
 *                      already hold this?" for reconnection. Returning null means "could not find
 *                      out", which keeps the submission UNVERIFIED rather than guessing.
 * @param deps          test seams: `storage`, `now`.
 */
export function useSubmissionQueue({ invoke, confirmExists, deps } = {}) {
  const storage = deps?.storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  // Stable across renders: an inline default would be a new function every render, invalidating
  // every callback below it -- including the one an effect might hold a reference to mid-flush.
  const injectedNow = deps?.now;
  const now = useCallback(() => (injectedNow ? injectedNow() : Date.now()), [injectedNow]);

  const [queue, setQueue] = useState(() => readStored(storage));
  const flushing = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // A MIRROR of the queue, kept in a ref.
  //
  // Sending is async and decides what to send from the CURRENT queue. Reading that from React state
  // inside an async loop reads a snapshot from before the loop started, which sends the same
  // submission twice. The ref is the only reliable "what is true right now" during a flush.
  const queueRef = useRef(queue);
  const apply = useCallback((next) => {
    queueRef.current = typeof next === "function" ? next(queueRef.current) : next;
    setQueue(queueRef.current);
    return queueRef.current;
  }, []);

  useEffect(() => { writeStored(storage, queue); }, [storage, queue]);

  const add = useCallback(({ callable, payload, idempotencyKey, describe }) => {
    const made = makeSubmission({ callable, payload, idempotencyKey, describe, at: now() });
    if (!made.valid) return false;
    apply((q) => enqueueEntry(q, made.value));
    return true;
  }, [now, apply]);

  /** Send what is sendable, one conservative batch. */
  const flush = useCallback(async () => {
    if (flushing.current || typeof invoke !== "function") return;
    flushing.current = true;
    try {
      const batch = nextBatch(queueRef.current);

      for (const submission of batch) {
        apply((q) => markUnverified(q, submission.idempotencyKey, now()));
        try {
          await invoke(submission.callable, submission.payload);
          if (!alive.current) return;
          apply((q) => markConfirmed(q, submission.idempotencyKey, now()));
        } catch (err) {
          if (!alive.current) return;
          const raw = typeof err?.code === "string" ? err.code : "";
          const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
          apply((q) => markFailed(q, submission.idempotencyKey, code, now()));
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [invoke, now, apply]);

  /**
   * Ask the server what it actually holds, for everything still UNVERIFIED.
   *
   * This is the reconnection step and it is a READ. Nothing is re-sent on the strength of a guess.
   */
  const reconcile = useCallback(async () => {
    if (typeof confirmExists !== "function") return;
    const unverified = queueRef.current.filter((s) => s.state === SUBMISSION_STATE.UNVERIFIED);

    for (const submission of unverified) {
      let answer = null;
      try {
        answer = await confirmExists(submission);
      } catch {
        // Could not find out. That stays unverified — see resolveUnverified.
        answer = null;
      }
      if (!alive.current) return;
      apply((q) => resolveUnverified(q, submission.idempotencyKey, answer, now()));
    }
  }, [confirmExists, now, apply]);

  const clearConfirmed = useCallback(() => apply((q) => pruneConfirmed(q)), [apply]);

  const summary = useMemo(() => summarize(queue), [queue]);

  return { queue, summary, add, flush, reconcile, clearConfirmed };
}

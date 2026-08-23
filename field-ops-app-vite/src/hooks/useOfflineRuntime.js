import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  createIntentStore, selectAdapter, LOAD_OUTCOME,
} from "../offline/localIntentStore.js";
import {
  enqueueIntent, summarizeQueue, retryIntent, discardIntent, pruneSynced, diagnosticView,
} from "../offline/intentQueue.js";
import {
  drainQueue, shouldAttemptSync, connectivityHint, hasUnsyncedWork,
} from "../offline/syncExecutor.js";
import { createTechnicianBindings } from "../offline/technicianCommandBindings.js";
import { syncIndicator } from "../offline/syncPresentation.js";

// THE OFFLINE RUNTIME, GIVEN A CLOCK, A SESSION AND SOMEWHERE TO WRITE.
//
// Every decision lives in src/offline/, all of it pure and all of it tested. This adds the three
// things it cannot have on its own: durable storage, the current session, and a reason to run.
//
// ============================ IT RUNS ON EVENTS, NOT ON A TIMER ============================
//
// There is no polling loop. A sync pass happens when something has actually changed: work was
// queued, the browser reported the network returning, or a person pressed Sync now. A phone in a
// pocket in a dead zone must not be woken every thirty seconds to fail — that is a battery cost paid
// by the technician for nothing.
//
// The browser's `online` event is a HINT that something changed, exactly like navigator.onLine. It is
// a reason to TRY. It is never evidence that the attempt will work.
//
// ============================ THE QUEUE FOLLOWS THE PRINCIPAL ============================
//
// Signing out does not delete queued work, and signing in as somebody else does not inherit it. The
// store is keyed by uid and the executor refuses to send a queue whose owner is not the current
// session, so both halves are enforced rather than assumed.

const EMPTY = Object.freeze([]);

export function useOfflineRuntime(deps = {}) {
  // NO AUTH CONTEXT MEANS NO PRINCIPAL, WHICH MEANS NO QUEUE — and emphatically not a crash. A
  // surface rendered outside the provider (a test harness, a future embed) must degrade to "there is
  // nobody signed in", because every other answer this hook could give would be about somebody.
  const uid = (useAuth() ?? {}).user?.uid ?? null;

  const [queue, setQueue] = useState(EMPTY);
  const [loadOutcome, setLoadOutcome] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [durable, setDurable] = useState(true);
  const [lastSaveProblem, setLastSaveProblem] = useState(null);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const store = useMemo(
    () => deps.store ?? createIntentStore({ adapter: selectAdapter(typeof window === "undefined" ? {} : window) }),
    [deps.store],
  );
  const bindings = useMemo(
    () => deps.bindings ?? createTechnicianBindings({ technicianId: deps.technicianId }),
    [deps.bindings, deps.technicianId],
  );
  const now = deps.now ?? (() => Date.now());
  const navigatorRef = deps.navigator ?? (typeof navigator === "undefined" ? null : navigator);

  // The queue is loaded for whoever is signed in NOW. A change of uid reloads from scratch rather
  // than filtering what is in memory — the previous person's work is not this person's to see.
  useEffect(() => {
    let cancelled = false;
    if (!uid) { setQueue(EMPTY); setLoadOutcome(null); return () => {}; }
    setDurable(store.durable);
    store.load(uid).then((result) => {
      if (cancelled || !alive.current) return;
      setLoadOutcome(result.outcome);
      setQueue(Object.freeze(result.record.intents ?? []));
    });
    return () => { cancelled = true; };
  }, [uid, store]);

  /** Persist, and report honestly when the device would not keep it. */
  const persist = useCallback(async (next) => {
    if (!uid) return { durable: false, reason: "no_session" };
    const result = await store.save(uid, { intents: next }, now());
    if (alive.current) setLastSaveProblem(result.durable ? null : result.reason);
    return result;
  }, [uid, store, now]);

  const session = useCallback(async () => (uid ? { uid } : null), [uid]);

  /**
   * Run a pass. Concurrency-guarded, because two passes over one queue would send twice.
   *
   * The guard is a ref rather than the `syncing` state: state updates are asynchronous, and two
   * rapid triggers — a reconnect and a save landing in the same tick — would both read `false`.
   */
  const running = useRef(false);
  const sync = useCallback(async (force = false) => {
    if (running.current || !uid) return null;
    const attempt = shouldAttemptSync(queue, { hint: connectivityHint(navigatorRef), now: now() });
    if (!force && !attempt.attempt) return attempt;

    running.current = true;
    if (alive.current) setSyncing(true);
    try {
      const result = await drainQueue(queue, {
        principalUid: uid,
        deps: {
          session,
          commands: bindings.commands,
          prechecks: bindings.prechecks,
          now,
          // Progress is shown as it happens: a technician watching five items sync should see them
          // land one at a time, not sit on a spinner and then jump.
          onProgress: (partial) => { if (alive.current) setQueue(partial); },
        },
      });
      if (alive.current) setQueue(result.queue);
      await persist(result.queue);
      return result;
    } finally {
      running.current = false;
      if (alive.current) setSyncing(false);
    }
  }, [uid, queue, bindings, session, persist, now, navigatorRef]);

  /**
   * Queue one intent.
   *
   * Returns whether it is DURABLE. The caller must not say "Pending sync" on a false — that phrase
   * promises the work is safe on the device, and on a phone with exhausted storage it would not be.
   */
  const enqueue = useCallback(async (intent) => {
    if (!intent?.valid && !intent?.intentId) return { queued: false, reason: intent?.reason ?? "invalid_intent" };
    const value = intent.value ?? intent;
    const next = enqueueIntent(queue, value);
    setQueue(next);
    const saved = await persist(next);
    return { queued: true, durable: saved.durable, reason: saved.reason, intentId: value.intentId };
  }, [queue, persist]);

  const retry = useCallback(async (intentId) => {
    const next = retryIntent(queue, intentId, now());
    setQueue(next);
    await persist(next);
    return sync(true);
  }, [queue, persist, now, sync]);

  const discard = useCallback(async (intentId) => {
    const next = discardIntent(queue, intentId);
    setQueue(next);
    await persist(next);
  }, [queue, persist]);

  /** Forget what has landed. Refusals are kept — see pruneSynced. */
  const clearSettled = useCallback(async () => {
    const next = pruneSynced(queue);
    setQueue(next);
    await persist(next);
  }, [queue, persist]);

  // The network coming back is the one moment worth reacting to. Nothing here polls.
  useEffect(() => {
    if (typeof window === "undefined" || !uid) return () => {};
    const onOnline = () => { sync(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [uid, sync]);

  const summary = useMemo(() => summarizeQueue(queue), [queue]);
  const hint = connectivityHint(navigatorRef);

  return {
    /** Whose queue this is. Capture surfaces stamp it onto every intent they build. */
    principalUid: uid,
    queue,
    summary,
    indicator: syncIndicator(summary, { durable: durable && !lastSaveProblem, online: hint.likelyOnline }),
    diagnostics: useMemo(() => diagnosticView(queue), [queue]),
    unsynced: hasUnsyncedWork(queue),
    syncing,
    durable: durable && !lastSaveProblem,
    saveProblem: lastSaveProblem,
    /** Set when local state could not be read — a corrupt or foreign record is not "no work". */
    loadProblem: loadOutcome && loadOutcome !== LOAD_OUTCOME.LOADED && loadOutcome !== LOAD_OUTCOME.EMPTY
      ? loadOutcome : null,
    enqueue,
    sync,
    retry,
    discard,
    clearSettled,
  };
}

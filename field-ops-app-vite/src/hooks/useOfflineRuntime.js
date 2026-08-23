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
  //
  // `disabled` is the other half of that: a surface whose runtime is PROVIDED from above still calls
  // this hook (hooks must be called unconditionally) but must not open a second queue over the same
  // storage key. See OfflineRuntimeContext.jsx for what that would have cost.
  const signedInUid = (useAuth() ?? {}).user?.uid ?? null;
  const uid = deps.disabled ? null : signedInUid;

  const [queue, setQueueState] = useState(EMPTY);

  // THE QUEUE'S LIVE VALUE, not the render-old one.
  //
  // Every mutator used to read `queue` from its closure. Two enqueues in the same tick — which is
  // exactly what capturing an installation and its dependent completion does — both read the SAME
  // pre-render snapshot, and the second persisted a queue built without the first. The installation
  // vanished, silently, with a "pending sync" on screen saying it had not.
  //
  // Found by integration, not by the runtime tests: every one of those enqueued through separate
  // awaited user actions, so no two ever landed in one tick.
  const queueRef = useRef(EMPTY);
  const setQueue = useCallback((next) => {
    queueRef.current = next;
    setQueueState(next);
  }, []);
  const [loadOutcome, setLoadOutcome] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [durable, setDurable] = useState(true);
  const [lastSaveProblem, setLastSaveProblem] = useState(null);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const store = useMemo(
    () => deps.store ?? createIntentStore({
      adapter: selectAdapter(typeof window === "undefined" ? {} : window),
      namespace: deps.namespace ?? undefined,
    }),
    [deps.store, deps.namespace],
  );
  // The bindings decide WHICH runtime this is. Technician by default because that is where the
  // runtime started; the warehouse passes its own. The queue, the store, the executor and the
  // failure classification are identical — the COMMAND SEMANTICS are not, and keeping them in
  // separate binding modules is what stops inventory rules being inherited from a work order.
  const bindings = useMemo(
    () => deps.bindings ?? createTechnicianBindings({ technicianId: deps.technicianId }),
    [deps.bindings, deps.technicianId],
  );

  // Separate storage namespace per runtime, so a technician's queue and a warehouse queue on the
  // same device under the same person never share a key and never overwrite each other.
  const namespace = deps.namespace ?? null;
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
      const loaded = result.record.intents ?? [];

      // MERGE, NEVER REPLACE. Reading from storage is asynchronous, and a technician can capture
      // something before it resolves -- open the app, tap straight into a note. Assigning the loaded
      // array over the top would delete work that was captured while we were reading, which is the
      // worst failure this runtime has: the entry was on screen, said pending, and is gone.
      //
      // Whatever is already in hand wins on a collision: it is strictly newer than what was on disk.
      const held = queueRef.current ?? [];
      if (held.length === 0) { setQueue(Object.freeze(loaded)); return; }
      const heldIds = new Set(held.map((i) => i.intentId));
      setQueue(Object.freeze([...loaded.filter((i) => !heldIds.has(i.intentId)), ...held]));
    });
    return () => { cancelled = true; };
  }, [uid, store, setQueue]);

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
    const attempt = shouldAttemptSync(queueRef.current, { hint: connectivityHint(navigatorRef), now: now() });
    if (!force && !attempt.attempt) return attempt;

    running.current = true;
    if (alive.current) setSyncing(true);
    try {
      // A PERSON PRESSING "SYNC NOW" CLEARS THE BACKOFF.
      //
      // Backoff exists to stop a phone hammering a dead link automatically. A technician deliberately
      // pressing the button is new information — they have walked outside, or watched the signal come
      // back — and making them wait out a five-minute doubling they cannot see is the app knowing
      // better than the person holding it. Automatic passes still respect it.
      if (force) {
        setQueue(Object.freeze(queueRef.current.map((i) => (
          i.state === "PENDING_SYNC" && (i.nextEligibleAt ?? 0) > 0
            ? Object.freeze({ ...i, nextEligibleAt: 0 })
            : i
        ))));
      }
      const result = await drainQueue(queueRef.current, {
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
  }, [uid, bindings, session, persist, now, navigatorRef, setQueue]);

  /**
   * Queue one intent.
   *
   * Returns whether it is DURABLE. The caller must not say "Pending sync" on a false — that phrase
   * promises the work is safe on the device, and on a phone with exhausted storage it would not be.
   */
  const enqueue = useCallback(async (intent) => {
    if (!intent?.valid && !intent?.intentId) return { queued: false, reason: intent?.reason ?? "invalid_intent" };
    const value = intent.value ?? intent;
    const next = enqueueIntent(queueRef.current, value);
    setQueue(next);
    const saved = await persist(next);
    return { queued: true, durable: saved.durable, reason: saved.reason, intentId: value.intentId };
  }, [persist, setQueue]);

  const retry = useCallback(async (intentId) => {
    const next = retryIntent(queueRef.current, intentId, now());
    setQueue(next);
    await persist(next);
    return sync(true);
  }, [persist, now, sync, setQueue]);

  const discard = useCallback(async (intentId) => {
    const next = discardIntent(queueRef.current, intentId);
    setQueue(next);
    await persist(next);
  }, [persist, setQueue]);

  /** Forget what has landed. Refusals are kept — see pruneSynced. */
  const clearSettled = useCallback(async () => {
    const next = pruneSynced(queueRef.current);
    setQueue(next);
    await persist(next);
  }, [persist, setQueue]);

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

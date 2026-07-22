// F-RULES-1 PR-B -- thin impure binding for trusted job completion. ALL
// semantics live in the pure src/domain/completionFlow.js (tested by
// test/completionFlow.test.mjs); this file only wires the real effects:
// the completeAssignedJob callable (region already fixed on the shared
// `functions` instance, us-central1, matching the backend), the
// authenticated uid (for storage scoping ONLY -- identity is resolved
// server-side from request.auth and is never sent in the request), and
// sessionStorage for the pending-attempt idempotency key so an attempt
// survives a page refresh mid-submit (ambiguous-result recovery).
//
// This service performs NO Firestore write: no jobActions import, no
// updateDoc/runTransaction/collection access. Completion mutates ONLY
// through the callable; technician availability and the audit event are
// written server-side, atomically, by the Function.
import { httpsCallable } from "firebase/functions";
import { functions, auth } from "../firebase/firebase";
import {
  COMPLETE_ASSIGNED_JOB,
  completionStorageKey,
  newIdempotencyKey,
  runCompletion,
  resolvePendingAttempt,
} from "../domain/completionFlow";

function storageFor() {
  // sessionStorage can throw in privacy modes; a null store degrades to
  // per-page-load in-memory keys (still correct, just loses refresh
  // recovery for the pending attempt).
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const memoryStore = new Map();

function keyStoreFor(uid, jobId) {
  const storageKey = completionStorageKey(uid, jobId);
  const store = storageFor();
  if (store) {
    return {
      get: () => store.getItem(storageKey),
      set: (k) => store.setItem(storageKey, k),
      clear: () => store.removeItem(storageKey),
    };
  }
  return {
    get: () => memoryStore.get(storageKey) ?? null,
    set: (k) => memoryStore.set(storageKey, k),
    clear: () => memoryStore.delete(storageKey),
  };
}

// Submit (or retry -- same pending key replays the same attempt) the
// trusted completion of the caller's own job. Returns completionFlow's
// plain outcome object; never throws.
export function completeAssignedJobViaCallable(jobId) {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return Promise.resolve({
      ok: false,
      kind: "auth",
      retainKey: true,
      refresh: false,
      message: "Your session has expired. Sign in again, then retry this completion.",
    });
  }
  const keys = keyStoreFor(uid, jobId);
  return runCompletion({
    jobId,
    call: (request) => httpsCallable(functions, COMPLETE_ASSIGNED_JOB)(request).then((res) => res?.data),
    getStoredKey: keys.get,
    storeKey: keys.set,
    clearKey: keys.clear,
    makeKey: () => newIdempotencyKey(() => crypto.randomUUID()),
  });
}

// True when a prior attempt's key is still pending for this uid+jobId
// (e.g. the page refreshed mid-submit) -- the UI uses this to run
// ambiguous-result reconciliation against the live job status instead of
// silently minting a new attempt.
export function hasPendingCompletionAttempt(jobId) {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  return keyStoreFor(uid, jobId).get() != null;
}

// Reconcile a pending attempt against authoritative job state
// (completionFlow.resolvePendingAttempt): complete -> reconciled success
// (release the key); in_progress -> retry-eligible (keep it); anything
// else -> halt (release it).
export function reconcilePendingCompletion(jobId, jobStatus) {
  const uid = auth.currentUser?.uid;
  if (!uid) return { resolution: "halt", clearKey: false };
  const outcome = resolvePendingAttempt(jobStatus);
  if (outcome.clearKey) keyStoreFor(uid, jobId).clear();
  return outcome;
}

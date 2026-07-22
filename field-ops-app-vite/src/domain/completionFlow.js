// F-RULES-1 PR-B -- pure client-side logic for trusted job completion via
// the completeAssignedJob callable (Decision #39; functions/src/
// completeAssignedJob.ts). PURE on purpose: no Firebase import, no DOM --
// every effect (the callable, key storage, randomness) is injected, so the
// whole contract is testable by the plain-node test runner
// (test/completionFlow.test.mjs), same convention as every other
// src/domain module.
//
// The backend contract this module must never violate:
//   request  = exactly { jobId, idempotencyKey }  (unknown fields REJECTED
//              server-side -- so this module makes them unrepresentable)
//   response = exactly { jobId, status: "complete", idempotentReplay }
//   idempotencyKey = 8-200 chars of [A-Za-z0-9_-]; it becomes the Audit
//              Event document id server-side, so the SAME key must be
//              reused for retries of the SAME completion attempt and a
//              fresh key minted only for a genuinely new attempt.
// `jobId` is the legacy fieldops_jobs document id. It is NOT the job's own
// `workOrderId` field (that is the job's separate upward link to a
// fieldops_wos Work Order) -- this module never reads or sends workOrderId.

export const COMPLETE_ASSIGNED_JOB = "completeAssignedJob";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

// One idempotency key per distinct completion INTENT. Derived from injected
// randomness (crypto.randomUUID in the real service), never from the clock
// alone and never from jobId alone; prefixed so a key is recognizable in
// the auditEvents collection without carrying any PII or secret.
export function newIdempotencyKey(randomUuid) {
  const uuid = String(randomUuid()).replace(/[^A-Za-z0-9_-]/g, "");
  const key = `cmpl-${uuid}`;
  if (!KEY_PATTERN.test(key)) {
    throw new Error("generated idempotencyKey failed validation");
  }
  return key;
}

export function isValidIdempotencyKey(key) {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

// sessionStorage scoping (gate section 4): authenticated user + jobId +
// operation -- one pending attempt survives a page refresh mid-submit
// (ambiguous-result recovery, section 8) and never leaks across users,
// jobs, or operations.
export function completionStorageKey(uid, jobId) {
  if (!uid || !jobId) throw new Error("completionStorageKey requires uid and jobId");
  return `${COMPLETE_ASSIGNED_JOB}:${uid}:${jobId}`;
}

// The ONLY request shape this client can produce -- exactly the two fields
// the callable accepts. No workOrderId, no technicianId, no role, no
// targetState, no caller identity: they are not parameters, so no caller
// of this function can smuggle them in.
export function buildCompletionRequest(jobId, idempotencyKey) {
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("jobId is required");
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new Error("idempotencyKey failed client-side validation");
  }
  return { jobId, idempotencyKey };
}

// Defensive response validation -- the UI trusts nothing it did not
// verify. A malformed response is treated as an ambiguous outcome (the
// server may or may not have committed), NOT as success.
export function validateCompletionResponse(data, jobId) {
  if (
    !data ||
    typeof data !== "object" ||
    data.jobId !== jobId ||
    data.status !== "complete" ||
    typeof data.idempotentReplay !== "boolean"
  ) {
    const err = new Error("unexpected completion response shape");
    err.ambiguousOutcome = true;
    throw err;
  }
  return { jobId: data.jobId, status: data.status, idempotentReplay: data.idempotentReplay };
}

// Stable, UI-safe error categories (gate section 10). `retainKey` is the
// idempotency contract: an UNRESOLVED attempt (transient/ambiguous/auth)
// keeps its key so a retry replays instead of double-completing; a
// RESOLVED attempt (authoritative rejection, conflict) releases it -- the
// backend burns a denied key permanently, so retrying a rejection needs a
// fresh key for a genuinely new attempt anyway.
export const COMPLETION_ERROR = Object.freeze({
  AUTH: "auth",
  REJECTED: "rejected",
  CONFLICT: "conflict",
  TRANSIENT: "transient",
});

const ERROR_MAP = {
  unauthenticated: {
    kind: COMPLETION_ERROR.AUTH,
    retainKey: true,
    refresh: false,
    message: "Your session has expired. Sign in again, then retry this completion.",
  },
  "permission-denied": {
    kind: COMPLETION_ERROR.REJECTED,
    retainKey: false,
    refresh: true,
    message: "This job can't be completed from this account.",
  },
  "invalid-argument": {
    kind: COMPLETION_ERROR.REJECTED,
    retainKey: false,
    refresh: true,
    message: "The completion request was invalid. Refresh and try again.",
  },
  "not-found": {
    kind: COMPLETION_ERROR.REJECTED,
    retainKey: false,
    refresh: true,
    message: "This job no longer exists or is unavailable.",
  },
  "failed-precondition": {
    kind: COMPLETION_ERROR.REJECTED,
    retainKey: false,
    refresh: true,
    message: "This job is no longer eligible for completion. Its current status will refresh.",
  },
  "already-exists": {
    kind: COMPLETION_ERROR.CONFLICT,
    retainKey: false,
    refresh: true,
    message: "This completion conflicts with an earlier attempt. The job status will refresh.",
  },
};

const TRANSIENT = {
  kind: COMPLETION_ERROR.TRANSIENT,
  retainKey: true,
  refresh: true,
  message: "Couldn't confirm the completion. Check your connection and retry -- it's safe to retry this same attempt.",
};

// `code` is the Firebase callable error code. Firebase JS SDK codes come
// prefixed ("functions/permission-denied"); accept both forms. Anything
// unrecognized (unavailable, deadline-exceeded, internal, network failure,
// aborted response) is TRANSIENT: the outcome is unknown, so the key is
// retained and the retry replays safely. Never surfaces raw backend detail.
export function mapCompletionError(code) {
  const bare = typeof code === "string" ? code.replace(/^functions\//, "") : "";
  return ERROR_MAP[bare] ?? TRANSIENT;
}

// Ambiguous-result recovery (gate section 8): after a transport failure or
// page refresh mid-submit, authoritative job state decides the attempt's
// fate. complete -> the earlier attempt succeeded (reconciled success,
// release the key); in_progress -> retry with the SAME key; anything else
// -> stop, show the authoritative state, release the key (deliberate
// abandonment of the attempt -- the state can never become eligible again).
export function resolvePendingAttempt(jobStatus) {
  if (jobStatus === "complete") return { resolution: "success", clearKey: true };
  if (jobStatus === "in_progress") return { resolution: "retry", clearKey: false };
  return { resolution: "halt", clearKey: true };
}

// The full submit orchestration, with every effect injected:
//   call(request)    -> invokes the callable, resolves with response data
//   getStoredKey()   -> pending key for this uid+jobId, or null
//   storeKey(key) / clearKey()
//   makeKey()        -> fresh key for a NEW attempt
// Returns a plain outcome object; throws nothing (the UI switches on it).
// The ONLY mutation-capable effect ever invoked is `call` -- this module
// has no path to Firestore, jobActions, or any direct write (the PR-B
// direct-write regression test asserts exactly that).
export async function runCompletion({ jobId, call, getStoredKey, storeKey, clearKey, makeKey }) {
  let key = getStoredKey();
  if (!isValidIdempotencyKey(key)) {
    key = makeKey();
    storeKey(key);
  }

  let data;
  try {
    data = await call(buildCompletionRequest(jobId, key));
  } catch (err) {
    const mapped = mapCompletionError(err && err.code);
    if (!mapped.retainKey) clearKey();
    return { ok: false, ...mapped };
  }

  try {
    const response = validateCompletionResponse(data, jobId);
    clearKey();
    return { ok: true, idempotentReplay: response.idempotentReplay };
  } catch {
    // Malformed response: outcome unknown -- keep the key, surface as
    // transient so the retry replays the same attempt.
    return { ok: false, ...TRANSIENT };
  }
}

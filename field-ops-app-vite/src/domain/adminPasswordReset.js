// AUTH-UI-2 (Authentication Modernization) -- pure, testable state for the
// admin-initiated password-reset UI. Extracted from any React renderer so it can
// be unit-tested without a DOM (matches the codebase's "pure logic lives in
// domain/" pattern, mirroring passwordRecovery.js).
//
// DECISIONS: #56 approves this design.
//  - D-DELIVERY-NATIVE (APPROVED): the backend sends via a Firebase-native path
//    whose only truthful signal is REQUEST_ACCEPTED. This module therefore has
//    NO "delivered" state and MUST NEVER render a delivery/open/consumption
//    claim (enforced by test).
//  - D-ROUTINE-REVOKE (NO): routine reset never revokes sessions; this UI only
//    drives the routine reset. Suspected-compromise revocation is a SEPARATE
//    governed action (its own permission/confirmation/audit) and is deliberately
//    NOT completed by this module.
//  - The routine backend is deliberately NEUTRAL: server-side target
//    ineligibility (no recoverable email, etc.) returns the SAME accepted result
//    as a genuine send (enumeration protection). So the accepted state carries a
//    neutral message that never confirms an account exists.
//
// This module performs NO Firebase SDK call, NO callable invocation of its own
// beyond the caller-injected `callable`, NO deployment, NO permission
// activation, and NO session revocation. Authorization is the backend's job
// (server-derived actor); the UI is not a security boundary.

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

// Routine is the only mode this UI drives to completion. suspectedCompromise is
// modeled for completeness but is a SEPARATE governed action (revocation) that
// this gate does not ship -- callers must treat it as unavailable here.
export const RESET_MODES = Object.freeze(["routine", "suspectedCompromise"]);
export const DEFAULT_MODE = "routine";

export function isModeSupportedHere(mode) {
  // Only routine reset is wired in AUTH-UI-2/3 (D-ROUTINE-REVOKE = NO; the
  // suspected-compromise revoke path is a separate governed action).
  return mode === "routine";
}

// ---------------------------------------------------------------------------
// Capability gate (fail-closed) -- whether the admin-reset SURFACE may exist
// ---------------------------------------------------------------------------

// The governed catalog id for admin-initiated credential reset. Byte-identical
// to the backend Permission id (access/permissionCatalog.ts:
// `admin.credentialReset.initiate`, registered `active: false`). The whole
// reset surface -- the eligible-user list read included -- is gated on the
// session EFFECTIVELY holding this capability, decided ONLY by the trusted
// effective-access feed (operationalContext.hasCapability), never by a raw
// role, nav visibility, or a client Role definition.
export const ADMIN_CREDENTIAL_RESET_INITIATE_CAPABILITY = "admin.credentialReset.initiate";

// Fail-closed by construction (mirrors equipmentCompatibilitySection's
// canViewCompatibility): the surface is permitted to exist ONLY when a real
// hasCapability previewer is supplied AND it returns an EXPLICIT `true` for the
// reset capability. Missing / null / non-function / THROWING previewer (a
// throwing previewer must hide the surface, never crash render), a
// `false`/undefined decision (inactive OR ungranted -- the catalog entry is
// `active: false` today, so this is always false), or any non-`true` truthy
// value ALL deny. This is a usability/UX gate; the backend command remains the
// security boundary and re-authorizes every call.
export function canInitiateAdminCredentialReset(hasCapability) {
  if (typeof hasCapability !== "function") return false;
  try {
    return hasCapability(ADMIN_CREDENTIAL_RESET_INITIATE_CAPABILITY) === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Terminal result states (what the UI may truthfully show)
// ---------------------------------------------------------------------------

// There is deliberately NO "delivered"/"sent-confirmed" state -- native delivery
// yields only REQUEST_ACCEPTED. CONFIGURATION_UNAVAILABLE is a client-known
// precondition (the callable is not deployed/enabled yet); SERVICE_UNAVAILABLE
// comes from the backend's `unavailable` code at runtime.
export const RESET_RESULT = Object.freeze({
  REQUEST_ACCEPTED: "request-accepted",
  DENIED: "denied",
  SERVICE_UNAVAILABLE: "service-unavailable",
  CONFIGURATION_UNAVAILABLE: "configuration-unavailable",
  UNCERTAIN: "uncertain",
});

const ALL_RESULTS = Object.freeze(Object.values(RESET_RESULT));
export function isResetResult(value) {
  return typeof value === "string" && ALL_RESULTS.includes(value);
}

// Neutral, sanitized copy. NONE of these may claim the email was delivered,
// opened, or consumed, and the accepted message must not confirm the account
// exists (enumeration protection). Enforced by test.
export const RESULT_COPY = Object.freeze({
  [RESET_RESULT.REQUEST_ACCEPTED]:
    "Request submitted. If the account is eligible, a password-reset email has been requested. " +
    "The user sets their own new password from that email.",
  [RESET_RESULT.DENIED]:
    "You are not able to perform this reset.",
  [RESET_RESULT.SERVICE_UNAVAILABLE]:
    "The password-reset service is temporarily unavailable. Please try again later.",
  [RESET_RESULT.CONFIGURATION_UNAVAILABLE]:
    "The admin password-reset service is not available in this environment.",
  [RESET_RESULT.UNCERTAIN]:
    "The outcome is unclear. Check the audit history before retrying, then retry with the same request.",
});

export function resultMessage(result) {
  return RESULT_COPY[result] ?? RESULT_COPY[RESET_RESULT.UNCERTAIN];
}

export function isSuccessResult(result) {
  return result === RESET_RESULT.REQUEST_ACCEPTED;
}

// SERVICE_UNAVAILABLE and UNCERTAIN invite an idempotent retry (same key).
// REQUEST_ACCEPTED (done), DENIED (actor not permitted), and
// CONFIGURATION_UNAVAILABLE (feature absent) are not retryable with the same key.
export function isRetryableResult(result) {
  return result === RESET_RESULT.SERVICE_UNAVAILABLE || result === RESET_RESULT.UNCERTAIN;
}

// ---------------------------------------------------------------------------
// Backend outcome/error -> result mapping (sanitized)
// ---------------------------------------------------------------------------

// The injected callable resolves to the backend's neutral outcome
// (`{ status: "accepted" }`) or throws a Firebase HttpsError-shaped error with a
// string `.code`. We map ONLY on that coarse code -- never on a message, path,
// link, token, email, or provider body (those never reach the client).
export function mapCallableOutcome(outcome) {
  if (outcome && typeof outcome === "object" && outcome.status === "accepted") {
    return RESET_RESULT.REQUEST_ACCEPTED;
  }
  // An unrecognized shape is treated as uncertain, never as success.
  return RESET_RESULT.UNCERTAIN;
}

// Firebase's callable SDK surfaces its FunctionsError.code NAMESPACED with a
// "functions/" prefix (e.g. "functions/permission-denied"), while the bare
// Cloud Functions status names ("permission-denied", "unavailable", ...) are
// what the switch below classifies. Normalize by stripping a single leading
// "functions/" so a real permission-denied is not misclassified as UNCERTAIN
// (fail-open drift). Only that exact known namespace is stripped; any other
// value passes through untouched (and unknown codes still map to UNCERTAIN).
const CALLABLE_CODE_NAMESPACE = "functions/";
export function normalizeCallableCode(code) {
  const raw = typeof code === "string" ? code : "";
  return raw.startsWith(CALLABLE_CODE_NAMESPACE) ? raw.slice(CALLABLE_CODE_NAMESPACE.length) : raw;
}

export function mapCallableError(error) {
  const code = normalizeCallableCode(error && error.code);
  switch (code) {
    case "unauthenticated":
    case "permission-denied":
    case "failed-precondition": // self-reset / protected / malformed -- all denied to the actor
    case "invalid-argument": // the caller's own bad input; nothing happened
      return RESET_RESULT.DENIED;
    case "unavailable": // delivery not configured OR transient stage failure OR cooldown
      return RESET_RESULT.SERVICE_UNAVAILABLE;
    case "aborted": // a reset for this key is already in progress
    case "already-exists": // key reused for a different request
    case "internal":
      return RESET_RESULT.UNCERTAIN;
    default:
      return RESET_RESULT.UNCERTAIN;
  }
}

// ---------------------------------------------------------------------------
// Target eligibility (pre-submit, from the sanitized list fields only)
// ---------------------------------------------------------------------------

// The client can gate ONLY what listResetEligibleUsers exposes
// (uid/displayName/role/hasEmployeeLink) plus self-target. Everything else
// (disabled, break-glass, missing Auth link, final-admin) is enforced
// SERVER-SIDE in AUTH-PR-3.5 and returns a neutral/denied result -- the UI must
// not pretend to know those. This gate is a usability filter, NOT the security
// boundary.
export const ELIGIBILITY_REASON = Object.freeze({
  SELF_TARGET: "self-target",
  MISSING_EMPLOYEE_LINK: "missing-employee-link",
});

export const ELIGIBILITY_REASON_COPY = Object.freeze({
  [ELIGIBILITY_REASON.SELF_TARGET]:
    "Use self-service password recovery to reset your own password.",
  [ELIGIBILITY_REASON.MISSING_EMPLOYEE_LINK]:
    "This account is not linked to an employee record and is not eligible here.",
});

export function deriveTargetEligibility(user, actorUid) {
  if (!user || typeof user.uid !== "string" || user.uid.length === 0) {
    return { eligible: false, reason: ELIGIBILITY_REASON.MISSING_EMPLOYEE_LINK };
  }
  if (typeof actorUid === "string" && actorUid.length > 0 && user.uid === actorUid) {
    return { eligible: false, reason: ELIGIBILITY_REASON.SELF_TARGET };
  }
  if (user.hasEmployeeLink !== true) {
    return { eligible: false, reason: ELIGIBILITY_REASON.MISSING_EMPLOYEE_LINK };
  }
  return { eligible: true, reason: null };
}

// Safe, sanitized identity summary for display -- never exposes email, tokens,
// claims, or a full user document.
export function describeTargetUser(user) {
  return {
    uid: typeof user?.uid === "string" ? user.uid : "",
    displayName: typeof user?.displayName === "string" ? user.displayName : null,
    role: typeof user?.role === "string" ? user.role : null,
    hasEmployeeLink: user?.hasEmployeeLink === true,
  };
}

// ---------------------------------------------------------------------------
// Bounded reason (client-side capture only; NOT part of the merged callable
// contract -- see AUTH-PR-3.5 before wiring into the payload)
// ---------------------------------------------------------------------------

export const REASON_MAX_LEN = 120;
const REASON_PATTERN = /^[A-Za-z0-9 ._:-]*$/;

export function sanitizeReasonCode(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return { ok: true, value: "" }; // optional
  if (value.length > REASON_MAX_LEN) {
    return { ok: false, error: `Reason must be at most ${REASON_MAX_LEN} characters.` };
  }
  if (!REASON_PATTERN.test(value)) {
    return { ok: false, error: "Reason may use letters, numbers, spaces, and . _ : - only." };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Idempotency key -- generated once per confirmed intent, reused on retry so a
// repeat is an idempotent replay (not a second reset). Matches the backend's
// ^[A-Za-z0-9._:-]{8,200}$ contract.
// ---------------------------------------------------------------------------

export function newIdempotencyKey(nowMs = Date.now(), rand = Math.random) {
  const ts = Math.floor(nowMs).toString(36);
  const r = Math.floor(rand() * 1e12).toString(36);
  const key = `apr.${ts}.${r}`;
  // Pad defensively to satisfy the 8-char minimum even for tiny inputs.
  return key.length >= 8 ? key : `${key}.00000000`.slice(0, 12);
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
export function isValidIdempotencyKey(key) {
  return typeof key === "string" && IDEMPOTENCY_KEY_PATTERN.test(key);
}

// ---------------------------------------------------------------------------
// Action-state machine: idle -> confirming -> submitting -> done(result)
// ---------------------------------------------------------------------------

export const ACTION_PHASE = Object.freeze({
  IDLE: "idle",
  CONFIRMING: "confirming",
  SUBMITTING: "submitting",
  DONE: "done",
});

export function initialActionState() {
  return { phase: ACTION_PHASE.IDLE, result: null };
}

// Open the confirmation step for an eligible target. A non-eligible target or an
// unsupported mode cannot enter confirmation.
export function beginConfirm(state, { eligible, mode = DEFAULT_MODE } = {}) {
  if (state.phase !== ACTION_PHASE.IDLE && state.phase !== ACTION_PHASE.DONE) return state;
  if (eligible !== true) return state;
  if (!isModeSupportedHere(mode)) return state;
  return { phase: ACTION_PHASE.CONFIRMING, result: null };
}

export function cancelConfirm(state) {
  if (state.phase !== ACTION_PHASE.CONFIRMING) return state;
  return { phase: ACTION_PHASE.IDLE, result: null };
}

export function markSubmitting(state) {
  if (state.phase !== ACTION_PHASE.CONFIRMING) return state;
  return { phase: ACTION_PHASE.SUBMITTING, result: null };
}

export function settle(state, result) {
  const safe = isResetResult(result) ? result : RESET_RESULT.UNCERTAIN;
  return { phase: ACTION_PHASE.DONE, result: safe };
}

// Accessibility hints for the current phase. Kept tiny and declarative so the
// renderer can spread them onto the status region. During submission the region
// is busy; results are announced politely; denials assertively.
export function ariaForState(state) {
  if (state.phase === ACTION_PHASE.SUBMITTING) {
    return { role: "status", "aria-live": "polite", "aria-busy": "true" };
  }
  if (state.phase === ACTION_PHASE.DONE) {
    const assertive = state.result === RESET_RESULT.DENIED;
    return { role: assertive ? "alert" : "status", "aria-live": assertive ? "assertive" : "polite", "aria-busy": "false" };
  }
  return { role: "status", "aria-live": "polite", "aria-busy": "false" };
}

// ---------------------------------------------------------------------------
// Controller: owns a SYNCHRONOUS in-flight lock (prevents overlapping sends and
// double-submit) and the idempotency key for the current intent (so a retry
// reuses the SAME key -> idempotent replay). The UI holds ONE instance.
// ---------------------------------------------------------------------------

// `callable(payload)` is the injected authorized client call. `payload` carries
// ONLY the four merged-contract fields (actorUid comes from the server context,
// never from here). submit() resolves to:
//   { skipped: "in_flight" }                         -- a send is already running
//   { ok:true,  result, idempotencyKey }             -- a completed attempt (any terminal result)
export function createAdminResetController(callable, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const rand = typeof options.rand === "function" ? options.rand : Math.random;
  let inFlight = false; // synchronous lock -- set before any await
  let currentKey = null; // reused across retries of the same intent

  return {
    // Begin a NEW intent (fresh idempotency key). Call once per confirmed target
    // before the first submit; retries of the same intent reuse the key.
    beginIntent() {
      currentKey = newIdempotencyKey(now(), rand);
      return currentKey;
    },
    getIdempotencyKey() {
      return currentKey;
    },
    async submit({ targetUid, mode = DEFAULT_MODE } = {}) {
      if (inFlight) return { skipped: "in_flight" };
      if (!isModeSupportedHere(mode)) {
        return { ok: true, result: RESET_RESULT.DENIED, idempotencyKey: currentKey };
      }
      if (!currentKey) currentKey = newIdempotencyKey(now(), rand);
      inFlight = true; // acquire synchronously, before awaiting the callable
      try {
        let outcome;
        try {
          outcome = await callable({ targetUid, mode, idempotencyKey: currentKey });
        } catch (err) {
          return { ok: true, result: mapCallableError(err), idempotencyKey: currentKey };
        }
        return { ok: true, result: mapCallableOutcome(outcome), idempotencyKey: currentKey };
      } finally {
        inFlight = false; // always release
      }
    },
    isInFlight() {
      return inFlight;
    },
  };
}

// Issue #325 / ADR-007 -- PURE glue for the trusted effective-access feed's client integration.
//
// The client asks Inventory's `resolveEffectiveAccess` callable (effectiveAccessFeedCallable.ts)
// for a DECISION on the wave-1 Report Builder capabilities, and gates nav visibility on the answer.
// This module holds the parts that need NO firebase (so they are node-testable): what to request,
// how to validate a callable result, and how to turn feed state into a fail-closed hasCapability.
// The firebase-calling hook lives in useReportCapabilities.js and delegates here.
//
// GOVERNANCE BOUNDARY: governed access comes ONLY from the callable's decisions. This module never
// reads users/{uid}.role, never inspects Role names, and never builds a Role definition -- a raw
// role can never confer a governed capability (that was the W1 correction; this keeps it true).
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES } from "./reportAccess.js";

// Request ONLY the wave-1 Report Builder capability ids -- never a broader or arbitrary set.
export const REPORT_CAPABILITY_REQUEST = REPORT_WAVE1_OBJECT_READ_CAPABILITIES;

// Feed status the hook moves through. hasCapability grants only in `ready`.
export const FEED_STATUS = Object.freeze({
  SIGNED_OUT: "signedOut",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error",
});

export const SIGNED_OUT_STATE = Object.freeze({ status: FEED_STATUS.SIGNED_OUT, forUid: null, decisions: null });

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Validate a raw callable payload ({ accessVersion, decisions }). Returns { ok:true, decisions } on
// a well-formed, all-boolean decision map, else { ok:false }. A malformed result is treated as an
// error (fail closed) -- never partially trusted.
export function interpretAccessResult(data) {
  if (!isPlainObject(data)) return { ok: false };
  if (typeof data.accessVersion !== "number" || !Number.isFinite(data.accessVersion)) return { ok: false };
  if (!isPlainObject(data.decisions)) return { ok: false };
  for (const v of Object.values(data.decisions)) {
    if (typeof v !== "boolean") return { ok: false }; // any non-boolean decision -> malformed
  }
  return { ok: true, decisions: data.decisions };
}

// The fail-closed gate. Returns hasCapability(capabilityId) -> boolean that grants ONLY when:
//   - the feed is READY (a successful callable decision set), AND
//   - that decision set belongs to the CURRENT principal (forUid === currentUid), so a previous
//     principal's result is never reused across a user switch, AND
//   - the decision for the requested capability is an EXPLICIT `true`.
// Every other state -- loading, error/unavailable/malformed, signed out, a since-changed principal,
// or a capability with no decision -- yields false.
export function buildHasCapability(state, currentUid) {
  return function hasCapability(capabilityId) {
    return (
      !!state &&
      state.status === FEED_STATUS.READY &&
      state.forUid != null &&
      state.forUid === currentUid &&
      isPlainObject(state.decisions) &&
      state.decisions[capabilityId] === true
    );
  };
}

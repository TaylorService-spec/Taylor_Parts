// Issue #325 / ADR-007 -- PURE glue for the trusted effective-access feed's client integration.
//
// The client asks Inventory's `resolveEffectiveAccess` callable (effectiveAccessFeedCallable.ts)
// for a DECISION on the wave-1 Report Builder capabilities, and gates nav visibility on the answer.
// This module holds the parts that need NO firebase (so they are node-testable): what to request,
// how to validate the observed access-version, how to validate a callable result, and how to turn
// the observed-version + feed state into a fail-closed, FRESH hasCapability. The firebase-calling
// hook (subscription + callable) lives in useReportCapabilities.js and delegates here.
//
// FRESHNESS (live grant/revocation without logout): the client OBSERVES users/{uid}.accessVersion
// live and stores the accessVersion the feed resolved against. A decision grants ONLY when the
// feed's returned version EXACTLY matches the current observed version -- so the instant a
// grant/revocation bumps accessVersion, the stored decisions (resolved against the old version)
// stop granting until a re-fetch returns a matching version.
//
// GOVERNANCE BOUNDARY: governed access comes ONLY from the callable's decisions. This module never
// reads users/{uid}.role, never inspects Role names, and never builds a Role definition -- a raw
// role can never confer a governed capability (the W1 correction; this keeps it true).
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES } from "./reportAccess.js";

// Request ONLY the wave-1 Report Builder capability ids -- never a broader or arbitrary set.
export const REPORT_CAPABILITY_REQUEST = REPORT_WAVE1_OBJECT_READ_CAPABILITIES;

// Observed-version subscription status. hasCapability requires `ready` with a valid version.
export const VERSION_STATUS = Object.freeze({
  SIGNED_OUT: "signedOut",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error", // missing / malformed value, or subscription failure
});

// Feed (callable) status. hasCapability requires `ready`.
export const FEED_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error", // unavailable / malformed result
});

export const SIGNED_OUT_VERSION = Object.freeze({ status: VERSION_STATUS.SIGNED_OUT, uid: null, version: null });
export const IDLE_FEED = Object.freeze({ status: FEED_STATUS.IDLE, forUid: null, forVersion: null, decisions: null });

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Accept ONLY a finite, non-negative INTEGER accessVersion. Rejects negatives, fractionals, NaN,
// Infinity, strings, null/undefined (missing) -- every one of those is "deny" (fail closed).
export function isValidObservedVersion(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// Validate a raw callable payload ({ accessVersion, decisions }). Returns
// { ok:true, accessVersion, decisions } on a well-formed result (a valid version + an all-boolean
// decision map), else { ok:false }. A malformed result is treated as an error (fail closed).
export function interpretAccessResult(data) {
  if (!isPlainObject(data)) return { ok: false };
  if (!isValidObservedVersion(data.accessVersion)) return { ok: false };
  if (!isPlainObject(data.decisions)) return { ok: false };
  for (const v of Object.values(data.decisions)) {
    if (typeof v !== "boolean") return { ok: false }; // any non-boolean decision -> malformed
  }
  return { ok: true, accessVersion: data.accessVersion, decisions: data.decisions };
}

// The fail-closed, FRESH gate. `gate` = { version, feed }. Returns hasCapability(capabilityId) that
// grants ONLY when ALL hold:
//   - the observed version is READY, belongs to the CURRENT principal, and is a valid non-negative
//     integer (deny while loading / missing / malformed / on subscription failure);
//   - the feed is READY and belongs to the CURRENT principal (never reuse another principal's set);
//   - the feed's resolved version EXACTLY matches the current observed version (deny while CHANGING,
//     and discard a decision set resolved against an earlier/out-of-order version);
//   - the decision for the capability is an EXPLICIT `true`.
export function buildHasCapability(gate, currentUid) {
  const version = gate?.version;
  const feed = gate?.feed;

  const versionReady =
    !!version &&
    version.status === VERSION_STATUS.READY &&
    version.uid === currentUid &&
    isValidObservedVersion(version.version);

  return function hasCapability(capabilityId) {
    return (
      versionReady &&
      !!feed &&
      feed.status === FEED_STATUS.READY &&
      feed.forUid === currentUid &&
      feed.forVersion === version.version &&
      isPlainObject(feed.decisions) &&
      feed.decisions[capabilityId] === true
    );
  };
}

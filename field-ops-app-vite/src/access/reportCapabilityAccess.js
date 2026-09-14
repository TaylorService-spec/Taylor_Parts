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
import { SHELL_GATED_CAPABILITY_IDS } from "./shellCapabilityGates.js";

// The capabilities the trusted feed is asked to decide, in ONE consistent request (all resolved
// against the same accessVersion). Never a broader or arbitrary set.
//
// DERIVED, NOT MAINTAINED (P2-G). This used to be a hand-written list of spreads that had to be kept
// equal to the gates by somebody remembering to. It was not: four separate defects were found and
// hand-patched by appending to it (My Dashboard's module ids, Data Import, Administration > Users,
// Inbound Work), and P3-A2 then found two more (`inventory.location.bin.manage`,
// `inventory.stock.relocate`) with this lane's census adding three (`financialPolicy.profile.read`,
// `financialPolicy.profile.configure`, `equipment.compatibility.view`).
//
// It is now the UNION OF THE DECLARED GATES (access/shellCapabilityGates.js), which the gating
// components import from, so a gate and the request cannot disagree. The name stays
// REPORT_CAPABILITY_REQUEST because every consumer already imports it; what it means is "the
// capabilities the shell must have a decision on to render its controls honestly".
//
// THE FAILURE THIS CLOSES is distinct from the two known ones and is NOT a governance change:
// an id nobody asks about resolves `undefined` -> `false` in buildHasCapability() below, forever,
// for every principal in every environment -- which is indistinguishable from `active:false` and
// from "not activated here", and is fixed by neither granting nor activating. Asking is not
// granting: a principal without the grant still gets `false`, from the server, on the evidence.
export const REPORT_CAPABILITY_REQUEST = SHELL_GATED_CAPABILITY_IDS;

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
/**
 * Is the governed access decision still being established for `currentUid`?
 *
 * WHY THIS EXISTS. buildHasCapability() correctly denies while loading -- fail-closed. But "deny"
 * and "don't know yet" have very different consequences for ROUTING. A capability-gated route that
 * is merely absent falls through to the router's catch-all, which REDIRECTS to /dashboard and
 * destroys the requested URL. By the time the decision arrives the user is already somewhere else,
 * so a legitimately-authorized principal could never land on the surface by full page load or deep
 * link -- only by in-app navigation, once the decision happened to be resolved already.
 *
 * That is exactly what happened to inventoryTransferOperator on /inventory/transfers: the feed
 * granted inventory.transfer.create, and the redirect had already fired.
 *
 * Compatibility-role users never saw it because ROLE_NAV_ACCESS is available synchronously from
 * AuthContext -- there is no window for them to lose. This signal exists so the shell can WAIT for
 * the answer instead of acting on its absence. It grants nothing; it only distinguishes
 * "not yet known" from "known to be no".
 */
export function isAccessResolving(gate, currentUid) {
  if (!currentUid) return false; // signed out is a settled answer, not a pending one
  const version = gate?.version;
  const feed = gate?.feed;

  // The version subscription has not produced a usable value for THIS principal yet. A stale value
  // from a previous principal counts as unresolved, not as an answer about this one.
  if (!version || version.status === VERSION_STATUS.LOADING) return true;
  if (version.status === VERSION_STATUS.READY && version.uid !== currentUid) return true;

  // An ERROR/SIGNED_OUT version is settled: it denies, and waiting longer would not change it.
  if (version.status !== VERSION_STATUS.READY) return false;

  // Version known; the feed decision for it may still be in flight.
  if (!feed || feed.status === FEED_STATUS.IDLE || feed.status === FEED_STATUS.LOADING) return true;
  if (feed.status === FEED_STATUS.READY) {
    // Ready but for a superseded principal/version -- a re-fetch is coming.
    return feed.forUid !== currentUid || feed.forVersion !== version.version;
  }
  return false; // ERROR: settled denial
}

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

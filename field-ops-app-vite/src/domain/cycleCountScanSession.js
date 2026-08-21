// CYCLE COUNT BY SCAN — turning scans into a counted figure. PURE: no I/O, no JSX, no transport.
//
// ============================ THE COUNT IS BLIND ============================
//
// DECISIONS #111: cycle counts are blind, and a counter cannot approve their own material variance.
// The server snapshots the expected quantity at CREATE time and does not return it; the first
// response that carries it is the SUBMIT response, by which point the counted value has already been
// recorded and there is nothing left to anchor.
//
// So nothing in this module accepts, stores, derives or displays an expected figure. A counting
// session knows only what was scanned. That is not an oversight to work around — anchoring is the
// exact failure a blind count exists to prevent, and a helpful "expected: 12" on the scanning screen
// would defeat the control entirely.
//
// ============================ OBSERVATION IS NOT ADJUSTMENT ============================
//
// Submitting a count records WHAT WAS SEEN. It moves no stock and changes no balance. The ledger
// correction happens only when a manager RECONCILES, which is a separate capability
// (`inventory.cycleCount.reconcile`) and a separate screen. This module has no reconcile path and no
// notion of approval, so a counter cannot reach one from here.
//
// ============================ NO SECOND COUNT ENGINE ============================
//
// Variance is derived server-side from the snapshot the server took. Nothing here subtracts
// anything. The submitted payload is exactly what the existing `buildSubmitCycleCountRequest`
// expects: a counted quantity, or a list of counted serials.

import { SCAN_RESOLUTION, resolveScannedIdentity } from "./scannedIdentity.js";

/** What one scan contributed to the count. */
export const COUNT_OBSERVATION = Object.freeze({
  COUNTED: "COUNTED",             // a unit of the part being counted
  DUPLICATE_SERIAL: "DUPLICATE_SERIAL", // this exact serial is already on the sheet
  WRONG_PART: "WRONG_PART",       // a different part — found here, but not what is being counted
  UNREADABLE: "UNREADABLE",       // not a usable code
});

export const COUNT_OBSERVATION_TEXT = Object.freeze({
  [COUNT_OBSERVATION.DUPLICATE_SERIAL]: "Already counted.",
  [COUNT_OBSERVATION.WRONG_PART]: "That is a different part. Count it separately.",
  [COUNT_OBSERVATION.UNREADABLE]: "That code could not be read.",
});

/** Why a count cannot be submitted yet. */
export const SUBMIT_BLOCKED = Object.freeze({
  NO_SESSION: "NO_SESSION",           // nothing has been created to count against
  NOT_COUNTING: "NOT_COUNTING",       // the count is no longer open
  UNRESOLVED_SCAN: "UNRESOLVED_SCAN", // something scanned is not part of this count
});

const BLOCKING = new Set([COUNT_OBSERVATION.WRONG_PART, COUNT_OBSERVATION.UNREADABLE]);

/**
 * Classify one scan against the part being counted.
 *
 * A SERIAL count resolves to a UNIT; a quantity count resolves to the PART and adds one. Serials are
 * NOT validated against an expected list — the whole point of a blind count is that the counter does
 * not know what was expected, so an "unexpected" serial is simply counted and the server decides what
 * that means at submit.
 */
export function classifyCountScan(raw, { partId, trackingMode }, alreadyCounted = []) {
  const identity = resolveScannedIdentity(raw, {
    parts: [{ partId, sku: partId }],
    // Every serial already counted is offered as a candidate so a repeat resolves as a unit rather
    // than falling through to "wrong part".
    serializedAssets: alreadyCounted.map((serialNo) => ({ serialNo, partId })),
  });
  const token = identity.token ?? (typeof raw === "string" ? raw.trim() : "");

  if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
    return Object.freeze({ token, state: COUNT_OBSERVATION.UNREADABLE, serialNo: null });
  }

  if (trackingMode === "SERIAL") {
    if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "SERIALIZED_ASSET") {
      return Object.freeze({ token, state: COUNT_OBSERVATION.DUPLICATE_SERIAL, serialNo: identity.entityId });
    }
    if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
      // The part code identifies the kind, not a unit. A serialized count needs the serial off the
      // unit itself, or the sheet would say "one of these" without saying which.
      return Object.freeze({ token, state: COUNT_OBSERVATION.WRONG_PART, serialNo: null });
    }
    // NOT_FOUND against a candidate set of only already-counted serials. On a BLIND count that is
    // the normal case: an uncounted unit of this part is exactly what we came to find. It is counted
    // as-is, and whether it was expected is the server's judgement, not this screen's.
    return Object.freeze({ token, state: COUNT_OBSERVATION.COUNTED, serialNo: token });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
    return Object.freeze({ token, state: COUNT_OBSERVATION.COUNTED, serialNo: null });
  }
  return Object.freeze({ token, state: COUNT_OBSERVATION.WRONG_PART, serialNo: null });
}

/**
 * Add a scan to a session, threading duplicates correctly.
 *
 * Returns a NEW observation list; the input is never mutated.
 */
export function addCountScan(observations, raw, session) {
  const counted = observations
    .filter((o) => o.state === COUNT_OBSERVATION.COUNTED && o.serialNo)
    .map((o) => o.serialNo);
  return Object.freeze([...observations, classifyCountScan(raw, session, counted)]);
}

/**
 * The state of a counting session.
 *
 * NOTE what is absent: no expected quantity, no variance, no "over"/"short". Those exist only after
 * submit, in the server's response.
 */
export function buildCountSession({ session, observations = [] } = {}) {
  const trackingMode = session?.trackingMode ?? null;
  const serialTracked = trackingMode === "SERIAL";

  const counted = observations.filter((o) => o.state === COUNT_OBSERVATION.COUNTED);
  const unresolved = observations.filter((o) => BLOCKING.has(o.state));

  // Serials are de-duplicated here as a second guard: classifyCountScan already refuses a repeat,
  // but a submitted list with a duplicate would be rejected by the request builder, and failing at
  // the last step is a worse experience than never assembling one.
  const countedSerialNumbers = serialTracked
    ? [...new Map(counted.filter((o) => o.serialNo).map((o) => [o.serialNo.trim().toLowerCase(), o.serialNo])).values()]
    : [];

  const countedQuantity = serialTracked ? countedSerialNumbers.length : counted.length;

  const blockers = [];
  if (!session?.cycleCountId) blockers.push(SUBMIT_BLOCKED.NO_SESSION);
  else if (session.status !== "COUNTING") blockers.push(SUBMIT_BLOCKED.NOT_COUNTING);
  if (unresolved.length > 0) blockers.push(SUBMIT_BLOCKED.UNRESOLVED_SCAN);

  return Object.freeze({
    serialTracked,
    countedQuantity,
    countedSerialNumbers: Object.freeze(countedSerialNumbers),
    unresolved: Object.freeze(unresolved),
    blockers: Object.freeze(blockers),
    /**
     * A count of ZERO is a legitimate, submittable result — "there are none here" is exactly the
     * finding a cycle count exists to surface, and requiring a scan before submitting would make an
     * empty shelf unreportable.
     */
    canSubmit: blockers.length === 0,
  });
}

/**
 * The submit draft, in the shape `buildSubmitCycleCountRequest` already expects.
 *
 * SERIAL counts stay an explicit LIST. Collapsing them to a number would lose which units were
 * found, and the server's reconciliation reports missing and unexpected serials separately for
 * exactly that reason.
 */
export function toSubmitDraft(state) {
  return state.serialTracked
    ? { countedSerialNumbers: [...state.countedSerialNumbers] }
    : { countedQuantity: state.countedQuantity };
}

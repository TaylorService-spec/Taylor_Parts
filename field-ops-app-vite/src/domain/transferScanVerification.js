// TRANSFERS BY SCAN — what a scan proves about a transfer order. PURE: no I/O, no JSX, no transport.
//
// ============================ SCANNING VERIFIES; IT DOES NOT AUTHOR ============================
//
// The transfer order already states everything the command needs: part, quantity, serials, origin
// and destination. `dispatchTransferOrder` and `receiveTransferOrder` take a transferOrderId and
// nothing else — they re-read the order and re-derive every number inside their own transaction.
//
// So scanning here changes NO payload. It answers one question before the operator commits: is what
// I am physically holding the thing this order is about? A scan that disagrees with the order blocks
// submission; it never edits the order to match what was scanned. That would be authoring a transfer
// with a barcode, and the transfer command is the only authority allowed to say what moves.
//
// ============================ NO SECOND TRANSFER ENGINE ============================
//
// There is no quantity arithmetic here beyond counting what was observed, no sufficiency check, no
// location resolution and no ledger. Sufficiency is re-verified at commit time by the command (it
// re-reads each serial's location and state), so a client-side "you have enough" would be a second,
// weaker copy that can only disagree.
//
// ============================ FAIL CLOSED ============================
//
// A scan that cannot be matched blocks submission. So does a wrong location, a stale status, a
// duplicate serial, and one unit too many. None of them is silently dropped or auto-corrected: the
// operator sees which scan is the problem, because the fix is physical.

import { SCAN_RESOLUTION, resolveScannedIdentity } from "./scannedIdentity.js";

/** The action a transfer order is currently waiting for. */
export const TRANSFER_ACTION = Object.freeze({
  DISPATCH: "DISPATCH",   // stock leaves the origin
  RECEIVE: "RECEIVE",     // stock arrives at the destination
  NONE: "NONE",           // nothing to do — already done, cancelled, or not yet actionable
});

/** Why a transfer order cannot be acted on right now. */
export const NOT_ACTIONABLE = Object.freeze({
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  UNKNOWN_STATUS: "UNKNOWN_STATUS",
});

/** What one scan turned out to be. */
export const OBSERVATION_STATE = Object.freeze({
  VERIFIED: "VERIFIED",               // matches the part (or a serial) this order moves
  WRONG_PART: "WRONG_PART",           // a real code, but not this order's part
  UNKNOWN_SERIAL: "UNKNOWN_SERIAL",   // a serial this order does not list
  DUPLICATE: "DUPLICATE",             // already scanned
  EXCESS: "EXCESS",                   // one more than the order moves
  UNREADABLE: "UNREADABLE",           // not a usable code at all
});

/** Why submission is blocked. Each is a different physical fix. */
export const BLOCKED_REASON = Object.freeze({
  NOT_ACTIONABLE: "NOT_ACTIONABLE",
  WRONG_LOCATION: "WRONG_LOCATION",
  BLOCKED_OBSERVATION: "BLOCKED_OBSERVATION",
  INCOMPLETE: "INCOMPLETE",
  NOTHING_SCANNED: "NOTHING_SCANNED",
});

export const OBSERVATION_TEXT = Object.freeze({
  [OBSERVATION_STATE.WRONG_PART]: "That is a different part from the one this transfer moves.",
  [OBSERVATION_STATE.UNKNOWN_SERIAL]: "That serial is not one of the units on this transfer.",
  [OBSERVATION_STATE.DUPLICATE]: "Already scanned.",
  [OBSERVATION_STATE.EXCESS]: "That is more than this transfer moves.",
  [OBSERVATION_STATE.UNREADABLE]: "That code could not be read.",
});

const BLOCKING_STATES = new Set([
  OBSERVATION_STATE.WRONG_PART,
  OBSERVATION_STATE.UNKNOWN_SERIAL,
  OBSERVATION_STATE.EXCESS,
  OBSERVATION_STATE.UNREADABLE,
]);

const eq = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which action this order is waiting for.
 *
 * MIRRORS the server's own status gate (`transferOrderCommand.ts`: dispatch accepts REQUESTED or
 * IN_TRANSIT; receive accepts IN_TRANSIT). It is a mirror and not an authority: the command re-checks
 * inside its transaction, so an order that changes underneath the operator is refused there. This
 * exists so the screen does not offer a button that is certain to fail.
 */
export function actionForStatus(status) {
  if (status === "REQUESTED") return { action: TRANSFER_ACTION.DISPATCH, reason: null };
  if (status === "IN_TRANSIT") return { action: TRANSFER_ACTION.RECEIVE, reason: null };
  if (status === "COMPLETED") return { action: TRANSFER_ACTION.NONE, reason: NOT_ACTIONABLE.COMPLETED };
  if (status === "CANCELLED") return { action: TRANSFER_ACTION.NONE, reason: NOT_ACTIONABLE.CANCELLED };
  return { action: TRANSFER_ACTION.NONE, reason: NOT_ACTIONABLE.UNKNOWN_STATUS };
}

/** The location the operator must be standing at for the action. */
export function expectedLocationFor(order, action) {
  if (action === TRANSFER_ACTION.DISPATCH) return order?.origin ?? null;
  if (action === TRANSFER_ACTION.RECEIVE) return order?.destination ?? null;
  return null;
}

/**
 * Classify one raw scan against the order and what has already been verified.
 *
 * `alreadyVerified` is the list of prior VERIFIED observations, so duplicate and excess are decided
 * against real progress rather than recomputed from scratch by the caller.
 */
export function classifyObservation(raw, order, alreadyVerified = []) {
  const identity = resolveScannedIdentity(raw, {
    parts: [{ partId: order?.partId, sku: order?.partId }],
    // A SERIAL transfer lists exactly which units move. Offering the serials as candidates is what
    // lets a scan resolve to a UNIT rather than merely to the part.
    serializedAssets: (order?.serialNumbers ?? []).map((serialNo) => ({ serialNo, partId: order?.partId })),
  });

  const token = identity.token ?? (typeof raw === "string" ? raw.trim() : "");
  const serialTracked = order?.trackingMode === "SERIAL";

  if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
    return Object.freeze({ token, state: OBSERVATION_STATE.UNREADABLE, serialNo: null });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "SERIALIZED_ASSET") {
    const serialNo = identity.entityId;
    if (alreadyVerified.some((o) => eq(o.serialNo, serialNo))) {
      return Object.freeze({ token, state: OBSERVATION_STATE.DUPLICATE, serialNo });
    }
    return Object.freeze({ token, state: OBSERVATION_STATE.VERIFIED, serialNo });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
    if (serialTracked) {
      // Scanning the PART code on a serialized transfer identifies the kind, not the unit. The
      // transfer moves named units, so a kind is not enough to verify one of them.
      return Object.freeze({ token, state: OBSERVATION_STATE.UNKNOWN_SERIAL, serialNo: null });
    }
    const quantity = Number.isFinite(order?.quantity) ? order.quantity : 0;
    if (alreadyVerified.length >= quantity) {
      return Object.freeze({ token, state: OBSERVATION_STATE.EXCESS, serialNo: null });
    }
    return Object.freeze({ token, state: OBSERVATION_STATE.VERIFIED, serialNo: null });
  }

  // NOT_FOUND against a candidate set of exactly this order's part and serials. On a serialized
  // transfer that is most likely a unit of the right part that is not on this order — which is a
  // different mistake from grabbing the wrong part entirely, and both are refused.
  return Object.freeze({
    token,
    state: serialTracked ? OBSERVATION_STATE.UNKNOWN_SERIAL : OBSERVATION_STATE.WRONG_PART,
    serialNo: null,
  });
}

/**
 * The whole verification state for one transfer order.
 *
 * @param order            the stored transfer order: partId, quantity, trackingMode, serialNumbers,
 *                         status, origin, destination.
 * @param observations     every scan so far, already classified.
 * @param confirmedLocation the location the operator scanned or confirmed they are at, or null.
 */
export function buildTransferVerification({ order, observations = [], confirmedLocation = null } = {}) {
  const { action, reason: notActionable } = actionForStatus(order?.status);
  const expectedLocation = expectedLocationFor(order, action);
  const serialTracked = order?.trackingMode === "SERIAL";
  const required = serialTracked
    ? (order?.serialNumbers ?? []).length
    : (Number.isFinite(order?.quantity) ? order.quantity : 0);

  const verified = observations.filter((o) => o.state === OBSERVATION_STATE.VERIFIED);
  const blocked = observations.filter((o) => BLOCKING_STATES.has(o.state));

  // Which listed serials are still outstanding. Named, because "3 of 5" does not tell an operator
  // which two boxes to go and find.
  const outstandingSerials = serialTracked
    ? (order?.serialNumbers ?? []).filter((s) => !verified.some((o) => eq(o.serialNo, s)))
    : [];

  const locationMatches = expectedLocation === null
    ? false
    : confirmedLocation !== null
      && eq(confirmedLocation.locationId, expectedLocation.locationId)
      && confirmedLocation.type === expectedLocation.type;

  const blockers = [];
  if (action === TRANSFER_ACTION.NONE) blockers.push(BLOCKED_REASON.NOT_ACTIONABLE);
  else {
    if (!locationMatches) blockers.push(BLOCKED_REASON.WRONG_LOCATION);
    if (blocked.length > 0) blockers.push(BLOCKED_REASON.BLOCKED_OBSERVATION);
    if (observations.length === 0) blockers.push(BLOCKED_REASON.NOTHING_SCANNED);
    else if (verified.length < required) blockers.push(BLOCKED_REASON.INCOMPLETE);
  }

  return Object.freeze({
    action,
    notActionable,
    expectedLocation,
    locationConfirmed: locationMatches,
    serialTracked,
    required,
    verifiedCount: verified.length,
    outstandingSerials: Object.freeze(outstandingSerials),
    blockedObservations: Object.freeze(blocked),
    blockers: Object.freeze(blockers),
    /** A transfer is submitted whole or not at all — there is no partial dispatch in this command. */
    canSubmit: blockers.length === 0,
  });
}

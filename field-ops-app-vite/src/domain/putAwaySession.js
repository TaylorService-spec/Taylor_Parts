// PUT-AWAY BY SCAN — assembling one stow. PURE: no I/O, no JSX, no transport.
//
// ============================ WHAT A STOW IS, AND IS NOT ============================
//
// DECISIONS #116. Put-away records WHERE stock was stowed inside a warehouse that already holds it.
// It does not move stock between custody locations, and it must not remove anything from warehouse
// on-hand or available.
//
// So this module assembles a placement REQUEST — a bin, a part, and either a quantity or a list of
// serials — and nothing else. There is no balance here, no sufficiency check and no ledger. A test
// asserts the module cannot name one.
//
// ============================ THE BIN IS A DESTINATION, NOT A LOCATION ============================
//
// The bin is validated by the server's own resolver, whose answers this module mirrors without
// reinterpreting: FOUND / INACTIVE / WRONG_WAREHOUSE / NOT_FOUND / MALFORMED. WRONG_WAREHOUSE stays
// its own answer because it means the operator is in the wrong building, which is a different
// problem from a code nobody registered.
//
// ============================ NO QUARANTINE ============================
//
// DECISIONS #117. A stow records placement. It does not classify condition, hold stock for
// inspection, or gate availability — and there is nowhere here to express any of those.

import { SCAN_RESOLUTION, resolveScannedIdentity } from "./scannedIdentity.js";

/** The two things a stow needs, in the order an operator does them. */
export const STOW_STEP = Object.freeze({
  DESTINATION: "DESTINATION",   // which bin
  CONTENTS: "CONTENTS",         // what is going in it
});

/** The server's bin-resolution vocabulary, mirrored so the client never invents one. */
export const BIN_RESULT = Object.freeze({
  FOUND: "FOUND",
  INACTIVE: "INACTIVE",
  WRONG_WAREHOUSE: "WRONG_WAREHOUSE",
  NOT_FOUND: "NOT_FOUND",
  MALFORMED: "MALFORMED",
});

export const BIN_RESULT_TEXT = Object.freeze({
  [BIN_RESULT.INACTIVE]: "That bin is retired. Pick another, or ask for it to be brought back.",
  [BIN_RESULT.WRONG_WAREHOUSE]: "That bin belongs to a different warehouse. Check which building you are in.",
  [BIN_RESULT.NOT_FOUND]: "No bin is registered with that code here.",
  [BIN_RESULT.MALFORMED]: "That bin code could not be read.",
});

/** What one contents scan turned out to be. */
export const STOW_OBSERVATION = Object.freeze({
  ADDED: "ADDED",
  DUPLICATE_SERIAL: "DUPLICATE_SERIAL",
  WRONG_PART: "WRONG_PART",
  UNREADABLE: "UNREADABLE",
});

export const STOW_OBSERVATION_TEXT = Object.freeze({
  [STOW_OBSERVATION.DUPLICATE_SERIAL]: "Already in this stow.",
  [STOW_OBSERVATION.WRONG_PART]: "That is a different part. Stow it separately.",
  [STOW_OBSERVATION.UNREADABLE]: "That code could not be read.",
});

/** Why a stow cannot be submitted yet. */
export const STOW_BLOCKED = Object.freeze({
  NO_BIN: "NO_BIN",
  BIN_UNUSABLE: "BIN_UNUSABLE",
  NOTHING_TO_STOW: "NOTHING_TO_STOW",
  UNRESOLVED_SCAN: "UNRESOLVED_SCAN",
});

const BLOCKING = new Set([STOW_OBSERVATION.WRONG_PART, STOW_OBSERVATION.UNREADABLE]);

/** Classify one contents scan against the part being stowed. */
export function classifyStowScan(raw, { partId, serialTracked }, alreadyAdded = []) {
  const identity = resolveScannedIdentity(raw, {
    parts: [{ partId, sku: partId }],
    serializedAssets: alreadyAdded.map((serialNo) => ({ serialNo, partId })),
  });
  const token = identity.token ?? (typeof raw === "string" ? raw.trim() : "");

  if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
    return Object.freeze({ token, state: STOW_OBSERVATION.UNREADABLE, serialNo: null });
  }

  if (serialTracked) {
    if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "SERIALIZED_ASSET") {
      return Object.freeze({ token, state: STOW_OBSERVATION.DUPLICATE_SERIAL, serialNo: identity.entityId });
    }
    if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
      // The part code names the kind. A serialized stow has to say WHICH unit went on the shelf, or
      // "where is SN-42" cannot be answered later.
      return Object.freeze({ token, state: STOW_OBSERVATION.WRONG_PART, serialNo: null });
    }
    // Any other unit of this part is a new serial to stow. The server re-checks that it is a real
    // unit of this part inside its transaction; this screen does not pre-empt that.
    return Object.freeze({ token, state: STOW_OBSERVATION.ADDED, serialNo: token });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
    return Object.freeze({ token, state: STOW_OBSERVATION.ADDED, serialNo: null });
  }
  return Object.freeze({ token, state: STOW_OBSERVATION.WRONG_PART, serialNo: null });
}

/** Append one scan. Returns a NEW list; the input is never mutated. */
export function addStowScan(observations, raw, session) {
  const added = observations
    .filter((o) => o.state === STOW_OBSERVATION.ADDED && o.serialNo)
    .map((o) => o.serialNo);
  return Object.freeze([...observations, classifyStowScan(raw, session, added)]);
}

/**
 * The state of one stow.
 *
 * @param bin  the server's resolution of the scanned bin: { result, code, ... } or null.
 */
export function buildStowSession({ session, bin = null, observations = [] } = {}) {
  const serialTracked = session?.serialTracked === true;
  const added = observations.filter((o) => o.state === STOW_OBSERVATION.ADDED);
  const unresolved = observations.filter((o) => BLOCKING.has(o.state));

  const serialNumbers = serialTracked
    ? [...new Map(added.filter((o) => o.serialNo).map((o) => [o.serialNo.trim().toLowerCase(), o.serialNo])).values()]
    : [];
  const quantity = serialTracked ? serialNumbers.length : added.length;

  const blockers = [];
  if (!bin) blockers.push(STOW_BLOCKED.NO_BIN);
  else if (bin.result !== BIN_RESULT.FOUND) blockers.push(STOW_BLOCKED.BIN_UNUSABLE);
  if (unresolved.length > 0) blockers.push(STOW_BLOCKED.UNRESOLVED_SCAN);
  // Unlike a cycle count, an EMPTY stow is not a finding — it is nothing happening. Recording that
  // somebody put no items into a bin would be a placement record that means nothing.
  if (quantity === 0) blockers.push(STOW_BLOCKED.NOTHING_TO_STOW);

  return Object.freeze({
    step: bin?.result === BIN_RESULT.FOUND ? STOW_STEP.CONTENTS : STOW_STEP.DESTINATION,
    serialTracked,
    quantity,
    serialNumbers: Object.freeze(serialNumbers),
    unresolved: Object.freeze(unresolved),
    blockers: Object.freeze(blockers),
    canSubmit: blockers.length === 0,
  });
}

/**
 * The request the put-away command takes.
 *
 * Exactly ONE of quantity or serialNumbers, matching the command's own contract — a request carrying
 * both is ambiguous about what was stowed, and the server refuses it rather than guessing.
 */
export function toPutAwayRequest({ session, bin, state, idempotencyKey }) {
  return Object.freeze({
    warehouseId: session.warehouseId,
    binCode: bin.code,
    partId: session.partId,
    ...(state.serialTracked
      ? { serialNumbers: [...state.serialNumbers] }
      : { quantity: state.quantity }),
    idempotencyKey,
  });
}

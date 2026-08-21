// PICK AND STAGE — gathering what a Work Order asked for. PURE: no I/O, no JSX, no transport.
//
// ============================ PICKING RESERVES NOTHING ============================
//
// This is the fact that shapes everything below, and it is a reconciliation result rather than a
// design choice.
//
// Reservation in this platform is a Work Order LIFECYCLE EFFECT, not an operator action:
// `DISPATCHED -> reserveParts` writes the RESERVED ledger entries, `COMPLETED -> consumeParts`, and
// `CANCELLED -> releaseParts`. There is no operator-invokable reserve command, and inventing one
// would be a new commitment policy — whether picked stock is still promisable to other orders is a
// business decision nobody has made.
//
// So a pick is exactly what put-away is: stock moving to a place inside the warehouse it already
// belongs to, recorded as a PLACEMENT, changing no balance. The one extra fact is WHY it went
// there — the demand it was gathered for.
//
// THE HONEST CONSEQUENCE, which the screen states rather than hides: picked stock remains available
// to other orders until the Work Order dispatches, because availability is ledger-derived and
// picking writes no ledger. That is a real limitation and a candidate for a future policy decision;
// it is not a bug to work around here by writing a reservation this module has no authority for.
//
// ============================ THE DEMAND IS THE WORK ORDER'S ============================
//
// Demand comes from the Work Order's own `inventorySnapshot` (qtyPlanned), authored by
// `setWorkOrderPartsPlan`. This module reads it and compares; it never authors demand, never edits a
// plan, and creates no second demand system.

import { SCAN_RESOLUTION, resolveScannedIdentity } from "./scannedIdentity.js";

/** What one pick scan turned out to be, against the line being picked. */
export const PICK_OBSERVATION = Object.freeze({
  PICKED: "PICKED",
  DUPLICATE_SERIAL: "DUPLICATE_SERIAL",
  WRONG_PART: "WRONG_PART",      // not the part this line asks for
  EXCESS: "EXCESS",              // more than the line planned
  UNREADABLE: "UNREADABLE",
});

export const PICK_OBSERVATION_TEXT = Object.freeze({
  [PICK_OBSERVATION.DUPLICATE_SERIAL]: "Already picked.",
  [PICK_OBSERVATION.WRONG_PART]: "That is not the part this job asked for.",
  [PICK_OBSERVATION.EXCESS]: "That is more than this job planned for.",
  [PICK_OBSERVATION.UNREADABLE]: "That code could not be read.",
});

/** How a line stands against what was planned. */
export const LINE_STATE = Object.freeze({
  NOT_PICKED: "NOT_PICKED",
  SHORT: "SHORT",        // some gathered, fewer than planned
  COMPLETE: "COMPLETE",  // exactly what was planned
});

/** Why the pick cannot be staged yet. */
export const STAGE_BLOCKED = Object.freeze({
  NO_DEMAND: "NO_DEMAND",
  NOTHING_PICKED: "NOTHING_PICKED",
  UNRESOLVED_SCAN: "UNRESOLVED_SCAN",
  NO_STAGING_BIN: "NO_STAGING_BIN",
});

const BLOCKING = new Set([PICK_OBSERVATION.WRONG_PART, PICK_OBSERVATION.EXCESS, PICK_OBSERVATION.UNREADABLE]);

/**
 * The demand lines, from the Work Order's own snapshot.
 *
 * Read, never authored. A snapshot row without a usable part or a positive planned quantity is
 * EXCLUDED rather than rendered as a zero line an operator might try to pick against.
 */
export function demandLinesFrom(workOrder) {
  const rows = Array.isArray(workOrder?.inventorySnapshot) ? workOrder.inventorySnapshot : [];
  return Object.freeze(
    rows
      .map((row) => {
        const partId = typeof row?.partId === "string" && row.partId !== ""
          ? row.partId
          : (typeof row?.sku === "string" && row.sku !== "" ? row.sku : null);
        const planned = Number.isFinite(row?.qtyPlanned) ? row.qtyPlanned : null;
        if (!partId || planned === null || planned <= 0) return null;
        return Object.freeze({
          partId,
          name: typeof row?.name === "string" ? row.name : null,
          planned,
          serialTracked: row?.trackingMode === "SERIAL",
        });
      })
      .filter(Boolean),
  );
}

/**
 * Classify one scan against the line being picked.
 *
 * @param progress { pickedCount, pickedSerials } — the two facts the decision needs, named
 *                 separately rather than inferred from one array. A serial line needs the SERIALS
 *                 (to spot a repeat); every line needs the COUNT (to spot an over-pick); and reading
 *                 one from the other is how a null serial on a quantity line miscounts.
 */
export function classifyPickScan(raw, line, progress = {}) {
  const pickedSerials = Array.isArray(progress.pickedSerials) ? progress.pickedSerials.filter(Boolean) : [];
  const pickedCount = Number.isFinite(progress.pickedCount) ? progress.pickedCount : pickedSerials.length;

  const identity = resolveScannedIdentity(raw, {
    parts: [{ partId: line?.partId, sku: line?.partId }],
    serializedAssets: pickedSerials.map((serialNo) => ({ serialNo, partId: line?.partId })),
  });
  const token = identity.token ?? (typeof raw === "string" ? raw.trim() : "");

  if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
    return Object.freeze({ token, state: PICK_OBSERVATION.UNREADABLE, serialNo: null });
  }

  if (line?.serialTracked) {
    if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "SERIALIZED_ASSET") {
      return Object.freeze({ token, state: PICK_OBSERVATION.DUPLICATE_SERIAL, serialNo: identity.entityId });
    }
    if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
      return Object.freeze({ token, state: PICK_OBSERVATION.WRONG_PART, serialNo: null });
    }
    if (pickedCount >= (line?.planned ?? 0)) {
      return Object.freeze({ token, state: PICK_OBSERVATION.EXCESS, serialNo: null });
    }
    return Object.freeze({ token, state: PICK_OBSERVATION.PICKED, serialNo: token });
  }

  if (identity.resolutionState === SCAN_RESOLUTION.RESOLVED && identity.entityType === "PART") {
    if (pickedCount >= (line?.planned ?? 0)) {
      // OVER-PICKING IS REFUSED, not silently accepted. Taking more than the job needs is stock
      // walking off a shelf for no recorded reason, and the operator can see it immediately.
      return Object.freeze({ token, state: PICK_OBSERVATION.EXCESS, serialNo: null });
    }
    return Object.freeze({ token, state: PICK_OBSERVATION.PICKED, serialNo: null });
  }
  return Object.freeze({ token, state: PICK_OBSERVATION.WRONG_PART, serialNo: null });
}

/** Append one scan. Returns a NEW list; the input is never mutated. */
export function addPickScan(observations, raw, line) {
  const picked = observations.filter((o) => o.state === PICK_OBSERVATION.PICKED);
  return Object.freeze([
    ...observations,
    classifyPickScan(raw, line, {
      pickedCount: picked.length,
      pickedSerials: picked.map((o) => o.serialNo).filter(Boolean),
    }),
  ]);
}

/**
 * The state of picking ONE line.
 *
 * SHORT IS A REAL, RECORDABLE OUTCOME. A warehouse that only has four of the five a job asked for
 * should be able to stage the four and have the shortfall visible, rather than being unable to
 * record anything until the fifth appears.
 */
export function buildPickLine({ line, observations = [], stagingBin = null } = {}) {
  const picked = observations.filter((o) => o.state === PICK_OBSERVATION.PICKED);
  const unresolved = observations.filter((o) => BLOCKING.has(o.state));

  const serialNumbers = line?.serialTracked
    ? [...new Map(picked.filter((o) => o.serialNo).map((o) => [o.serialNo.trim().toLowerCase(), o.serialNo])).values()]
    : [];
  const quantity = line?.serialTracked ? serialNumbers.length : picked.length;
  const planned = line?.planned ?? 0;

  const state = quantity === 0
    ? LINE_STATE.NOT_PICKED
    : (quantity >= planned ? LINE_STATE.COMPLETE : LINE_STATE.SHORT);

  const blockers = [];
  if (!line) blockers.push(STAGE_BLOCKED.NO_DEMAND);
  if (unresolved.length > 0) blockers.push(STAGE_BLOCKED.UNRESOLVED_SCAN);
  if (quantity === 0) blockers.push(STAGE_BLOCKED.NOTHING_PICKED);
  if (!stagingBin) blockers.push(STAGE_BLOCKED.NO_STAGING_BIN);

  return Object.freeze({
    state,
    planned,
    quantity,
    shortBy: Math.max(0, planned - quantity),
    serialTracked: line?.serialTracked === true,
    serialNumbers: Object.freeze(serialNumbers),
    unresolved: Object.freeze(unresolved),
    blockers: Object.freeze(blockers),
    canStage: blockers.length === 0,
  });
}

/**
 * The placement request for a staged pick.
 *
 * It is the put-away request with the demand attached — the same command, because a pick IS a
 * placement. `pickedForWorkOrderId` is the only difference, and it records WHY the stock moved
 * without claiming it was reserved.
 */
export function toStageRequest({ warehouseId, line, lineState, stagingBin, workOrderId, idempotencyKey }) {
  return Object.freeze({
    warehouseId,
    binCode: stagingBin.code,
    partId: line.partId,
    ...(lineState.serialTracked
      ? { serialNumbers: [...lineState.serialNumbers] }
      : { quantity: lineState.quantity }),
    pickedForWorkOrderId: workOrderId,
    idempotencyKey,
  });
}

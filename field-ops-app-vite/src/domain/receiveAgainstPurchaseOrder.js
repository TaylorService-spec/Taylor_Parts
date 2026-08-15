// Governed FieldMode Receive-against-Purchase-Order (A1) -- PURE, dependency-free view-model
// for the ONE governed receive workflow: receive an ORDERED reorder Purchase Order into a
// warehouse location through the fail-closed readiness transport. No Firebase, no I/O, no
// transport -- Node-importable and unit-tested. The actual invocation is the readiness-gated
// services/receivingCallableClient.js; the frozen request SHAPE is validated by
// domain/receivingTransport.js's buildReceiveRequest (this module assembles the input it takes).
//
// This is NOT a second receive model: it is the single governed path. There is no ad-hoc /
// demo receive. receiveInventoryStock is capability-gated ({admin,dispatcher,owner}) AND the
// transport is readiness-false, so this workflow fails closed at both layers until a separate
// authorized activation -- no live receipt occurs here.
//
// v1 contract (functions/src/inventoryReceiving/receivingValidation.ts): EXACTLY one line, and
// expectedQuantity == receivedQuantity == the PO's orderedQuantity (no partial receipts). So
// "quantity confirmation" is a confirmation of the full ordered quantity, not an editable field.
//
// Wave 7 Part 2 -- SERIAL capture. A SERIAL-tracked Part cannot be received without a serial
// identity per unit, so this module also resolves the candidate's Part tracking mode (via the
// SAME governed Part Master read the rest of the app already uses -- services/partMasterQueries
// .fetchPartMasterList -- no new read is added here) and validates the serial numbers the
// technician enters. The controlType -> trackingMode mapping mirrors the server's authoritative
// one, functions/src/inventoryReceiving/receivingCallableWiring.ts's controlTypeToTrackingMode
// (STANDARD -> NONE, SERIALIZED -> SERIAL, LOT -> LOT, unknown/SERIALIZED_LOT -> LOT), so the
// client's idea of "does this need serials" never diverges from what the server will enforce.

import { RECEIVING_OUTCOME } from "./receivingTransport.js";

// The linear step model of the workflow. Kept explicit so the UI and tests share one vocabulary.
// SERIALS is only entered for a SERIAL-tracked Part; a NONE-tracked Part goes straight from
// SELECT_LOCATION to CONFIRM, exactly as before this change.
export const RECEIVE_STEP = Object.freeze({
  SELECT_CANDIDATE: "SELECT_CANDIDATE", // choose an ORDERED/ORDERED receipt candidate
  SELECT_LOCATION: "SELECT_LOCATION", // choose a receiving warehouse (listReceivingLocationOptions)
  SERIALS: "SERIALS", // SERIAL-tracked Parts only: capture one serial number per unit
  CONFIRM: "CONFIRM", // confirm the full ordered quantity, then submit
  RESULT: "RESULT", // show the governed receipt outcome
});

// Bounded tracking-mode vocabulary, mirroring the server's ResolvedPart.trackingMode.
export const TRACKING_MODE = Object.freeze({ NONE: "NONE", SERIAL: "SERIAL", LOT: "LOT" });

// Bounded status for resolving a candidate's Part tracking mode. BLOCKED_* are all fail-closed:
// the caller must not guess NONE and proceed when the Part couldn't be authoritatively read.
export const PART_TRACKING_STATUS = Object.freeze({
  READY: "READY",
  BLOCKED_PERMISSION: "BLOCKED_PERMISSION", // Part Master read denied by Rules
  BLOCKED_UNAVAILABLE: "BLOCKED_UNAVAILABLE", // Part Master read failed (network/unknown)
  BLOCKED_NOT_FOUND: "BLOCKED_NOT_FOUND", // the candidate's partId isn't in the Part Master list
});

// Mirrors functions/src/inventoryReceiving/receivingCallableWiring.ts's controlTypeToTrackingMode
// EXACTLY. Kept as a tiny pure switch (not imported cross-runtime) so this module stays
// Node-importable and dependency-free; any drift from the server mapping is a review-time risk,
// not a runtime one, since the server independently re-validates and is the actual authority.
function controlTypeToTrackingMode(controlType) {
  switch (controlType) {
    case "STANDARD": return TRACKING_MODE.NONE;
    case "SERIALIZED": return TRACKING_MODE.SERIAL;
    case "LOT": return TRACKING_MODE.LOT;
    default: return TRACKING_MODE.LOT;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// A receipt candidate is exactly an OPEN row from domain/purchaseOrdersView.js
// (request ORDERED + a live ORDERED PO). We only need its identity, part, and ordered quantity.
export function isReceivableCandidate(row) {
  return (
    isPlainObject(row) &&
    row.isReceiptCandidate === true &&
    isPlainObject(row.receiptSource) &&
    typeof row.receiptSource.reorderRequestId === "string" &&
    row.receiptSource.reorderRequestId.length > 0 &&
    typeof row.receiptSource.purchaseOrderId === "string" &&
    typeof row.partId === "string" &&
    row.partId.length > 0 &&
    Number.isFinite(row.orderedQuantity) &&
    row.orderedQuantity > 0
  );
}

// Deterministic single-line id for a PO receipt (one line per reorder PO in v1). Stable so a
// retry rebuilds the identical request; distinct from the reorderRequestId for clarity.
export function receiveLineId(reorderRequestId) {
  return `${reorderRequestId}:1`;
}

// Deterministic, stable idempotency key for a PO receipt. One receipt per ORDERED PO, so the key
// is a pure function of the reorder request id -- a retry reuses it verbatim (transport preserves
// it), yielding a `replayed` outcome rather than a double receipt.
export function receiveIdempotencyKey(reorderRequestId) {
  return `receive:${reorderRequestId}`;
}

// Resolve a receipt candidate's Part tracking mode from the SAME governed Part Master read the
// rest of the app uses (services/partMasterQueries.fetchPartMasterList's result, passed in
// verbatim -- this module stays Firebase-free). Pure and fail-closed:
//   - a non-ok fetch (permission-denied / unavailable) blocks, never defaults to NONE
//   - a partId absent from the returned list blocks as BLOCKED_NOT_FOUND (never defaults to NONE)
//   - only a genuine, present, valid-controlType Part record resolves READY with a trackingMode
export function resolvePartTrackingMode({ partsFetchResult, partId }) {
  if (typeof partId !== "string" || partId.trim() === "") return { status: PART_TRACKING_STATUS.BLOCKED_UNAVAILABLE };
  if (!isPlainObject(partsFetchResult) || partsFetchResult.ok !== true) {
    const code = isPlainObject(partsFetchResult) ? partsFetchResult.code : null;
    return {
      status: code === "permission-denied" ? PART_TRACKING_STATUS.BLOCKED_PERMISSION : PART_TRACKING_STATUS.BLOCKED_UNAVAILABLE,
    };
  }
  const parts = Array.isArray(partsFetchResult.parts) ? partsFetchResult.parts : [];
  const part = parts.find((p) => isPlainObject(p) && p.partId === partId);
  if (!part) return { status: PART_TRACKING_STATUS.BLOCKED_NOT_FOUND };
  return { status: PART_TRACKING_STATUS.READY, trackingMode: controlTypeToTrackingMode(part.controlType) };
}

// Pure diagnostic over a serial-entry array: which slots are blank, which are duplicates (exact,
// case-sensitive -- serial identity is case-significant, matching the server), and whether the
// count matches the required exact count (the receipt contract is a full exact receipt; no
// partial receipts). Used by the UI for inline messaging AND by validateSerialNumbers below for
// the pass/fail gate, so the two can never disagree.
export function describeSerialEntryIssues({ serials, expectedCount }) {
  const list = Array.isArray(serials) ? serials : [];
  const trimmed = list.map((s) => (typeof s === "string" ? s.trim() : ""));
  const blankIndexes = [];
  trimmed.forEach((s, i) => { if (s === "") blankIndexes.push(i); });
  const firstSeenAt = new Map();
  const duplicateIndexSet = new Set();
  trimmed.forEach((s, i) => {
    if (s === "") return;
    if (firstSeenAt.has(s)) {
      duplicateIndexSet.add(i);
      duplicateIndexSet.add(firstSeenAt.get(s));
    } else {
      firstSeenAt.set(s, i);
    }
  });
  const countMismatch = !(Number.isInteger(expectedCount) && expectedCount > 0 && trimmed.length === expectedCount);
  const duplicateIndexes = Array.from(duplicateIndexSet).sort((a, b) => a - b);
  return {
    ok: blankIndexes.length === 0 && duplicateIndexes.length === 0 && !countMismatch,
    blankIndexes,
    duplicateIndexes,
    countMismatch,
  };
}

// Validate + trim (never case-fold) a serial-entry array against the exact required count.
// Returns the trimmed array on success, or null (never a partial/invalid list) on failure --
// blank entries, duplicates, or a count that isn't exactly expectedCount. This is a CLIENT-SIDE
// convenience gate only; the server (receivingValidation.ts) is the actual authority and
// re-validates independently.
export function validateSerialNumbers({ serialNumbers, expectedCount }) {
  if (!Array.isArray(serialNumbers)) return null;
  const issues = describeSerialEntryIssues({ serials: serialNumbers, expectedCount });
  if (!issues.ok) return null;
  return serialNumbers.map((s) => s.trim());
}

// Assemble the exact input object domain/receivingTransport.js's buildReceiveRequest expects.
// Returns null (never a partial) when the candidate is not receivable, the locationId is blank,
// the tracking mode is LOT (deliberately not supported yet), or -- for a SERIAL Part -- the
// serial numbers don't validate. expectedQuantity === receivedQuantity === orderedQuantity (v1
// contract; no partial receipts). trackingMode is optional for backward compatibility: omitted or
// NONE produces the EXACT legacy line shape with no serialNumbers key at all.
export function buildReceiveRequestInput({ candidate, locationId, trackingMode, serialNumbers }) {
  if (!isReceivableCandidate(candidate)) return null;
  if (typeof locationId !== "string" || locationId.trim() === "") return null;
  if (trackingMode === TRACKING_MODE.LOT) return null; // LOT receiving is deliberately not supported
  const { reorderRequestId, purchaseOrderId } = candidate.receiptSource;
  const qty = candidate.orderedQuantity;
  const line = {
    lineId: receiveLineId(reorderRequestId),
    partId: candidate.partId,
    expectedQuantity: qty,
    receivedQuantity: qty,
  };
  if (trackingMode === TRACKING_MODE.SERIAL) {
    const validated = validateSerialNumbers({ serialNumbers, expectedCount: qty });
    if (validated === null) return null;
    line.serialNumbers = validated;
  }
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId, purchaseOrderId },
    receivingLocation: { type: "WAREHOUSE", locationId },
    lines: [line],
    idempotencyKey: receiveIdempotencyKey(reorderRequestId),
  };
}

// Sanitized, honest human copy for each bounded transport outcome. NEVER surfaces a raw backend
// message/code/path. `tone` drives styling only. `terminal` marks an outcome that ends the flow
// successfully (applied/replayed) vs one the user may retry or must escalate.
export function describeReceiveOutcome(status) {
  switch (status) {
    case RECEIVING_OUTCOME.APPLIED:
      return { tone: "success", terminal: true, title: "Receipt recorded", message: "The purchase order was received into inventory." };
    case RECEIVING_OUTCOME.REPLAYED:
      return { tone: "success", terminal: true, title: "Already received", message: "This receipt was already recorded — no duplicate stock was added." };
    case RECEIVING_OUTCOME.DENIED:
      return { tone: "warning", terminal: false, title: "Not permitted", message: "You don't have permission to receive inventory. This action is limited to authorized purchasing roles." };
    case RECEIVING_OUTCOME.CONFLICT:
      return { tone: "warning", terminal: false, title: "Can't receive right now", message: "This purchase order isn't in a receivable state (it may already be received or voided)." };
    case RECEIVING_OUTCOME.NOT_FOUND:
      return { tone: "warning", terminal: false, title: "Purchase order not found", message: "The purchase order or one of its references could not be found." };
    case RECEIVING_OUTCOME.INVALID:
      return { tone: "warning", terminal: false, title: "Couldn't submit", message: "The receipt details were rejected. Re-select the purchase order and try again." };
    case RECEIVING_OUTCOME.UNAUTHENTICATED:
      return { tone: "warning", terminal: false, title: "Sign in required", message: "Your session isn't authenticated. Sign in and try again." };
    case RECEIVING_OUTCOME.UNAVAILABLE:
    default:
      return { tone: "muted", terminal: false, title: "Receiving not available", message: "Receiving isn't activated in this environment yet. No receipt was submitted." };
  }
}

// Is this outcome status one where the receiving service is simply not activated (readiness
// false) vs a genuine per-request result? Used by the UI to distinguish "not turned on" from
// "you tried and were denied/conflicted".
export function isReceivingUnavailable(status) {
  return status === RECEIVING_OUTCOME.UNAVAILABLE;
}

// Sanitized, honest human copy for a blocked Part-tracking-mode read (see resolvePartTrackingMode
// above) and for the deliberate LOT-not-supported stop. Mirrors describeReceiveOutcome's style:
// never surfaces a raw code/path, and never implies the receipt could proceed anyway.
export function describePartTrackingBlock(status) {
  switch (status) {
    case PART_TRACKING_STATUS.BLOCKED_PERMISSION:
      return { title: "Can't verify this part", message: "You don't have permission to read this part's tracking details, so it can't be received. This action is limited to authorized purchasing roles." };
    case PART_TRACKING_STATUS.BLOCKED_NOT_FOUND:
      return { title: "Part not found", message: "This part could not be found in the Part Master, so it can't be received here." };
    case PART_TRACKING_STATUS.BLOCKED_UNAVAILABLE:
    default:
      return { title: "Can't verify this part", message: "This part's tracking details couldn't be read right now, so it can't be received. Try again shortly." };
  }
}

// Honest copy for a LOT-tracked Part: receiving is deliberately deferred, not broken.
export function describeLotNotSupported() {
  return { title: "Not supported yet", message: "This part is lot-tracked. Lot-tracked receiving isn't supported yet, so it can't be received here." };
}

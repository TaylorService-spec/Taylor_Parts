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

import { RECEIVING_OUTCOME } from "./receivingTransport.js";

// The linear step model of the workflow. Kept explicit so the UI and tests share one vocabulary.
export const RECEIVE_STEP = Object.freeze({
  SELECT_CANDIDATE: "SELECT_CANDIDATE", // choose an ORDERED/ORDERED receipt candidate
  SELECT_LOCATION: "SELECT_LOCATION", // choose a receiving warehouse (listReceivingLocationOptions)
  CONFIRM: "CONFIRM", // confirm the full ordered quantity, then submit
  RESULT: "RESULT", // show the governed receipt outcome
});

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

// Assemble the exact input object domain/receivingTransport.js's buildReceiveRequest expects.
// Returns null (never a partial) when the candidate is not receivable or the locationId is blank.
// expectedQuantity === receivedQuantity === orderedQuantity (v1 contract; no partial receipts).
export function buildReceiveRequestInput({ candidate, locationId }) {
  if (!isReceivableCandidate(candidate)) return null;
  if (typeof locationId !== "string" || locationId.trim() === "") return null;
  const { reorderRequestId, purchaseOrderId } = candidate.receiptSource;
  const qty = candidate.orderedQuantity;
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId, purchaseOrderId },
    receivingLocation: { type: "WAREHOUSE", locationId },
    lines: [
      {
        lineId: receiveLineId(reorderRequestId),
        partId: candidate.partId,
        expectedQuantity: qty,
        receivedQuantity: qty,
      },
    ],
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

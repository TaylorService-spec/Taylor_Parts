// Receiving a REORDER PURCHASE ORDER -- through the governed PostgreSQL Receiving authority.
//
//   browser -> THIS -> services/reorderApiClient.js -> POST /operations/inventory
//           { operation: "receiveReorderStock", input: <the frozen legacy receive request> }
//           -> verified bearer -> EOS Principal + tenant + inventory.stock.receive
//           -> ONE PostgreSQL transaction: receiving order, movements, custody, cost, Reorder ORDERED -> RECEIVED
//
// ════════════════════ WHY THIS REPLACED THE FIREBASE CALLABLE FOR THIS SOURCE ════════════════════
//
// A Reorder Purchase Order used to be received through the Firebase `receiveInventoryStock` callable. The
// Functions deployed in nonprod pre-date the Reorder freeze, so for a REORDER_PURCHASE_ORDER source that
// callable still writes the Firestore Reorder Request to RECEIVED -- while PostgreSQL, the activated Reorder
// authority, stays ORDERED. The freeze that would refuse it exists only in undeployed code, and Firebase is
// retirement-only: it will not be redeployed to add one. So the client stops calling it for this source.
//
// NO FALLBACK. A refused or failed receipt is returned as a bounded RECEIVING_OUTCOME status the screen
// renders; it is never retried against the Firebase callable. There is no export here, and no parameter,
// that could route a Reorder receipt anywhere else.
//
// ════════════════════ THE REQUEST CONTRACT IS UNCHANGED ════════════════════
//
// The payload is built by the SAME pure builder the callable client used (domain/receivingTransport.js's
// buildReceiveRequest): source { type: REORDER_PURCHASE_ORDER, reorderRequestId, purchaseOrderId }, one
// WAREHOUSE destination, exactly one line (lineId, partId, expectedQuantity, receivedQuantity, optional
// serialNumbers) and the caller's idempotencyKey carried VERBATIM. That is exactly the input
// receiveReorderStock accepts (functions/src/eosOps/receiveReorderStockCommand.ts: ALLOWED_TOP_KEYS, and the
// shared receivingBatchValidation line keys). A retry re-sends the same key and is answered `replayed`.
//
// The canonical multi-line PURCHASE_ORDER is a DIFFERENT authority with its own cutover. It is not received
// here (the builder refuses any other source type client-side, and the server refuses it again).
import { reorderApiClient } from "./reorderApiClient.js";
import { buildReceiveRequest, RECEIVING_OUTCOME } from "../domain/receivingTransport.js";

export const RECEIVE_REORDER_STOCK_OPERATION = "receiveReorderStock";

const OUTCOME_BY_FAILURE = Object.freeze({
  NOT_SIGNED_IN: RECEIVING_OUTCOME.UNAUTHENTICATED,
  UNAUTHENTICATED: RECEIVING_OUTCOME.UNAUTHENTICATED,
  FORBIDDEN: RECEIVING_OUTCOME.DENIED,
  INVALID_INPUT: RECEIVING_OUTCOME.INVALID,
  NOT_FOUND: RECEIVING_OUTCOME.NOT_FOUND,
  CONFLICT: RECEIVING_OUTCOME.CONFLICT,
  PRECONDITION_FAILED: RECEIVING_OUTCOME.CONFLICT,
});

/** Map a governed refusal to the bounded, sanitized receiving outcome. Pure; exported for tests. */
export function receiveOutcomeForFailure(res) {
  const code = res && typeof res.code === "string" ? res.code : "";
  return Object.prototype.hasOwnProperty.call(OUTCOME_BY_FAILURE, code) ? OUTCOME_BY_FAILURE[code] : RECEIVING_OUTCOME.UNAVAILABLE;
}

/**
 * Receive a Reorder Purchase Order. `request` must already carry a stable idempotencyKey; it is preserved
 * verbatim and never regenerated. Never throws.
 *
 * Returns `{ status }` on refusal, or `{ status: applied|replayed, receipt: { outcome, receivingId,
 * receivingOrderNumber } }`. No raw server message, path or detail reaches the caller.
 */
export async function submitReorderReceipt(request, { client = reorderApiClient } = {}) {
  const payload = buildReceiveRequest(request);
  // Refused CLIENT-SIDE without any call: a malformed request, or any source that is not a Reorder PO.
  if (payload === null) return { status: RECEIVING_OUTCOME.INVALID };
  let res;
  try {
    res = await client.call(RECEIVE_REORDER_STOCK_OPERATION, payload);
  } catch {
    return { status: RECEIVING_OUTCOME.UNAVAILABLE };
  }
  if (!res?.ok) return { status: receiveOutcomeForFailure(res) };
  const r = res.result;
  if (!r || (r.outcome !== "applied" && r.outcome !== "replayed")
      || typeof r.receivingId !== "string" || r.receivingId === "") {
    // A malformed success is not trusted as a receipt.
    return { status: RECEIVING_OUTCOME.UNAVAILABLE };
  }
  return {
    status: r.outcome === "replayed" ? RECEIVING_OUTCOME.REPLAYED : RECEIVING_OUTCOME.APPLIED,
    receipt: Object.freeze({
      outcome: r.outcome,
      receivingId: r.receivingId,
      receivingOrderNumber: typeof r.receivingOrderNumber === "string" ? r.receivingOrderNumber : null,
    }),
  };
}

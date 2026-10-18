// THE CANONICAL SUPPLIER PURCHASE ORDER, RECEIVED ON EOS. Firebase exit B3 (DECISIONS #B3; Owner ruling 4).
//
//   browser -> THIS -> POST /operations/inventory: listReceivableSupplierPurchaseOrders / readSupplierPurchaseOrderProgress /
//   listSupplierReceivingLocationOptions / receiveSupplierPurchaseOrder
//   -> verified bearer -> EOS Principal + tenant + inventory.stock.receive + the caller's operating companies + the WAREHOUSE scope
//   -> PostgreSQL (functions/src/eosOps/supplierPurchaseOrderReceiving.ts)
//
// It replaces the Firebase callables receiveInventoryStock / getPurchaseOrderReceivingProgress / listReceivablePurchaseOrders /
// listReceivingLocationOptions for the canonical PURCHASE_ORDER source, with the SAME four function signatures and result shapes as
// services/receivingCallableClient.js, so no screen changes. Which of the two answers is decided ONCE at BUILD time by the F1 flag
// (receivingCallableClient.js); there is no runtime fallback, in either direction.
//
// IT IS NEVER "UNAVAILABLE" BY DESIGN. The Firebase transport is fail-closed behind a readiness constant because its callables were
// deployed and unused; this one has no such constant -- the server decides authority on every call, and a refusal is returned as a
// bounded RECEIVING_OUTCOME, never a raw message. A malformed answer is UNAVAILABLE (never a partially trusted list or receipt).
//
// The request is built by the SAME pure builder as the Firebase client (domain/receivingTransport.js buildCanonicalReceiveRequest), and
// the idempotencyKey travels VERBATIM, so a retry (including one replayed from the offline queue) is answered `replayed`.
import { adaptReceivingLocationOptions } from "../domain/receivingLocationOptionAdapter.js";
import {
  buildCanonicalReceiveRequest,
  validateCanonicalReceiveResponse,
  validatePurchaseOrderProgress,
  RECEIVING_OUTCOME,
} from "../domain/receivingTransport.js";

// The transport is imported LAZILY, on the first real call: reorderApiClient.js reaches the Firebase module (it takes the signed-in user's token
// from the Administration client), and this module must stay importable -- and unit-testable -- without initializing anything.
const callReorderApi = async (...args) => (await import("./reorderApiClient.js")).callReorderApi(...args);

export const SUPPLIER_RECEIVING_OPERATIONS = Object.freeze({
  list: "listReceivableSupplierPurchaseOrders",
  progress: "readSupplierPurchaseOrderProgress",
  locations: "listSupplierReceivingLocationOptions",
  receive: "receiveSupplierPurchaseOrder",
});

const OUTCOME_BY_FAILURE = Object.freeze({
  NOT_SIGNED_IN: RECEIVING_OUTCOME.UNAUTHENTICATED,
  UNAUTHENTICATED: RECEIVING_OUTCOME.UNAUTHENTICATED,
  FORBIDDEN: RECEIVING_OUTCOME.DENIED,
  INVALID_INPUT: RECEIVING_OUTCOME.INVALID,
  NOT_FOUND: RECEIVING_OUTCOME.NOT_FOUND,
  CONFLICT: RECEIVING_OUTCOME.CONFLICT,
  PRECONDITION_FAILED: RECEIVING_OUTCOME.CONFLICT,
});

/** A governed refusal -> the bounded, sanitized outcome. Pure; exported for tests. */
export const supplierReceivingOutcomeForFailure = (res) =>
  Object.prototype.hasOwnProperty.call(OUTCOME_BY_FAILURE, res?.code) ? OUTCOME_BY_FAILURE[res.code] : RECEIVING_OUTCOME.UNAVAILABLE;

async function callOp(operation, input, call) {
  try {
    return await call(operation, input);
  } catch {
    return { ok: false, code: "UNREACHABLE" };
  }
}

/** @param {{ call?: typeof callReorderApi }} [deps] injectable transport (tests) */
export function createSupplierReceivingClient({ call = callReorderApi } = {}) {
  return Object.freeze({
    // The destinations ONE order may be received into (the adapter validates the DTO shape, fail closed).
    async fetchReceivingLocationOptions(purchaseOrderId) {
      if (typeof purchaseOrderId !== "string" || purchaseOrderId.trim() === "") return { status: RECEIVING_OUTCOME.INVALID, options: [] };
      const res = await callOp(SUPPLIER_RECEIVING_OPERATIONS.locations, { purchaseOrderId }, call);
      if (!res.ok) return { status: supplierReceivingOutcomeForFailure(res), options: [] };
      const adapted = adaptReceivingLocationOptions(res.result?.options);
      return adapted.ok ? { status: RECEIVING_OUTCOME.READY, options: adapted.options } : { status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] };
    },

    // The canonical purchase orders that may currently be received.
    async fetchReceivablePurchaseOrders() {
      const res = await callOp(SUPPLIER_RECEIVING_OPERATIONS.list, {}, call);
      if (!res.ok) return { status: supplierReceivingOutcomeForFailure(res), purchaseOrders: [] };
      const list = Array.isArray(res.result?.purchaseOrders) ? res.result.purchaseOrders : null;
      // A malformed response is UNAVAILABLE, never a partially-trusted list. An empty list is a legitimate answer.
      return list === null ? { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] } : { status: RECEIVING_OUTCOME.READY, purchaseOrders: list };
    },

    // One order's lines plus SERVER-DERIVED remaining quantities.
    async fetchPurchaseOrderProgress(purchaseOrderId) {
      const res = await callOp(SUPPLIER_RECEIVING_OPERATIONS.progress, { purchaseOrderId }, call);
      if (!res.ok) return { status: supplierReceivingOutcomeForFailure(res), progress: null };
      const progress = validatePurchaseOrderProgress(res.result);
      return progress === null ? { status: RECEIVING_OUTCOME.UNAVAILABLE, progress: null } : { status: RECEIVING_OUTCOME.READY, progress };
    },

    // Submit a canonical multi-line receipt. `request` already carries a stable idempotencyKey; it is preserved verbatim.
    async submitCanonicalReceive(request) {
      const built = buildCanonicalReceiveRequest(request);
      // Refused CLIENT-SIDE without any call: a malformed request never reaches the server.
      if (built === null) return { status: RECEIVING_OUTCOME.INVALID, receipt: null };
      const res = await callOp(SUPPLIER_RECEIVING_OPERATIONS.receive, built, call);
      if (!res.ok) return { status: supplierReceivingOutcomeForFailure(res), receipt: null };
      const receipt = validateCanonicalReceiveResponse(res.result);
      if (receipt === null) return { status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null };
      return { status: receipt.outcome === "replayed" ? RECEIVING_OUTCOME.REPLAYED : RECEIVING_OUTCOME.APPLIED, receipt };
    },
  });
}

export const supplierReceivingClient = createSupplierReceivingClient();

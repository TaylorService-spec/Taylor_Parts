// Transfer -- the EOS transport (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// WAS a thin httpsCallable transport over the Firebase transfer callables. The authority moved to PostgreSQL:
// POST /operations/transfer (functions/src/eosOps/transferOperations.ts) -- REQUESTED -> IN_TRANSIT (dispatch writes
// the OUT, re-validating origin stock under the location lock) -> COMPLETED (receive writes the IN, scoped to the
// DESTINATION warehouse); cancel only before dispatch. The screens keep the method names they were written against;
// the request shapes are the EOS validator's (partId, quantity, origin, destination, serialNumbers?, idempotencyKey).
//
// The list is the governed EOS read `listTransferOrders` (/operations/inventory): transfers whose origin or destination
// warehouse is in the caller's WAREHOUSE scope. It is adapted here to the { docId, data } rows the canonical transfer
// view-model (modules/operations/transferOrdersViewModel.js -> domain/transferOrderView.js) already validates, so
// there is ONE row shape and no second view-model.
//
// TRUCKS ARE OUT OF SCOPE (Controller: Truck Inventory is a separate journey) -- the Firebase technician-truck read
// `listMyReceivableTransfers` is not carried over.
//
// No Firebase fallback: a refusal (NOT_ACTIVATED included) is thrown as the platform's answer.
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "./eosOperationsClient.js";

export const TRANSFER_OPERATIONS = Object.freeze({
  create: "createTransfer",
  dispatch: "dispatchTransfer",
  receive: "receiveTransfer",
  cancel: "cancelTransfer",
  list: "listTransferOrders",
});

const OPTS = Object.freeze({ serviceLabel: "the transfer service" });
const write = (operation, input) => eosOperationOrThrow(EOS_OPERATIONS_ROUTES.TRANSFER, operation, input, OPTS);

/** One EOS transfer-order item as the { docId, data } row the transfer view-model reads. Pure; exported for tests. */
export function toTransferOrderDoc(item) {
  const ref = (e) => (e && typeof e === "object" ? { type: e.type, locationId: e.locationId, ...(e.warehouseId ? { warehouseId: e.warehouseId } : {}) } : e);
  return Object.freeze({
    docId: item.transferOrderId,
    data: Object.freeze({
      partId: item.partId,
      status: item.status,
      trackingMode: item.trackingMode ?? null,
      quantity: item.quantity,
      ...(Array.isArray(item.serialNumbers) && item.serialNumbers.length > 0 ? { serialNumbers: [...item.serialNumbers] } : {}),
      origin: ref(item.origin),
      destination: ref(item.destination),
      transferOrderNumber: item.transferOrderNumber ?? null,
      createdAt: item.createdAt ?? null,
      createdBy: item.createdBy ?? null,
      canReceive: item.canReceive === true,
    }),
  });
}

/** The governed transfer list, adapted. `{ items, truncated }`. */
export async function listTransferOrderDocs(input = {}, call = eosOperationOrThrow) {
  const out = await call(EOS_OPERATIONS_ROUTES.INVENTORY, TRANSFER_OPERATIONS.list, input, OPTS);
  return Object.freeze({ items: (out?.items ?? []).map(toTransferOrderDoc), truncated: out?.truncated === true });
}

export const transferCommandClient = Object.freeze({
  createTransferOrder: (request) => write(TRANSFER_OPERATIONS.create, request),
  dispatchTransferOrder: (request) => write(TRANSFER_OPERATIONS.dispatch, { transferOrderId: request?.transferOrderId }),
  receiveTransferOrder: (request) => write(TRANSFER_OPERATIONS.receive, { transferOrderId: request?.transferOrderId }),
  cancelTransferOrder: (request) => write(TRANSFER_OPERATIONS.cancel, { transferOrderId: request?.transferOrderId }),
  listTransferOrders: (input) => listTransferOrderDocs(input),
});

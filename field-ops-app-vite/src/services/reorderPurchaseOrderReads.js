// Reorder Purchase Orders and their void records, read from the GOVERNED PostgreSQL Reorder authority.
//
//   browser -> services/reorderApiClient.js -> POST /operations/inventory { operation: "readReorderPurchaseOrders" }
//           -> verified bearer -> EOS Principal + tenant + reorder.request.read + REORDER_QUEUE scope / assignment
//           -> PostgreSQL eos_ops.purchase_orders + eos_ops.purchase_order_voids
//
// ════════════════════ WHY THIS REPLACED THE FIRESTORE READS ════════════════════
//
// The screens used to read `reorder_purchase_orders` and `reorder_purchase_order_voids` straight from
// Firestore. Once PostgreSQL is the Reorder authority those collections are a FROZEN SNAPSHOT: the
// governed commands record, void and receive in PostgreSQL, and nothing writes the Firestore copy. A
// screen still reading it would present a purchase order the governed void or receipt has moved on
// from as current truth -- and the receiving candidate list would offer an order that PostgreSQL
// has already closed, or hide one it has just opened.
//
// NO FALLBACK. A refused or failed read is returned as a value the screen renders; it is never
// retried against Firestore.
//
// ════════════════════ THE ERROR VOCABULARY IS THE SCREENS', ON PURPOSE ════════════════════
//
// The view models (domain/purchaseOrdersView.js) and the record cards (PartDetail, AssociateRequestPanel)
// already distinguish "you may not see it" (`permission-denied`) from "the read failed" and from
// "there is nothing to see" (`not_found`). A refusal from the governed read is mapped onto exactly that
// vocabulary, so moving the authority changes no screen's honesty about which absence it is showing.
import { reorderApiClient } from "./reorderApiClient.js";

/** The server's per-read bound (REORDER_PURCHASE_ORDER_READ_MAX_IDS). Larger id sets are read in chunks. */
export const REORDER_PURCHASE_ORDER_READ_CHUNK = 100;

/** Map a governed refusal onto the screens' existing read-error vocabulary. Pure; exported for tests. */
export function purchaseOrderReadErrorCode(res) {
  if (res?.code === "FORBIDDEN" || res?.code === "UNAUTHENTICATED" || res?.code === "NOT_SIGNED_IN") {
    return "permission-denied";
  }
  return "unavailable";
}

/**
 * `{ ok: true, purchaseOrdersById }` keyed by reorderRequestId (== purchaseOrderId), or `{ ok: false, error }`.
 *
 * A reachable Reorder Request with no purchase order is simply absent from the map -- the ORPHAN case the
 * view model surfaces. An id the caller cannot reach refuses the WHOLE read (server-side), so a refusal is
 * never rendered as "no purchase order recorded".
 */
export async function fetchReorderPurchaseOrdersByIds(reorderRequestIds, client = reorderApiClient) {
  const ids = [...new Set((reorderRequestIds ?? []).filter((id) => typeof id === "string" && id !== ""))].sort();
  const purchaseOrdersById = {};
  for (let i = 0; i < ids.length; i += REORDER_PURCHASE_ORDER_READ_CHUNK) {
    const res = await client.call("readReorderPurchaseOrders", {
      reorderRequestIds: ids.slice(i, i + REORDER_PURCHASE_ORDER_READ_CHUNK),
    });
    if (!res?.ok) return { ok: false, error: purchaseOrderReadErrorCode(res) };
    const list = Array.isArray(res.result?.purchaseOrders) ? res.result.purchaseOrders : null;
    // A malformed answer is a failed read, never a partially-trusted empty one.
    if (list === null) return { ok: false, error: "unavailable" };
    for (const po of list) {
      if (po && typeof po.id === "string" && po.id !== "") purchaseOrdersById[po.id] = po;
    }
  }
  return { ok: true, purchaseOrdersById };
}

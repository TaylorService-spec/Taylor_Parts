import { useEffect, useRef, useState } from "react";
import { fetchReorderPurchaseOrdersByIds } from "../services/reorderPurchaseOrderReads.js";

// Purchasing > Purchase Orders (item C), Receiving, Receipts, Receive-against-PO. Resolves a SET of
// reorder-request ids -> { purchaseOrderId(==id): Reorder Purchase Order } for the cross-request PO
// list, re-fetching only when the id set changes.
//
// THE AUTHORITY MOVED. This hook used to read Firestore `reorder_purchase_orders` with chunked
// `documentId() in` queries. At the Reorder activation that collection became a frozen snapshot, so it
// now asks the governed PostgreSQL Reorder authority (services/reorderPurchaseOrderReads.js ->
// `readReorderPurchaseOrders`), with NO Firestore fallback. The returned state shape is unchanged.
//
// READ-ONLY. This hook writes nothing and never touches receiving_orders.
//
// It PRESERVES the read error rather than swallowing it -- same W2 discipline as
// useReorderRequestsByStatuses. A denied/unavailable purchase-order read must NOT be silently
// downgraded to "these rows need attention": the caller's view-model fails the whole surface closed
// on this error. `error` is null on a clean read; a missing PO (read succeeded, PO absent) is NOT an
// error -- that is the genuine ORPHAN case the view-model surfaces.
export function usePurchaseOrdersByIds(reorderRequestIds, deps = {}) {
  const [state, setState] = useState(() => ({ purchaseOrdersById: {}, loading: false, error: null }));
  // The client is an injection seam, not reactive state.
  const clientRef = useRef(deps.client);
  clientRef.current = deps.client;
  // Stable effect key: sorted, de-duplicated, non-blank ids.
  const key = Array.from(new Set((reorderRequestIds ?? []).filter(Boolean))).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setState({ purchaseOrdersById: {}, loading: false, error: null });
      return undefined;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchReorderPurchaseOrdersByIds(ids, clientRef.current)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Preserve the failure -> the view-model fails the surface closed, instead of rendering a
          // permission/connection failure as spurious ORPHAN rows.
          setState({ purchaseOrdersById: {}, loading: false, error: res.error });
          return;
        }
        setState({ purchaseOrdersById: res.purchaseOrdersById, loading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ purchaseOrdersById: {}, loading: false, error: "unknown" });
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

import { useEffect, useRef, useState } from "react";
import { fetchReorderPurchaseOrdersByIds } from "../services/reorderPurchaseOrderReads.js";

// Cancel/Void (docs/specifications/reorder-request-cancellation.md). The void record of one Reorder
// Purchase Order -- keyed by the shared reorderRequestId. Read-only: the void is written only by the
// governed voidReorderPurchaseOrder command (domain/reorderPurchaseOrders.js's voidPurchaseOrder()).
//
// THE AUTHORITY MOVED. This was a Firestore onSnapshot on `reorder_purchase_order_voids/{id}`. At the
// Reorder activation that collection became a frozen snapshot, so it now asks the governed PostgreSQL
// Reorder authority (`readReorderPurchaseOrders`, which returns each purchase order WITH its void record)
// with NO Firestore fallback.
//
// H14 (reorder pair) -- `error` is `"not_found"` on a successful read that finds no void record (or no
// purchase order to void), or `"permission-denied"` / `"unavailable"` on a refused or failed read.
export function useReorderPurchaseOrderVoid(reorderRequestId, deps = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const clientRef = useRef(deps.client);
  clientRef.current = deps.client;

  useEffect(() => {
    if (!reorderRequestId) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    fetchReorderPurchaseOrdersByIds([reorderRequestId], clientRef.current)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ data: null, loading: false, error: res.error ?? "unknown" });
          return;
        }
        const record = res.purchaseOrdersById[reorderRequestId]?.void ?? null;
        setState(record
          ? { data: { id: reorderRequestId, ...record }, loading: false, error: null }
          : { data: null, loading: false, error: "not_found" });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: "unknown" });
      });
    return () => {
      cancelled = true;
    };
  }, [reorderRequestId]);

  return state;
}

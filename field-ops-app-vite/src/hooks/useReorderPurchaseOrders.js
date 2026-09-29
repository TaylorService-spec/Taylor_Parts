import { useEffect, useRef, useState } from "react";
import { fetchReorderPurchaseOrdersByIds } from "../services/reorderPurchaseOrderReads.js";

// Sprint 2.1.10 -- Purchase Order Foundation. Single-record read -- the Reorder Purchase Order's id IS
// the reorderRequestId. Read-only: writes go exclusively through domain/reorderPurchaseOrders.js's
// recordPurchaseOrder(), which reaches the governed command.
//
// THE AUTHORITY MOVED. This was a Firestore onSnapshot on `reorder_purchase_orders/{id}`. At the Reorder
// activation that collection became a frozen snapshot, so it now asks the governed PostgreSQL Reorder
// authority (`readReorderPurchaseOrders`, one id) with NO Firestore fallback. It is a fetch per id change,
// not a live subscription.
//
// H14 (reorder pair) -- `error` keeps the contract the record cards render: `"not_found"` when the read
// succeeds and the purchase order does not exist, or `"permission-denied"` / `"unavailable"` when the
// read itself is refused or fails. "You cannot see it" stays distinguishable from "there is nothing to see".
export function usePurchaseOrderForReorderRequest(reorderRequestId, deps = {}) {
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
        const po = res.purchaseOrdersById[reorderRequestId] ?? null;
        setState(po ? { data: po, loading: false, error: null } : { data: null, loading: false, error: "not_found" });
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

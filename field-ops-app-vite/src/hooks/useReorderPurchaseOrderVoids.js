import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { REORDER_PURCHASE_ORDER_VOIDS_COLLECTION } from "../domain/constants";

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Mirrors
// useReorderPurchaseOrders.js's usePurchaseOrderForReorderRequest() --
// a void record's document ID IS the reorderRequestId (see
// domain/constants.js), so this is a direct doc() subscription, not a
// query. Read-only: writes go exclusively through
// domain/reorderPurchaseOrders.js's voidPurchaseOrder().
export function useReorderPurchaseOrderVoid(reorderRequestId) {
  const [state, setState] = useState({ data: null, loading: true });

  useEffect(() => {
    if (!reorderRequestId) {
      setState({ data: null, loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const ref = doc(db, REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, reorderRequestId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...snap.data() } : null, loading: false }),
      () => setState({ data: null, loading: false })
    );

    return unsubscribe;
  }, [reorderRequestId]);

  return state;
}

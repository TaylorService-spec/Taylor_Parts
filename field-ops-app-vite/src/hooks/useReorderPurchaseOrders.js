import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { PURCHASE_ORDERS_COLLECTION } from "../domain/constants";

// Sprint 2.1.10 -- Purchase Order Foundation. Realtime, single-document
// read -- the Reorder Purchase Order's document ID IS the
// reorderRequestId (see domain/constants.js), so this is a direct
// doc() subscription, not a query. Read-only: writes go exclusively
// through domain/reorderPurchaseOrders.js's recordPurchaseOrder().
export function usePurchaseOrderForReorderRequest(reorderRequestId) {
  const [state, setState] = useState({ data: null, loading: true });

  useEffect(() => {
    if (!reorderRequestId) {
      setState({ data: null, loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const ref = doc(db, PURCHASE_ORDERS_COLLECTION, reorderRequestId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...snap.data() } : null, loading: false }),
      () => setState({ data: null, loading: false })
    );

    return unsubscribe;
  }, [reorderRequestId]);

  return state;
}

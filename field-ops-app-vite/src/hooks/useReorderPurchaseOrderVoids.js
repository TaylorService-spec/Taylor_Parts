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
//
// H14 (reorder pair) -- this hook used to write the SAME state
// ({ data: null, loading: false }) for a denied read as for "no void
// record exists", collapsing "you cannot see it" into "there is
// nothing to see". `error` is a new field, same contract as
// usePurchaseOrderForReorderRequest()'s sibling fix: `"not_found"` on
// a successful read that finds no such document, or the real
// Firestore SDK error code on a failed read. Existing callers that
// destructure only { data, loading } are unaffected.
export function useReorderPurchaseOrderVoid(reorderRequestId) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!reorderRequestId) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState({ data: null, loading: true, error: null });
    const ref = doc(db, REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, reorderRequestId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setState({ data: null, loading: false, error: "not_found" });
          return;
        }
        setState({ data: { id: snap.id, ...snap.data() }, loading: false, error: null });
      },
      (err) => setState({ data: null, loading: false, error: err.code ?? "unknown" })
    );

    return unsubscribe;
  }, [reorderRequestId]);

  return state;
}

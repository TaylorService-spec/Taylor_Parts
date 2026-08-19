import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { PURCHASE_ORDERS_COLLECTION } from "../domain/constants";

// Sprint 2.1.10 -- Purchase Order Foundation. Realtime, single-document
// read -- the Reorder Purchase Order's document ID IS the
// reorderRequestId (see domain/constants.js), so this is a direct
// doc() subscription, not a query. Read-only: writes go exclusively
// through domain/reorderPurchaseOrders.js's recordPurchaseOrder().
//
// H14 (reorder pair) -- this hook used to write the SAME state
// ({ data: null, loading: false }) for a denied read as for "the
// document does not exist", so a Parts Associate whose read was
// denied saw the identical "Purchase Order details unavailable" copy
// as a genuine not-yet-recorded PO -- the real answer ("you cannot
// see it") was indistinguishable from "there is nothing to see".
// `error` is a new field, mirroring hooks/useReorderRequests.js's
// useReorderRequestById(): `"not_found"` when the read succeeds and
// the document does not exist, or the real Firestore SDK error code
// (e.g. `"permission-denied"`, `"unavailable"`) when the read itself
// fails. Existing callers that destructure only { data, loading } are
// unaffected.
export function usePurchaseOrderForReorderRequest(reorderRequestId) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!reorderRequestId) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState({ data: null, loading: true, error: null });
    const ref = doc(db, PURCHASE_ORDERS_COLLECTION, reorderRequestId);
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

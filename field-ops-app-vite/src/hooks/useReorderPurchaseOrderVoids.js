import { useEffect, useState, useSyncExternalStore } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
import {
  subscribeReorderRequestsChanged,
  getReorderRequestsVersion,
} from "../domain/reorderRequestsChanged";

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
  // Was a realtime doc subscription, and a void is written from a different component than the one
  // displaying it -- so it follows the same change signal as the reorder reads rather than losing
  // the refresh a callable cannot provide.
  const changeVersion = useSyncExternalStore(
    subscribeReorderRequestsChanged,
    getReorderRequestsVersion,
    getReorderRequestsVersion,
  );

  useEffect(() => {
    if (!reorderRequestId) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState({ data: null, loading: true, error: null });
    // GOVERNED READ. The void document's id IS the reorder request id, so a keyed lookup with one
    // value is the same document the doc() read fetched.
    let active = true;
    governedCollectionClient
      .readGovernedList({
        sourceId: "purchaseOrderVoidsByIds",
        filters: { ids: [reorderRequestId] },
        pageSize: 1,
      })
      .then((outcome) => {
        if (!active) return;
        if (!outcome.ok) {
          // "not_found" is the ORDINARY case here -- most purchase orders are never voided -- which
          // is exactly why a failed read must not be allowed to look like it.
          setState({
            data: null,
            loading: false,
            error: outcome.result === "DENIED" ? "permission-denied" : "unknown",
          });
          return;
        }
        const data = outcome.items[0] ?? null;
        setState(
          data
            ? { data, loading: false, error: null }
            : { data: null, loading: false, error: "not_found" },
        );
      });

    return () => {
      active = false;
    };
  }, [reorderRequestId, changeVersion]);

  return state;
}

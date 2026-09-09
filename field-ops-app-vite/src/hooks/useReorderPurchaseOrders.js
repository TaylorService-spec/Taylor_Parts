import { useEffect, useState, useSyncExternalStore } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
import {
  subscribeReorderRequestsChanged,
  getReorderRequestsVersion,
} from "../domain/reorderRequestsChanged";

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
  // This was a REALTIME doc subscription, and recording a PO is a reorder-lifecycle write made from
  // a different component than the one displaying it. So it subscribes to the same change signal
  // the reorder reads use -- the callable cannot stream, and losing the refresh here would be the
  // same defect in a different card.
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
    // GOVERNED READ. The document id IS the reorder request id, so the keyed-lookup source with a
    // single value answers exactly what the doc() read did -- same document, same authority
    // (reorder.purchaseOrder.read), resolved server-side instead of by Rules.
    let active = true;
    governedCollectionClient
      .readGovernedList({
        sourceId: "purchaseOrdersByIds",
        filters: { ids: [reorderRequestId] },
        pageSize: 1,
      })
      .then((outcome) => {
        if (!active) return;
        if (!outcome.ok) {
          // "not_found" stays reserved for an empty SUCCESSFUL read: a refused or unreachable read
          // is a different fact from "no purchase order was ever recorded against this request".
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

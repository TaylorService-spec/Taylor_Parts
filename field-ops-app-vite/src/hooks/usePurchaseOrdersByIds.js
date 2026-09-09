import { useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";

// Purchasing > Purchase Orders (item C). Resolves a SET of reorder-request ids ->
// { purchaseOrderId(==id): reorder_purchase_orders doc } for the cross-request PO
// list. One-shot getDocs, chunked into Firestore `documentId() in` queries
// (<=10 ids each), re-fetching only when the id set changes -- exactly the
// useAccountNames.js pattern. A reorder Purchase Order is never updated after
// creation (Rules deny client update/delete; VOIDED is a separate append-only
// record), so a live per-doc listener would be wasteful here.
//
// READ-ONLY. This hook writes nothing, calls no Cloud Function, and never touches
// receiving_orders. `reorder_purchase_orders` read is gated by isAdminOrDispatcher()
// (or a PARTS_ASSOCIATE who owns the linked request); use this on the
// admin/dispatcher Purchasing surface.
//
// It PRESERVES the read error (err.code) rather than swallowing it -- same W2
// discipline as useReorderRequestsByStatuses. A denied/unavailable purchase-order
// read must NOT be silently downgraded to "these rows need attention": the caller's
// view-model fails the whole surface closed on this error. `error` is null on a
// clean read; a missing PO doc (read succeeded, doc absent) is NOT an error -- that
// is the genuine ORPHAN case the view-model surfaces.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function usePurchaseOrdersByIds(reorderRequestIds) {
  const [state, setState] = useState(() => ({ purchaseOrdersById: {}, loading: false, error: null }));
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
    (async () => {
      const map = {};
      // CHUNKED STILL -- 30 now rather than 10, the source's declared ceiling for an "in" filter
      // and Firestore's own limit for the query behind it. Resolving a set of ids larger than one
      // page is still several reads; that has not changed by moving the read server-side.
      for (const idChunk of chunk(ids, 30)) {
        const outcome = await governedCollectionClient.readGovernedList({
          sourceId: "purchaseOrdersByIds",
          filters: { ids: idChunk },
          pageSize: idChunk.length,
        });
        if (!outcome.ok) {
          // Preserve the failure -> the view-model fails the surface closed, instead of rendering a
          // permission/connection failure as spurious ORPHAN rows. A partial map is discarded for
          // the same reason: the ids that happened not to arrive would read as orphans.
          if (!cancelled) {
            setState({
              purchaseOrdersById: {},
              loading: false,
              error: outcome.result === "DENIED" ? "permission-denied" : "unknown",
            });
          }
          return;
        }
        for (const row of outcome.items) {
          map[row.id] = row;
        }
      }
      if (!cancelled) setState({ purchaseOrdersById: map, loading: false, error: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

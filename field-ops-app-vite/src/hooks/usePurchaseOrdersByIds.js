import { useEffect, useState } from "react";
import { collection, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { PURCHASE_ORDERS_COLLECTION } from "../domain/constants";

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
      try {
        for (const idChunk of chunk(ids, 10)) {
          const snap = await getDocs(
            query(collection(db, PURCHASE_ORDERS_COLLECTION), where(documentId(), "in", idChunk))
          );
          snap.forEach((d) => {
            map[d.id] = { id: d.id, ...d.data() };
          });
        }
      } catch (err) {
        // Preserve the failure -> the view-model fails the surface closed, instead
        // of rendering a permission/connection failure as spurious ORPHAN rows.
        if (!cancelled) setState({ purchaseOrdersById: {}, loading: false, error: err?.code ?? "unknown" });
        return;
      }
      if (!cancelled) setState({ purchaseOrdersById: map, loading: false, error: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

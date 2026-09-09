import { useEffect, useRef, useState } from "react";
import { WORK_ORDER_READ_RESULT, readScopedWorkOrders } from "../access/scopedWorkOrderClient.js";
import {
  workOrderSearchQueryShape,
  interpretWorkOrderSearchRead,
  WORK_ORDER_SEARCH_CAP,
} from "../domain/workOrderSearch.js";

// The ONLY place Work Order search touches Firestore. domain/workOrderSearch.js decided
// the prefix range, the bound, the truncation probe and every resulting state already;
// this hook debounces and issues it, and adds no filter, limit or ordering of its own —
// anything invented here would be a query nobody proved is bounded.
//
// A one-shot read per settled keystroke, not a subscription: a search box re-queries by
// nature, and a live listener per character would leak one subscription per keystroke.
const DEBOUNCE_MS = 300;

export function useWorkOrderSearch(term, { cap = WORK_ORDER_SEARCH_CAP } = {}) {
  const [raw, setRaw] = useState({ docs: null, loading: false, error: null });
  // Guards the stale-response race: a slow earlier query landing after a newer keystroke
  // would otherwise overwrite the newer (or blank) result.
  const requestRef = useRef(0);

  useEffect(() => {
    const shape = workOrderSearchQueryShape({ term, collection: WORK_ORDERS_COLLECTION, cap });
    const token = (requestRef.current += 1);

    if (!shape) {
      setRaw({ docs: null, loading: false, error: null });
      return undefined;
    }

    setRaw((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(async () => {
      // The SERVER builds the prefix range now. domain/workOrderSearch.js still decides the term,
      // the bound and the truncation probe -- and its `shape` still drives them -- but the two
      // comparison bounds it used to hand to Firestore are the seam's to construct: a client holding
      // both ends of a range is a client holding a query language.
      //
      // The bound is still shape.limit (cap + 1), so the truncation PROBE survives intact and
      // interpretWorkOrderSearchRead's TRUNCATED state keeps meaning what it meant.
      const res = await readScopedWorkOrders({
        mode: "search",
        params: { term: shape.term },
        pageSize: shape.limit,
      });
      if (token !== requestRef.current) return;
      if (!res.ok) {
        // docs stays null, never [], so a failed read is not mistaken for "no such work order".
        const error = new Error("work order search failed");
        error.code = res.result === WORK_ORDER_READ_RESULT.DENIED ? "permission-denied" : "unavailable";
        setRaw({ docs: null, loading: false, error });
        return;
      }
      setRaw({ docs: res.items, loading: false, error: null });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, cap]);

  return interpretWorkOrderSearchRead({ term, ...raw, cap });
}

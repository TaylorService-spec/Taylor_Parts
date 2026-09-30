import { useEffect, useRef, useState } from "react";
import { listWorkOrders } from "../services/workOrderService";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import {
  workOrderSearchQueryShape,
  interpretWorkOrderSearchRead,
  WORK_ORDER_SEARCH_CAP,
} from "../domain/workOrderSearch.js";

// Work Order search over the GOVERNED EOS route (listWorkOrders { search }) -- never Firestore.
// domain/workOrderSearch.js still decides the bound, the truncation probe (cap + 1) and every resulting
// state; this hook debounces and issues the read. The server matches the term against the Work Order
// number and the customer name (case-insensitive), bounded by `limit`.
//
// A one-shot read per settled keystroke, not a subscription.
const DEBOUNCE_MS = 300;
const SERVER_SEARCH_MAX = 100;

export function useWorkOrderSearch(term, { cap = WORK_ORDER_SEARCH_CAP } = {}) {
  const [raw, setRaw] = useState({ docs: null, loading: false, error: null });
  // Guards the stale-response race: a slow earlier read landing after a newer keystroke.
  const requestRef = useRef(0);

  useEffect(() => {
    // The shape is kept as the single decision about "is this a search at all" and its bound.
    const shape = workOrderSearchQueryShape({ term, collection: WORK_ORDERS_COLLECTION, cap });
    const token = (requestRef.current += 1);

    if (!shape) {
      setRaw({ docs: null, loading: false, error: null });
      return undefined;
    }

    setRaw((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(async () => {
      try {
        const { items } = await listWorkOrders({
          search: String(term ?? "").trim().slice(0, SERVER_SEARCH_MAX),
          limit: shape.limit,
        });
        if (token !== requestRef.current) return;
        setRaw({ docs: items, loading: false, error: null });
      } catch (error) {
        if (token !== requestRef.current) return;
        // docs stays null, never [], so a failed read is not mistaken for "no such work order".
        setRaw({ docs: null, loading: false, error });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, cap]);

  return interpretWorkOrderSearchRead({ term, ...raw, cap });
}

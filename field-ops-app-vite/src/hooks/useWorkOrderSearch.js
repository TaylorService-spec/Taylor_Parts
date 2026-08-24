import { useEffect, useRef, useState } from "react";
import { collection, getDocs, limit as fsLimit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
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
      try {
        const q = query(
          collection(db, shape.collection),
          where(shape.fieldPath, ">=", shape.start),
          where(shape.fieldPath, "<=", shape.end),
          orderBy(shape.fieldPath, "asc"),
          fsLimit(shape.limit),
        );
        const snap = await getDocs(q);
        if (token !== requestRef.current) return;
        setRaw({ docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null });
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

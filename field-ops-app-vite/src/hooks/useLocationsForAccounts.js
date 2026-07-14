import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { LOCATIONS_COLLECTION } from "../domain/constants";

// Work Order wizard -- Customer picker. Fetches the locations for the BOUNDED
// set of visible candidate accounts in ONE batched query
// (`where("accountId", "in", ids)`), grouped by accountId -- no per-customer
// query loop. `in` is a single-field filter, so it uses the automatic
// single-field index; NO composite index is added. The candidate set is capped
// well under Firestore's `in` limit (30) by the picker's result limit.
//
// A sibling of useLocationsForAccount (single account) -- not a modification of
// it, so the existing Step 2 single-account listener is untouched.
export function useLocationsForAccounts(accountIds = []) {
  // Stable primitive dependency: the query only re-subscribes when the actual
  // set of candidate ids changes, not on every array-identity change.
  const key = accountIds.join(",");
  const [byAccount, setByAccount] = useState(() => new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setByAccount(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, LOCATIONS_COLLECTION), where("accountId", "in", ids));
    const unsub = onSnapshot(q, (snap) => {
      const grouped = new Map();
      for (const d of snap.docs) {
        const loc = { id: d.id, ...d.data() };
        const list = grouped.get(loc.accountId) ?? [];
        list.push(loc);
        grouped.set(loc.accountId, list);
      }
      setByAccount(grouped);
      setLoading(false);
    });
    return () => unsub();
  }, [key]);

  return { byAccount, loading };
}

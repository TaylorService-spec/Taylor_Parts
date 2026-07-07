import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { LOCATIONS_COLLECTION } from "../domain/constants";

// Sprint 2.0.2 -- Customer Foundation. A separate, additional scoped
// listener -- same precedent as PT-002's subscribeAssignedWorkOrders()/
// useAssignedWorkOrders(), not a modification of the generic
// useFirestoreCollection() hook. A single-field equality query needs
// no composite index.
export function useLocationsForAccount(accountId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, LOCATIONS_COLLECTION), where("accountId", "==", accountId));
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsub();
  }, [accountId]);

  return { data, loading };
}

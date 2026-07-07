import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { CONTACTS_COLLECTION } from "../domain/constants";

// Sprint 2.0.2 -- Customer Foundation. Same scoped-listener shape as
// useLocationsForAccount.js -- a separate, additional listener, not a
// modification of useFirestoreCollection().
export function useContactsForAccount(accountId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, CONTACTS_COLLECTION), where("accountId", "==", accountId));
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsub();
  }, [accountId]);

  return { data, loading };
}

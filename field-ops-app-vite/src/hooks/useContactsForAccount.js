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
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!accountId) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const q = query(collection(db, CONTACTS_COLLECTION), where("accountId", "==", accountId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      // Without an error handler a denied/failed listener would leave loading
      // stuck true forever; surface the error and stop loading instead.
      (err) => {
        setError(err);
        setData([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accountId]);

  return { data, loading, error };
}

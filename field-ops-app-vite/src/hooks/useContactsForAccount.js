import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { CONTACTS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "contacts";

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
      // stuck true forever; surface a safe error and stop loading instead.
      // loadErrorMessage never emits a raw code, path, id, or stack -- the
      // same discipline useLocationsForAccount applies (site-work #8: this
      // hook's error was previously a raw Firebase error object that
      // AccountDetail's Contacts section ignored outright).
      (err) => {
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setData([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accountId]);

  return { data, loading, error };
}

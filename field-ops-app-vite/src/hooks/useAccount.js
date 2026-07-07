import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { ACCOUNTS_COLLECTION } from "../domain/constants";

// Sprint 2.0.2 -- Customer Foundation. Single-document live listener,
// same onSnapshot(doc(...)) shape already used by
// useCurrentTechnician.js -- not a new pattern.
export function useAccount(accountId) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setAccount(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(doc(db, ACCOUNTS_COLLECTION, accountId), (snap) => {
      setAccount(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });

    return () => unsub();
  }, [accountId]);

  return { account, loading };
}

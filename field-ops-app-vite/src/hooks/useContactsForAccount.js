import { useCallback, useEffect, useState } from "react";
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
  // Bumped by retry() to force a clean teardown + re-subscribe -- the same pattern
  // useLocationsForAccount.js already uses. Site-work sweep #8: a failed Contacts read
  // used to have no recovery affordance at all (unlike the identical Locations case,
  // which already exposes retry()); AccountDetail's Contacts section wires this into
  // MetadataListGrid's onRetry.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!accountId) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Obsolete-callback guard: a snapshot or error that arrives after this effect is torn
    // down (accountId changed, unmount, or a retry) must not write state belonging to a
    // subscription that no longer exists -- same guard as useLocationsForAccount.js.
    let active = true;
    setLoading(true);
    setError(null);
    const q = query(collection(db, CONTACTS_COLLECTION), where("accountId", "==", accountId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!active) return;
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
        if (!active) return;
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setData([]);
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [accountId, attempt]);

  return { data, loading, error, retry };
}

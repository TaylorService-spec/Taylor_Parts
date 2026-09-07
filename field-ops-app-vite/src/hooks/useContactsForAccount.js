import { useCallback, useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
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
    // GOVERNED READ, not a Firestore listener. `contacts` is denied to every client in
    // firestore.rules now -- rules management came out of Firebase -- so this resolves
    // `crm.contact.read` server-side instead. The accountId filter is declared by the collection's
    // registry entry; an undeclared filter is refused rather than silently dropped, which is what
    // stops a scoped read quietly becoming a read of every contact in the company.
    //
    // ONE-SHOT, not a subscription. A callable cannot stream, so this no longer repaints when
    // somebody else edits a contact. `retry()` is the refresh path and was already wired to the
    // section's onRetry.
    governedCollectionClient
      .readGovernedCollection({
        collection: CONTACTS_COLLECTION,
        filters: [{ field: "accountId", op: "==", value: accountId }],
      })
      .then((outcome) => {
        if (!active) return;
        if (outcome.ok) {
          setData(outcome.rows);
          setError(null);
          setLoading(false);
          return;
        }
        // A refused or unreachable read is an ERROR, never an empty list: [] here would state
        // that this account has no contacts. loadErrorMessage still emits no code, path or stack.
        setError(loadErrorMessage(new Error(outcome.result), { entity: ENTITY }));
        setData([]);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accountId, attempt]);

  return { data, loading, error, retry };
}

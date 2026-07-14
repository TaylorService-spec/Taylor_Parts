import { useCallback, useEffect, useState } from "react";
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
// Fails closed on a listener error: exposes a safe boolean `error` (never a raw
// Firebase message/code/id), clears any stale results, and stops loading -- so
// the picker can show a distinct "unavailable" state instead of hanging on the
// loading state. Each new candidate query (or an explicit retry) clears the
// prior error and stale results first. An `active` guard prevents a stale/
// obsolete listener callback from restoring old data after the deps change.
//
// A sibling of useLocationsForAccount (single account) -- not a modification of
// it, so the existing Step 2 single-account listener is untouched.
export function useLocationsForAccounts(accountIds = []) {
  // Stable primitive dependency: the query only re-subscribes when the actual
  // set of candidate ids changes, not on every array-identity change.
  const key = accountIds.join(",");
  const [byAccount, setByAccount] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Bumped by retry() to deterministically re-run the query (no auto-retry).
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    // New candidate query (or retry): drop the prior error AND any stale results
    // up front, so nothing from a previous candidate set lingers.
    setError(false);
    setByAccount(new Map());
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const q = query(collection(db, LOCATIONS_COLLECTION), where("accountId", "in", ids));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!active) return; // obsolete callback -- must not restore stale data
        const grouped = new Map();
        for (const d of snap.docs) {
          const loc = { id: d.id, ...d.data() };
          const list = grouped.get(loc.accountId) ?? [];
          list.push(loc);
          grouped.set(loc.accountId, list);
        }
        setByAccount(grouped);
        setError(false);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        // Dev-only log; NEVER surfaced to the UI (no raw message/code/id).
        console.error("useLocationsForAccounts: locations query failed", err);
        setByAccount(new Map()); // clear any stale/partial results
        setError(true);
        setLoading(false);
      }
    );
    return () => {
      active = false;
      unsub();
    };
  }, [key, retryNonce]);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  return { byAccount, loading, error, retry };
}

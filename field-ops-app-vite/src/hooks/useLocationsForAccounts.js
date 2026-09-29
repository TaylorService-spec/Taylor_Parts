import { useCallback, useEffect, useState } from "react";
import { locationRowFromCrm, readAllPages } from "../services/crmApiClient.js";

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
    // CRM CUTOVER: each Account's customer sites from the governed PostgreSQL CRM authority (EOS API). One-shot, bounded.
    (async () => {
      const grouped = new Map();
      for (const accountId of ids) {
        const res = await readAllPages("listAccountLocations", { accountId }, locationRowFromCrm);
        if (!active) return;
        if (!res.ok) {
          console.error("useLocationsForAccounts: locations read failed", res.code);
          setByAccount(new Map());
          setError(true);
          setLoading(false);
          return;
        }
        grouped.set(accountId, res.rows);
      }
      setByAccount(grouped);
      setError(false);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [key, retryNonce]);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  return { byAccount, loading, error, retry };
}

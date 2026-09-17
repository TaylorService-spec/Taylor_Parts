// EOS API (PostgreSQL CRM) implementation. Selected by src/hooks/useLocationsForAccounts.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/hooks/useLocationsForAccounts.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { useCallback, useEffect, useState } from "react";
import { locationRowFromCrm, readAllPages } from "../../../services/crmApiClient.js";

// Work Order wizard -- Customer picker. Reads the customer sites for the BOUNDED set of visible candidate accounts
// (capped by the picker's result limit), grouped by accountId, one bounded listAccountLocations read per account.
//
// Fails closed: exposes a safe boolean `error` (never a raw message/code/id), clears any stale results, and stops
// loading. Each new candidate set (or an explicit retry) clears the prior error and stale results first. An `active`
// guard prevents an obsolete read from restoring old data after the deps change.
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

import { useCallback, useEffect, useState } from "react";
import { fetchCrmActivities } from "../services/crmActivityCallableClient.js";

// One-shot read of an account's CRM Activity timeline. Own loading/error state (mirrors
// hooks/useAccountAr.js's cancelled-guard shape) so a slow/failed read never blocks or misrepresents any
// other Account section. Exposes `refetch` so the caller (ActivityAndNotesSection) can pull the fresh
// list immediately after a successful create, without waiting for a full remount.
export function useCrmActivities(accountId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState((prev) => ({ ...prev, loading: true }));
    fetchCrmActivities(accountId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { ...state, refetch };
}

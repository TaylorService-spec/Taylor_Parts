import { useEffect, useState } from "react";
import { fetchAccountScheduledWorkOrdersForAttention } from "../domain/accountWorkOrders.js";

// Wave 7 extension, PART 1.6 -- one-shot, account-scoped read of this account's SCHEDULED work orders,
// feeding domain/accountAttentionProjection.js's accountWorkOrderPastDueItems(). Mirrors
// hooks/useAccountAr.js's shape exactly: own loading/error state, cancelled-guard, so a slow/failed read
// here never blocks or misrepresents any other Account Attention source (AR has its own independent hook).
//
// `workOrders` stays `null` on error/loading (never `[]`) -- the domain projection treats non-array input
// as "unavailable", so this hook must never substitute a fabricated empty array for a failed read.
export function useAccountAttentionWorkOrders(accountId) {
  const [state, setState] = useState({ loading: true, error: false, workOrders: null, truncated: false });

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, error: false, workOrders: null, truncated: false });
      return undefined;
    }
    setState({ loading: true, error: false, workOrders: null, truncated: false });
    fetchAccountScheduledWorkOrdersForAttention(accountId)
      .then(({ items, hasMore }) => {
        if (cancelled) return;
        setState({ loading: false, error: false, workOrders: items, truncated: hasMore });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, error: true, workOrders: null, truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

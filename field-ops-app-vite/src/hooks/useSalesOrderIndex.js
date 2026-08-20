import { useCallback, useEffect, useState } from "react";
import { fetchSalesOrderIndex } from "../services/salesOrderIndexReadCallableClient.js";

// One page of the cross-account Sales Order index, with an explicit `refetch` and
// cursor-based `loadMore`. Mirrors hooks/useSalesOrder.js's cancelled-guard shape so a
// slow or failed read never blocks or misrepresents anything else on the page.
//
// APPENDS rather than replaces on loadMore. The callable is cursor-paginated, so page 2
// is a continuation of page 1, not a substitute for it -- replacing would silently drop
// rows the user has already seen and make the list look shorter the further they scroll.
//
// A STATE FILTER CHANGE IS A NEW LIST, not more of the old one. Changing `state` resets
// rows and the cursor together; carrying a cursor from the unfiltered query into a
// filtered one would page through the wrong result set.
export function useSalesOrderIndex({ state = null, limit = 50 } = {}) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorStatus, setErrorStatus] = useState(null);
  const [refetchToken, setRefetchToken] = useState(0);

  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  // First page. Re-runs when the filter changes or refetch() is called.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorStatus(null);
    fetchSalesOrderIndex({ limit, ...(state ? { state } : {}) }).then(({ result, errorStatus: err }) => {
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setErrorStatus(err);
        setRows([]);
        setCursor(null);
        return;
      }
      setRows(Array.isArray(result?.salesOrders) ? result.salesOrders : []);
      setCursor(result?.nextCursor ?? null);
      setSkipped(Number.isFinite(result?.skipped) ? result.skipped : 0);
    });
    return () => {
      cancelled = true;
    };
  }, [state, limit, refetchToken]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    fetchSalesOrderIndex({ limit, cursor, ...(state ? { state } : {}) }).then(({ result, errorStatus: err }) => {
      setLoadingMore(false);
      if (err) {
        // A failed CONTINUATION must not discard the rows already on screen -- those were
        // really read and are still true. Surfacing the error while keeping them is honest;
        // blanking the list because page 3 failed is not.
        setErrorStatus(err);
        return;
      }
      setRows((prev) => [...prev, ...(Array.isArray(result?.salesOrders) ? result.salesOrders : [])]);
      setCursor(result?.nextCursor ?? null);
      setSkipped((prev) => prev + (Number.isFinite(result?.skipped) ? result.skipped : 0));
    });
  }, [cursor, loadingMore, limit, state]);

  return { rows, loading, loadingMore, errorStatus, skipped, hasMore: cursor != null, loadMore, refetch };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAccountWorkOrderTimelinePage } from "../domain/accountWorkOrders";

// Customer/Account Business Model -- Customer PR 3, Service Activity.
// Independent hooks so the two summary counts and the Account Activity
// timeline never share loading/error/pagination state -- a slow or failed
// count must never block or misrepresent the other count OR the timeline,
// and vice versa (docs/specifications/customer-account-business-model.md).
//
// All one-shot reads (getCountFromServer / bounded getDocs), not onSnapshot
// subscriptions -- the approved design is aggregate counts + bounded,
// cursor-paginated timeline, which realtime listeners don't model cleanly.
// An activity timeline does not require realtime updates.

// Generic single-count hook -- one fetch, its OWN value/loading/error. The
// Completed and Open counts each call this with their own fetch function,
// so neither's failure can touch the other's state (no Promise.all, no
// shared error). `fetchFn` must be a stable reference (a module-level
// import) so the effect key is stable.
export function useAccountWorkOrderCount(accountId, fetchFn) {
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setValue(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    fetchFn(accountId)
      .then((v) => {
        if (cancelled) return;
        setValue(v);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, fetchFn]);

  return { value, loading, error };
}

export function useAccountWorkOrderTimeline(accountId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true); // initial page only
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false); // initial-page error (blocks the list)
  const [loadMoreError, setLoadMoreError] = useState(false); // pagination error (keeps the list)
  const [hasMore, setHasMore] = useState(false);
  const lastDocRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    lastDocRef.current = null;
    if (!accountId) {
      setItems([]);
      setLoading(false);
      setError(false);
      setLoadMoreError(false);
      setHasMore(false);
      return;
    }
    setLoading(true);
    setError(false);
    setLoadMoreError(false);
    setItems([]);
    setHasMore(false);
    fetchAccountWorkOrderTimelinePage(accountId, {})
      .then(({ items: page, lastDoc, hasMore: more }) => {
        if (cancelled) return;
        setItems(page);
        lastDocRef.current = lastDoc;
        setHasMore(more);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !lastDocRef.current) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const { items: page, lastDoc, hasMore: more } = await fetchAccountWorkOrderTimelinePage(accountId, {
        afterDoc: lastDocRef.current,
      });
      setItems((cur) => [...cur, ...page]);
      lastDocRef.current = lastDoc;
      setHasMore(more);
    } catch {
      // A pagination failure keeps the already-loaded rows intact and lets
      // the user retry -- it never wipes the list (that is the initial-page
      // `error` only).
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [accountId, hasMore, loadingMore]);

  return {
    items,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    loadMore,
    isEmpty: !loading && !error && items.length === 0,
  };
}

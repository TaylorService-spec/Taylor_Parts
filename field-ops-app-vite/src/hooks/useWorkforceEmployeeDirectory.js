// THE EMPLOYEE DIRECTORY, from the governed PostgreSQL Workforce transport.
//
// EMP-RT-01 `listEmployees` (functions/src/eosWorkforce/reads/employeeDirectoryReads.ts) is keyset-paginated by
// Employee id and bounded by the server's own page size. This hook holds exactly what that read returns: the
// accumulated items, whether another page exists, and the failure when one happened.
//
// NO FALLBACK. A refusal or an outage is a state the screen renders, never a reason to read somewhere else, and a
// failed page never silently becomes an empty directory.
import { useCallback, useEffect, useRef, useState } from "react";
import { workforceApiClient } from "../services/workforceApiClient.js";
import { WORKFORCE_READ_STATE } from "./useWorkforceRead.js";

export { WORKFORCE_READ_STATE };

/**
 * @param options { client = workforceApiClient, limit } -- `limit` is optional; omitted, the server's default
 *                page size applies (it refuses anything above its own maximum).
 */
export function useWorkforceEmployeeDirectory({ client = workforceApiClient, limit } = {}) {
  const [state, setState] = useState({ status: WORKFORCE_READ_STATE.LOADING, items: [], hasMore: false, error: null, loadingMore: false });
  const [nonce, setNonce] = useState(0);
  // The cursor belongs to the page that produced it: a reload starts from none, and a Load More that lands after
  // a retry must not resume an abandoned page.
  const cursorRef = useRef(null);
  const runRef = useRef(0);

  const request = useCallback(
    async (cursor, append) => {
      const run = runRef.current;
      const input = { ...(limit === undefined ? {} : { limit }), ...(cursor ? { cursor } : {}) };
      const outcome = await client.call("listEmployees", Object.keys(input).length > 0 ? input : undefined);
      if (run !== runRef.current) return;
      if (outcome && outcome.ok) {
        const items = outcome.result?.items ?? [];
        cursorRef.current = outcome.result?.nextCursor ?? null;
        setState((prev) => ({
          status: WORKFORCE_READ_STATE.READY,
          items: append ? [...prev.items, ...items] : items,
          hasMore: Boolean(outcome.result?.nextCursor),
          error: null,
          loadingMore: false,
        }));
      } else {
        // A FAILED PAGE DOES NOT DISCARD THE PAGES ALREADY READ, and it does not pretend to have read one: the
        // rows stay, the failure is stated, and Load More can be tried again.
        setState((prev) => ({
          status: append && prev.items.length > 0 ? WORKFORCE_READ_STATE.READY : WORKFORCE_READ_STATE.FAILED,
          items: append ? prev.items : [],
          hasMore: append ? prev.hasMore : false,
          error: outcome ?? { ok: false, code: "INTERNAL", message: "the read failed" },
          loadingMore: false,
        }));
      }
    },
    [client, limit],
  );

  useEffect(() => {
    runRef.current += 1;
    cursorRef.current = null;
    setState({ status: WORKFORCE_READ_STATE.LOADING, items: [], hasMore: false, error: null, loadingMore: false });
    request(null, false);
    return () => {
      runRef.current += 1;
    };
  }, [request, nonce]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    setState((prev) => ({ ...prev, loadingMore: true, error: null }));
    request(cursor, true);
  }, [request]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, loadMore, retry };
}

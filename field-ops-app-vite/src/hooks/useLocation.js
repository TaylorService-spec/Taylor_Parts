import { useCallback, useEffect, useState } from "react";
import { READ_RESULT, readGovernedList } from "../access/governedCollectionClient.js";
import { loadErrorMessage } from "../domain/loadErrorMessage";

const ENTITY = "locations";

// Sprint 2.0.3 -- Work Order Experience. Single-document live
// listener for one Location, same shape as useAccount.js/
// useWorkOrder.js. Used by WorkOrderDetailPage.jsx to resolve
// workOrder.locationId to a display label for admin/dispatcher only
// -- see that file's header comment for why this is never attempted
// for the technician role.
//
// H14 -- this hook used to pass NO error callback to onSnapshot, so a
// DENIED or failed Location read never resolved -- `loading` stayed
// true forever with no error surfaced. It now fails closed to a safe
// `error` (loadErrorMessage -- never a raw code/path/id) and clears any
// stale location, matching useAccount.js/useWorkOrder.js's discipline,
// plus the same retry re-subscription and obsolete-callback guard.
export function useLocation(locationId) {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!locationId) {
      setLocation(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    // One record, asked as a one-element id set through the governed `locationsByIds` source --
    // the same source and the same capability the batched name lookup uses, because "may this
    // person read customer locations" does not change with the size of the id set.
    //
    // ONE-SHOT, NOT A SUBSCRIPTION. This was an onSnapshot and a governed callable cannot stream.
    // The record page re-reads on navigation and on retry, which is what it always did in practice;
    // nothing here rendered a live-updating badge that would now be quietly stale.
    //
    // A stored `id` field can no longer displace the document id: this used to spread
    // `{ id: snap.id, ...snap.data() }`, which resolved that conflict in favour of the DATA, and
    // every consumer keys and routes by this value. The server's projection puts the document id
    // last, so `row.id` is authoritative.
    (async () => {
      const page = await readGovernedList({
        sourceId: "locationsByIds",
        filters: { ids: [locationId] },
        pageSize: 1,
      });
      if (!active) return;
      if (!page.ok) {
        setLocation(null);
        // A DENIED read and an unavailable one stay distinguishable, and both stay distinct from a
        // CONFIRMED absence below -- a successful read that found no such location.
        setError(loadErrorMessage({ code: page.result === READ_RESULT.DENIED ? "permission-denied" : "unavailable" }, { entity: ENTITY }));
        setLoading(false);
        return;
      }
      setLocation(page.items[0] ?? null);
      setError(null);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [locationId, attempt]);

  return { location, loading, error, retry };
}

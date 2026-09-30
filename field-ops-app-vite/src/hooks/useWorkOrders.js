import { useEffect, useState } from "react";
import { subscribeToWorkOrders } from "../services/workOrderService";

// The office Work Order list over the GOVERNED EOS route (services/workOrderService.ts ->
// listWorkOrders), refreshed on a bounded interval -- there is no Firestore listener behind it any more.
// Returns the same { data, loading, error } shape the surfaces already read, plus:
//   notActivated  the server answered NOT_ACTIVATED (DQ-S4). `data` is [] and `error` carries code
//                 NOT_ACTIVATED, which loadErrorMessage renders as NOT_YET_ACTIVATED -- never as "no work".
//   truncated     the server had more than the bounded page; a surface must not claim completeness.
//
// `enabled` DEFAULTS TO TRUE. Disabled is IDLE, never empty: `data` stays [] and `loading` false.
// `filters` (optional) narrows the server read (statuses, scheduledFrom/To, assigneeEmployeeId, ...);
// pass a STABLE object (memoized) -- it is compared by JSON value.
export function useWorkOrders(enabled = true, { filters = null } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const filterKey = filters ? JSON.stringify(filters) : "";

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setError(null);
      setLoading(false);
      setTruncated(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeToWorkOrders(
      (workOrders) => {
        setData(workOrders);
        setError(null);
        setLoading(false);
      },
      (err) => {
        // Fail VISIBLY: a refused/failed read is an error state, never an empty list.
        setError(err);
        setData([]);
        setLoading(false);
      },
      { filters: filterKey ? JSON.parse(filterKey) : undefined, onTruncated: setTruncated },
    );
    return () => unsub();
  }, [enabled, filterKey]);

  return { data, loading, error, truncated, notActivated: error?.code === "NOT_ACTIVATED" };
}

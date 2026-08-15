import { useCallback, useEffect, useState } from "react";
import { fetchSalesOrderContext } from "../services/salesOrderReadCallableClient.js";

// One-shot read of a Sales Order by id, with an explicit `refetch`. Own loading/error state (mirrors
// hooks/useAccountAr.js's cancelled-guard shape) so a slow/failed read never blocks or misrepresents
// any other section.
//
// `refetch` exists for the write side (Item 4 -- SalesOrderActions.jsx): after a governed command
// (transitionSalesOrder / allocateSalesOrder / createServiceForSalesOrder) succeeds, the workspace
// must show the SERVER's new state, never a client-fabricated one. Calling refetch() re-runs the read.
// While a refetch is in flight, the PRIOR result stays visible (loading only flips true when there is
// no prior result yet, i.e. the very first load) so a successful action never blanks the screen back to
// a bare loading placeholder -- the stale result is still an honest, previously-real state to show
// while the fresher one loads, distinct from ever fabricating a new one.
export function useSalesOrder(salesOrderId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });
  const [refetchToken, setRefetchToken] = useState(0);
  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!salesOrderId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState((prev) => ({ loading: prev.result == null, errorStatus: null, result: prev.result }));
    fetchSalesOrderContext(salesOrderId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetchToken is a deliberate re-run trigger, not a data dependency
  }, [salesOrderId, refetchToken]);

  return { ...state, refetch };
}

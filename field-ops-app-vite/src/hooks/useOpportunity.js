import { useCallback, useEffect, useState } from "react";
import { fetchOpportunityContext } from "../services/opportunityReadCallableClient.js";

// One-shot read of an Opportunity by id, with an explicit `refetch`. Deliberately the same shape as
// hooks/useSalesOrder.js -- the two record families must behave identically, and the way to
// guarantee that is for the seams to be structurally the same rather than merely similar.
//
// `refetch` exists for the write side: after a governed transition (transitionOpportunity, or the
// atomic WON that also creates a Sales Order) succeeds, the page must show the SERVER's new state
// and never a client-fabricated one. While a refetch is in flight the PRIOR result stays visible --
// `loading` only flips true when there is no prior result at all -- so a successful action never
// blanks the page back to a loading placeholder. A stale result is a previously-real state, which
// is a different thing from an invented one.
export function useOpportunity(opportunityId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });
  const [refetchToken, setRefetchToken] = useState(0);
  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!opportunityId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState((prev) => ({ loading: prev.result == null, errorStatus: null, result: prev.result }));
    fetchOpportunityContext(opportunityId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetchToken is a deliberate re-run trigger, not a data dependency
  }, [opportunityId, refetchToken]);

  return { ...state, refetch };
}

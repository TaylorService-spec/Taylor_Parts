import { useEffect, useState } from "react";
import { fetchAccountOpportunities } from "../services/accountOpportunitiesReadCallableClient.js";

// One-shot read of an account's Opportunities (Wave 7 completion PART 2). Own loading/error state
// (mirrors hooks/useAccountAr.js's shape) so a slow/failed Opportunity read never blocks or
// misrepresents any other Account section.
export function useAccountOpportunities(accountId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState({ loading: true, errorStatus: null, result: null });
    fetchAccountOpportunities(accountId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

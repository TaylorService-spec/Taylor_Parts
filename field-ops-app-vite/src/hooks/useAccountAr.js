import { useEffect, useState } from "react";
import { fetchAccountInvoiceAr } from "../services/financeReadCallableClient.js";

// One-shot read of an account's AR projection. Own loading/error state (mirrors
// hooks/useAccountServiceActivity.js's cancelled-guard shape) so a slow/failed AR read
// never blocks or misrepresents any other Account section.
export function useAccountAr(accountId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState({ loading: true, errorStatus: null, result: null });
    fetchAccountInvoiceAr(accountId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

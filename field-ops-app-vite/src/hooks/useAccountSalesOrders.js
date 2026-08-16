import { useEffect, useState } from "react";
import { fetchAccountSalesOrders } from "../services/accountSalesOrdersReadCallableClient.js";

// One-shot read of an account's Sales Orders (Wave 7 completion PART 3). Own loading/error state
// (mirrors hooks/useAccountAr.js's shape) so a slow/failed Sales Order read never blocks or
// misrepresents any other Account section.
export function useAccountSalesOrders(accountId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState({ loading: true, errorStatus: null, result: null });
    fetchAccountSalesOrders(accountId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

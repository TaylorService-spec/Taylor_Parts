import { useEffect, useState } from "react";
import { fetchSalesOrderContext } from "../services/salesOrderReadCallableClient.js";

// One-shot read of a Sales Order by id. Own loading/error state (mirrors
// hooks/useAccountAr.js's cancelled-guard shape) so a slow/failed read never blocks or
// misrepresents any other section.
export function useSalesOrder(salesOrderId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    if (!salesOrderId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState({ loading: true, errorStatus: null, result: null });
    fetchSalesOrderContext(salesOrderId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [salesOrderId]);

  return state;
}

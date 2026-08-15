import { useEffect, useState } from "react";
import { fetchManufacturerCatalog } from "../services/manufacturerReadCallableClient.js";

// One-shot read of the governed Manufacturer catalog. Own loading/error state (mirrors
// hooks/useSalesOrder.js's shape) so a slow/failed/denied read never blocks or misrepresents
// the Part surfaces that consume it -- callers fall back to raw manufacturerId display when
// this hasn't resolved to READY, never fabricate a name.
export function useManufacturerCatalog() {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, errorStatus: null, result: null });
    fetchManufacturerCatalog().then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

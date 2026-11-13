import { useEffect, useState } from "react";
import { fetchManufacturerCatalog } from "../services/manufacturerCatalogClient.js";

// One-shot read of the governed Manufacturer catalog. Own loading/error state (mirrors
// hooks/useSalesOrder.js's shape) so a slow/failed/denied read never blocks or misrepresents
// the Part surfaces that consume it -- callers fall back to raw manufacturerId display when
// this hasn't resolved to READY, never fabricate a name.
//
// `enabled` (UAT RO-01): false asks nothing and settles at the same "denied" answer a refused read produces, so a screen whose
// caller is known not to hold inventory.manufacturer.read does not take a 403 on every load for an answer it already has.
export function useManufacturerCatalog(enabled = true) {
  const [state, setState] = useState(enabled ? { loading: true, errorStatus: null, result: null } : { loading: false, errorStatus: "denied", result: null });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, errorStatus: "denied", result: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, errorStatus: null, result: null });
    fetchManufacturerCatalog().then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

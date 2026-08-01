// EI Truck Registry -- the REAL home-warehouse pick-list source. A one-shot bounded read
// of the `warehouses` collection (fetchWarehouseOptions), mapped to { value, label }.
// `enabled` gates the read so nothing is fetched until management is authorized AND
// write-ready (never in the current fail-closed production posture). Warehouse
// existence/active state is authoritatively re-checked by the trusted service; this is a
// pick-list only. Firebase lives here, not in the presentational select.
import { useEffect, useState } from "react";
import { fetchWarehouseOptions } from "../services/truckRegistryCommandClient.js";

export function useWarehouseOptions(enabled = false, { load = fetchWarehouseOptions } = {}) {
  const [state, setState] = useState({ options: [], loading: Boolean(enabled), error: false });

  useEffect(() => {
    if (!enabled) {
      setState({ options: [], loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: false }));
    load()
      .then((warehouses) => {
        if (cancelled) return;
        setState({ options: warehouses.map((w) => ({ value: w.id, label: w.label })), loading: false, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ options: [], loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  return state;
}

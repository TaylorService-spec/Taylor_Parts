// The reorder warehouse pick-list source (Owner ruling R-17).
//
// ONE SELECTOR, ONE TRUSTED OPTION SOURCE. This deliberately does NOT reuse
// hooks/useWarehouseOptions.js, whose load function is a `getDocs` of the `warehouses` collection --
// a LIST the browser holds no authority for outside admin/dispatcher, which is what stranded the
// PARTS_MANAGER and WAREHOUSE_MANAGER personas in the first place. That hook stays exactly as it is
// for Truck Management, which runs admin-only and behind a readiness gate.
//
// There is no hidden attempt at the collection read followed by a callable fallback. A fallback
// would be two read-authority models for one selector, and the one that "worked" for an admin would
// hide the one that fails for everyone else.
//
// The shape is deliberately the same { options, loading, error } useWarehouseOptions returns, so
// ReorderWarehouseSelect stayed presentational and unchanged -- the presentation logic is shared,
// the read authority is not.
//
// `reason` is carried through because an empty list is a real answer with more than one cause: an
// admin in a world with no governed warehouses, and a Parts Manager whose warehouse scope no
// authority has yet defined, are different situations and the caller may want to say so.
import { useEffect, useState } from "react";
import { fetchReorderWarehouseOptions } from "../services/reorderCallableClient.js";

export function useReorderWarehouseOptions(enabled = true, { load = fetchReorderWarehouseOptions } = {}) {
  const [state, setState] = useState({ options: [], reason: null, loading: Boolean(enabled), error: false });

  useEffect(() => {
    if (!enabled) {
      setState({ options: [], reason: null, loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: false }));
    load()
      .then((result) => {
        if (cancelled) return;
        setState({ options: result.options, reason: result.reason ?? null, loading: false, error: false });
      })
      .catch(() => {
        // FAIL CLOSED, and visibly. An unavailable list leaves no options and an error the selector
        // renders as itself -- never a silent empty list, which would read as "no warehouses exist".
        if (cancelled) return;
        setState({ options: [], reason: null, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  return state;
}

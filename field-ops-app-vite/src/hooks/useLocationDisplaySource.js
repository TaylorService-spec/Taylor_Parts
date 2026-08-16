import { useEffect, useState } from "react";
import { fetchLocationDisplay } from "../services/locationDisplayReadCallableClient.js";
import { mapLocationDisplayResultToMap } from "../domain/locationDisplayProjection.js";
import { LOCATION_DISPLAY_SOURCE_STATUS } from "../access/locationDisplaySource.js";

// PART 11A -- resolves a bounded, distinct set of raw location ids into governed display labels
// via the trusted getLocationDisplay read. Mirrors hooks/useAvailableEquipmentSource.js's shape.
// Re-fetches only when the (already-deduplicated, order-independent) set of requested ids changes,
// keyed by a stable "|"-joined string of the sorted ids -- avoids re-fetching on every render when
// the caller passes a freshly-allocated array with the same contents.
//
// `inventory.location.display.read` is registered `active:false` and granted to no Role as of this
// build (access/permissionCatalog.ts) -- until a later, separately authorized grant + per-environment
// activation, this read fails closed with a DENIED status in every environment. Consumers must treat
// that as expected, not a bug -- the location column renders its own honest fallback (the raw id via
// composeAvailableRow) rather than blocking on this resolver.
export function useLocationDisplaySource(locationIds) {
  const ids = Array.isArray(locationIds) ? locationIds.filter((id) => typeof id === "string" && id.trim() !== "") : [];
  const dedupedIds = [...new Set(ids)].sort();
  const key = dedupedIds.join("|");

  const [state, setState] = useState({ status: LOCATION_DISPLAY_SOURCE_STATUS.LOADING, displayMap: new Map() });

  useEffect(() => {
    let cancelled = false;
    if (key === "") {
      // Nothing to resolve -- READY with an empty map, not a stuck LOADING state.
      setState({ status: LOCATION_DISPLAY_SOURCE_STATUS.READY, displayMap: new Map() });
      return undefined;
    }
    setState({ status: LOCATION_DISPLAY_SOURCE_STATUS.LOADING, displayMap: new Map() });
    fetchLocationDisplay(key.split("|")).then(({ result, errorStatus }) => {
      if (cancelled) return;
      if (errorStatus) {
        setState({
          status: errorStatus === "denied" ? LOCATION_DISPLAY_SOURCE_STATUS.DENIED : LOCATION_DISPLAY_SOURCE_STATUS.UNAVAILABLE,
          displayMap: new Map(),
        });
        return;
      }
      setState({ status: LOCATION_DISPLAY_SOURCE_STATUS.READY, displayMap: mapLocationDisplayResultToMap(result) });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` fully determines the request
    // (it is `dedupedIds.join("|")`, and the effect body re-derives the id array from `key` itself,
    // never from the outer-scope `dedupedIds` binding), so `key` is the correct sole dependency.
  }, [key]);

  return {
    connected: state.status === LOCATION_DISPLAY_SOURCE_STATUS.READY,
    status: state.status,
    displayMap: state.displayMap,
  };
}

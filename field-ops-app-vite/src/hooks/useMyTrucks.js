// THE TRUCKS I WORK FROM -- the caller's current MOBILE scopes, from the governed EOS roster (Controller TRUCK INVENTORY
// ACTIVATION, OD-T1 / OD-T3, 2026-10-01). The server decides; this only reads `listTruckRoster` and keeps the trucks whose
// MOBILE location is in the caller's own scope (`mobileLocationIds`) -- never the tenant roster a dispatcher may also read.
import { useEffect, useState } from "react";
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "../services/eosOperationsClient.js";

export function useMyTrucks({ enabled = true, call = eosOperationOrThrow } = {}) {
  const [state, setState] = useState({ trucks: [], loading: Boolean(enabled), error: false });
  useEffect(() => {
    if (!enabled) { setState({ trucks: [], loading: false, error: false }); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const res = await call(EOS_OPERATIONS_ROUTES.INVENTORY, "listTruckRoster", {}, { serviceLabel: "the truck inventory service" });
        const mine = new Set(Array.isArray(res?.mobileLocationIds) ? res.mobileLocationIds : []);
        const trucks = (res?.trucks ?? []).filter((t) => t?.mobileLocation && mine.has(t.mobileLocation.locationId))
          .map((t) => Object.freeze({ truckId: t.truckId, label: t.displayLabel, mobileLocationId: t.mobileLocation.locationId }));
        if (!cancelled) setState({ trucks, loading: false, error: false });
      } catch {
        if (!cancelled) setState({ trucks: [], loading: false, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, call]);
  return state;
}

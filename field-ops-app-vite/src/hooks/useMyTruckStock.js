// THE STOCK ON MY TRUCK(S) -- readTruckStock for each truck in the caller's own MOBILE scope, summed per Part (TW4).
//
// The server decides what is reachable: readTruckStock answers only through the caller's MOBILE scope, and useMyTrucks
// keeps only the trucks in the caller's own scope. A failed or empty read is `known: false` -- never a silent zero --
// so the readiness projection keeps saying UNKNOWN instead of claiming the truck is empty.
//
// `refreshKey` re-reads the stock when it changes. Recording usage consumes truck stock, so the screen passes a key that
// moves with the Work Order's recorded quantities (it deliberately does not subscribe to a write channel of its own).
import { useEffect, useState } from "react";
import { EOS_OPERATIONS_ROUTES, eosOperationOrThrow } from "../services/eosOperationsClient.js";
import { sumTruckStock } from "../domain/fieldTruckReadiness.js";
import { useMyTrucks } from "./useMyTrucks.js";

const NONE = Object.freeze({ known: false, loading: false, onHand: Object.freeze({}), truckLabels: Object.freeze([]) });

export function useMyTruckStock({ enabled = true, call = eosOperationOrThrow, refreshKey = "" } = {}) {
  const { trucks, loading: trucksLoading, error: trucksError } = useMyTrucks({ enabled, call });
  const [state, setState] = useState({ ...NONE, loading: Boolean(enabled) });

  useEffect(() => {
    if (!enabled) { setState(NONE); return undefined; }
    if (trucksLoading) return undefined;
    if (trucksError || trucks.length === 0) { setState(NONE); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const answers = await Promise.all(trucks.map((t) =>
          call(EOS_OPERATIONS_ROUTES.INVENTORY, "readTruckStock", { mobileLocationId: t.mobileLocationId }, { serviceLabel: "the truck inventory service" })));
        if (!cancelled) setState({ known: true, loading: false, onHand: sumTruckStock(answers), truckLabels: trucks.map((t) => t.label) });
      } catch {
        if (!cancelled) setState(NONE);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, call, trucks, trucksLoading, trucksError, refreshKey]);

  return state;
}

// The SERIAL-tracked Part catalog, read so a person can choose a part by its name.
//
// ============================ WHY THIS SET, AND NOT ANOTHER ============================
//
// `acquireSerializedAssetCommand` accepts a Part only when its resolved tracking mode is SERIAL — a
// quantity part has no individually identified units to acquire, and the command refuses it with its
// own distinct code. So the picker offers exactly that set: `controlType == "SERIALIZED"`, which is
// what `controlTypeToTrackingMode` maps to SERIAL.
//
// It is deliberately NOT `useWholeUnitParts`. That hook reads `wholeUnit == true` — one Part per
// model the company stocks as a new machine — which is a different question and a narrower set. A
// serial-tracked component the company already owns is acquirable and is not a whole unit, and
// offering only whole units would silently make it unacquirable through the UI while the command
// accepted it happily.
//
// BOUNDED BY THE FILTER, not by hope. A single equality on an indexed field plus a cap; no orderBy,
// because a Firestore orderBy is also a FILTER and documents missing the ordered field would be
// silently excluded — dropping Parts from a picker without saying so. The result is sorted where it
// is displayed.
//
// FAILS CLOSED, and that is the opposite of `useWholeUnitParts`'s choice — deliberately. That hook
// fails open to raw ids because losing labels must not lose the inventory somebody is deciding
// from. Here the list IS the input to a governed write: an empty or partial picker must read as
// "we could not offer you the parts", never as "there are none", because the second would invite
// somebody to conclude the part they are holding is not in the system.
import { useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";
// The pure shaping lives in the domain layer so it is testable without a firebase module resolving.
// Re-exported here so existing importers of the hook keep one place to reach for.
import { SERIAL_CONTROL_TYPE, toSerialPartOptions } from "../domain/serialTrackedPartOptions";

export { SERIAL_CONTROL_TYPE, toSerialPartOptions };


/** A guard against an unexpectedly large catalogue, not an expected size. */
const SERIAL_PART_READ_CAP = 500;

export const SERIAL_PARTS_STATUS = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
});

export function useSerialTrackedParts({ enabled = true } = {}) {
  const [state, setState] = useState({
    options: [],
    status: enabled ? SERIAL_PARTS_STATUS.LOADING : SERIAL_PARTS_STATUS.READY,
  });

  useEffect(() => {
    if (!enabled) { setState({ options: [], status: SERIAL_PARTS_STATUS.READY }); return undefined; }
    let cancelled = false;
    setState({ options: [], status: SERIAL_PARTS_STATUS.LOADING });

    // GOVERNED READ. `parts` is denied to every client in Rules now; this resolves the EXISTING
    // inventory.catalog.read server-side -- the same authority, relocated. The controlType filter
    // is required by the source, so it can never silently become a read of every part.
    //
    // The cap is unchanged and still passed as the page size: this is a picker, and the cap is its
    // deliberate bound rather than an accident of pagination.
    governedCollectionClient
      .readGovernedList({
        sourceId: "partsBySerialControl",
        filters: { controlType: SERIAL_CONTROL_TYPE },
        pageSize: SERIAL_PART_READ_CAP,
      })
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.ok) {
          // `partId` from the document id, exactly as before -- the governed row carries the
          // authoritative id in `id`, and this hook's option shape names it partId.
          const docs = outcome.items.map(({ id, ...data }) => ({ partId: id, ...data }));
          setState({ options: toSerialPartOptions(docs), status: SERIAL_PARTS_STATUS.READY });
          return;
        }
        // DENIED and UNAVAILABLE are different facts about the world and the surface says different
        // things about them. Collapsing them would tell somebody their data is missing when the
        // truth is that their role is narrow.
        setState({
          options: [],
          status: outcome.result === "DENIED" ? SERIAL_PARTS_STATUS.DENIED : SERIAL_PARTS_STATUS.UNAVAILABLE,
        });
      });

    return () => { cancelled = true; };
  }, [enabled]);

  return state;
}

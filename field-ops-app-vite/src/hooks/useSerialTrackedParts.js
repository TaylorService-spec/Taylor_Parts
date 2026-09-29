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
import { searchParts } from "../services/partMasterQueries";
import { useEffect, useState } from "react";
// The pure shaping lives in the domain layer so it is testable without a firebase module resolving.
// Re-exported here so existing importers of the hook keep one place to reach for.
import { SERIAL_CONTROL_TYPE, toSerialPartOptions } from "../domain/serialTrackedPartOptions";

export { SERIAL_CONTROL_TYPE, toSerialPartOptions };

// Declared here for the same reason hooks/useWholeUnitParts.js declares its own: `parts` is not in
// domain/constants.js, and adding it there to serve one hook would be a wider change than this
// surface earns.


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

    // THE GOVERNED QUERY, applied in PostgreSQL. `controlType` is part of the Catalog search
    // contract; narrowing here would mean loading the catalogue to the browser first.
    searchParts({ controlType: SERIAL_CONTROL_TYPE, limit: SERIAL_PART_READ_CAP })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          const docs = (res.parts ?? []).map((p) => ({ partId: p.partId ?? p.id, ...p }));
          setState({ options: toSerialPartOptions(docs), status: SERIAL_PARTS_STATUS.READY });
          return;
        }
        // DENIED and UNAVAILABLE are different facts about the world and the surface says different
        // things about them. Collapsing them would tell somebody their data is missing when the
        // truth is that their role is narrow.
        setState({
          options: [],
          status: (res.code === "FORBIDDEN" || res.code === "NOT_SIGNED_IN")
            ? SERIAL_PARTS_STATUS.DENIED : SERIAL_PARTS_STATUS.UNAVAILABLE,
        });
      });

    return () => { cancelled = true; };
  }, [enabled]);

  return state;
}

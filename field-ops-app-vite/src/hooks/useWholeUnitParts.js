// The whole-unit Part catalog, read for display only.
//
// ============================ WHY A SEPARATE, NARROW READ ============================
//
// The governed Available Equipment read returns a `partId` and nothing else about the product. To
// show a person "Taylor C161" instead of "CW-WU-TAYLOR--C161" the Part has to be read, and the Part
// is where the canonical `equipmentModelId` lives -- which is what manufacturer, model and business
// line are derived from (domain/wholeUnitAssetDisplay.js).
//
// BOUNDED BY THE FILTER, not by hope. `where("wholeUnit", "==", true)` is a handful of documents --
// one per model the company stocks as new machines -- not the whole parts catalog. A surface that
// loaded every part to label thirty units would be the client-side dataset ownership DECISIONS #102
// §9 forbids.
//
// NO orderBy. A Firestore orderBy is also a FILTER: documents missing the ordered field are silently
// excluded, so ordering on anything optional would drop Parts from the list without saying so. The
// result set is small and sorted where it is displayed.
//
// FAILS OPEN TO IDS, NOT TO GUESSES. If this read is denied or unavailable, the list still renders
// every available unit with its serial and raw part id. Losing the labels must never lose the
// inventory -- somebody deciding what to install needs the units more than they need the words.
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../firebase/firebase";
// The collection name is declared here for the same reason services/partMasterQueries.js declares
// its own: `parts` is not in domain/constants.js, and adding it there to serve one hook would be a
// wider change than this surface earns.
const PARTS_COLLECTION = "parts";

/** One per stocked model. The cap is a guard against a mis-set flag, not an expected size. */
const WHOLE_UNIT_READ_CAP = 200;

export function useWholeUnitParts({ enabled = true } = {}) {
  const [state, setState] = useState({ parts: [], loading: enabled, denied: false, unavailable: false });

  useEffect(() => {
    if (!enabled) { setState({ parts: [], loading: false, denied: false, unavailable: false }); return undefined; }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    getDocs(query(collection(db, PARTS_COLLECTION), where("wholeUnit", "==", true), limit(WHOLE_UNIT_READ_CAP)))
      .then((snap) => {
        if (cancelled) return;
        setState({
          parts: snap.docs.map((d) => ({ partId: d.id, ...d.data() })),
          loading: false, denied: false, unavailable: false,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Denied and unavailable are reported separately because they mean different things to a
        // user: one is "you may not see product names", the other is "we could not load them".
        const denied = err?.code === "permission-denied";
        setState({ parts: [], loading: false, denied, unavailable: !denied });
      });
    return () => { cancelled = true; };
  }, [enabled]);

  return state;
}

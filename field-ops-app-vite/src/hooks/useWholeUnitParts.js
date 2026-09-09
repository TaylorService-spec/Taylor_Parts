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
// DISPLAY DEGRADATION, NOT AUTHORIZATION DEGRADATION -- and the distinction is worth stating
// precisely, because "fails open" is dangerously ambiguous in an access-control context.
//
// AUTHORIZATION STILL FAILS CLOSED. This read resolves inventory.catalog.read server-side; a caller
// without it gets nothing from this hook, and no part data reaches the screen through this path.
//
// What degrades is ENRICHMENT. The units themselves come from a different, already-authorized read;
// this hook only supplies their friendly labels. So when the label read is denied or unavailable,
// the list still renders every available unit by its serial and raw part id. Losing the words must
// not lose the inventory -- somebody deciding what to install needs the units more than the names --
// and showing an authoritative id is not showing data the caller was refused.
import { useEffect, useState } from "react";
import { governedCollectionClient } from "../access/governedCollectionClient";

/** One per stocked model. The cap is a guard against a mis-set flag, not an expected size. */
const WHOLE_UNIT_READ_CAP = 200;

export function useWholeUnitParts({ enabled = true } = {}) {
  const [state, setState] = useState({ parts: [], loading: enabled, denied: false, unavailable: false });

  useEffect(() => {
    if (!enabled) { setState({ parts: [], loading: false, denied: false, unavailable: false }); return undefined; }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    // GOVERNED READ, resolving the EXISTING inventory.catalog.read server-side. The wholeUnit
    // filter is required by the source, so it can never silently widen into every part. The cap is
    // unchanged and still the page size.
    governedCollectionClient
      .readGovernedList({
        sourceId: "partsWholeUnit",
        filters: { wholeUnit: true },
        pageSize: WHOLE_UNIT_READ_CAP,
      })
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.ok) {
          setState({
            parts: outcome.items.map(({ id, ...data }) => ({ partId: id, ...data })),
            loading: false, denied: false, unavailable: false,
          });
          return;
        }
        // Denied and unavailable are reported separately because they mean different things to a
        // user: one is "you may not see product names", the other is "we could not load them".
        const denied = outcome.result === "DENIED";
        setState({ parts: [], loading: false, denied, unavailable: !denied });
      });
    return () => { cancelled = true; };
  }, [enabled]);

  return state;
}

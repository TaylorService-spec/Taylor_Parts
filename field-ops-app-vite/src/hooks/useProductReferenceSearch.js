// THE PRODUCT PICKER'S CLIENT — one hook for the Part typeahead and the Equipment Model picker.
//
// ════════════════════ WHY A HOOK AND NOT A COMPONENT-LOCAL EFFECT ════════════════════
//
// Both surfaces ask the same governed callable, need the same debounce, and have the same four
// honest outcomes. Written twice they would drift, and the one that drifted would be the one that
// forgot to distinguish "denied" from "empty" -- which tells a salesperson their catalog is empty
// when the truth is that the read failed.
//
// ════════════════════ THE STATES ARE DISTINCT ON PURPOSE ════════════════════
//
//   IDLE            nothing asked yet (below the minimum query length)
//   LOADING         a read is in flight -- "no results yet" is NOT "no results"
//   READY           the read completed. An empty list now genuinely means nothing matched.
//   DENIED          this principal may not read the catalog
//   UNAVAILABLE     the read failed
//
// Collapsing DENIED into READY-with-zero-results is the specific defect that makes a permissions
// problem look like a data problem, and sends somebody to ask why the catalog is empty.
//
// ════════════════════ THE LAST RESPONSE WINS, NOT THE LAST TO ARRIVE ════════════════════
//
// Typing "CW-P" issues reads for "CW", "CW-", "CW-P" and they can return out of order. A stale
// response landing last would show results for a prefix the user has already moved past. Every
// request carries a sequence number and only the newest may write state.
import { useCallback, useEffect, useRef, useState } from "react";
import { searchProductReferences } from "../services/salesAgreementCommandClient.js";

export const PRODUCT_SEARCH_STATE = Object.freeze({
  IDLE: "IDLE",
  LOADING: "LOADING",
  READY: "READY",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
});

/** Mirrors the server's own threshold. Stated in both places because both enforce it. */
export const MIN_SEARCH_LENGTH = 2;
/** Long enough that a typist is not issuing a read per keystroke; short enough to feel immediate. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Maps the transport's errorStatus to one of the honest states. */
export function stateForError(errorStatus) {
  if (errorStatus === "permission-denied") return PRODUCT_SEARCH_STATE.DENIED;
  return PRODUCT_SEARCH_STATE.UNAVAILABLE;
}

/**
 * @param kind  "PART" (typeahead) or "EQUIPMENT_MODEL" (listed whole, capped)
 * @param query the raw text for a PART search. Ignored for EQUIPMENT_MODEL.
 */
export function useProductReferenceSearch(kind, query, { enabled = true } = {}) {
  const [state, setState] = useState(PRODUCT_SEARCH_STATE.IDLE);
  const [results, setResults] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const seq = useRef(0);
  // A response in flight when the picker unmounts must not set state on a torn-down tree -- under
  // jsdom that fails the whole suite pointing at a file that did nothing wrong.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const run = useCallback(async () => {
    if (!enabled) { setState(PRODUCT_SEARCH_STATE.IDLE); setResults([]); return; }
    const text = String(query ?? "").trim();
    // The equipment picker asks once and needs no text; the part typeahead waits for the threshold.
    if (kind === "PART" && text.length < MIN_SEARCH_LENGTH) {
      setState(PRODUCT_SEARCH_STATE.IDLE);
      setResults([]);
      setTruncated(false);
      return;
    }
    const mine = ++seq.current;
    setState(PRODUCT_SEARCH_STATE.LOADING);
    const res = await searchProductReferences({ kind, query: text });
    if (!mounted.current || mine !== seq.current) return; // unmounted, or already superseded
    if (res.errorStatus) {
      setState(stateForError(res.errorStatus));
      setResults([]);
      setTruncated(false);
      return;
    }
    // "below-threshold" is a real answer, not an error: the server declining to scan on one
    // character is the same decision this hook makes, restated where it is enforced.
    if (res.result?.status === "below-threshold") {
      setState(PRODUCT_SEARCH_STATE.IDLE);
      setResults([]);
      setTruncated(false);
      return;
    }
    setState(PRODUCT_SEARCH_STATE.READY);
    setResults(Array.isArray(res.result?.results) ? res.result.results : []);
    setTruncated(res.result?.truncated === true);
  }, [kind, query, enabled]);

  useEffect(() => {
    // The equipment list is a single read of reference data -- debouncing it would only delay it.
    if (kind !== "PART") { run(); return undefined; }
    const t = setTimeout(run, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [run, kind]);

  return { state, results, truncated, refresh: run };
}

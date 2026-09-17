import { useEffect, useRef, useState } from "react";
import { accountRowFromCrm, callCrmApi } from "../services/crmApiClient.js";
import { accountSearchQueryShape, interpretAccountSearchRead, ACCOUNT_SEARCH_CAP } from "../domain/accountSearch.js";

// The ONLY place this feature touches Firestore. domain/accountSearch.js decided
// everything already — the prefix range, the bound, the +1 truncation probe, every
// resulting state — and this hook translates that decision into a debounced SDK call and
// nothing more. It adds no filter, limit, or ordering of its own, for the same reason
// firestoreListSource.js does not: anything invented here would be a query nobody proved
// is bounded.
//
// A ONE-SHOT read per keystroke (debounced), not a live subscription. useAccountPicker.js
// stays a subscription because a picker's dropdown is open once and should reflect
// concurrent writes while it is; a search box re-queries on every keystroke by nature, so
// holding open a live listener per keystroke would leak one subscription per character
// typed. getDocs matches what the box actually does.
const DEBOUNCE_MS = 300;

export function useAccountSearch(term, { cap = ACCOUNT_SEARCH_CAP } = {}) {
  const [raw, setRaw] = useState({ docs: null, loading: false, error: null });
  // Guards against a slow earlier query's response landing after a newer keystroke and
  // overwriting the newer (or blank) result — the same stale-response race useMetadataList
  // guards against for paging.
  const requestRef = useRef(0);

  useEffect(() => {
    const shape = accountSearchQueryShape({ term, cap });
    const token = (requestRef.current += 1);

    if (!shape) {
      // A blank term issues no read at all — see accountSearchQueryShape's reasoning.
      setRaw({ docs: null, loading: false, error: null });
      return undefined;
    }

    setRaw((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(async () => {
      try {
        // CRM CUTOVER: the folded-name prefix search runs against the governed PostgreSQL CRM authority (EOS API).
        const res = await callCrmApi("listAccounts", { nameStartsWith: String(term).trim(), limit: Math.min(shape.limit, 200) });
        if (token !== requestRef.current) return;
        if (!res.ok) throw Object.assign(new Error(res.message), { code: res.code });
        setRaw({ docs: res.result.items.map(accountRowFromCrm), loading: false, error: null });
      } catch (error) {
        if (token !== requestRef.current) return;
        // docs stays null, not [], so a failed read is never mistaken downstream for a
        // search that ran and found nothing.
        setRaw({ docs: null, loading: false, error });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, cap]);

  return interpretAccountSearchRead({ term, ...raw, cap });
}

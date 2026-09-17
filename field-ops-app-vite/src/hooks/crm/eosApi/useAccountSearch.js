// EOS API (PostgreSQL CRM) implementation. Selected by src/hooks/useAccountSearch.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/hooks/useAccountSearch.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { useEffect, useRef, useState } from "react";
import { accountRowFromCrm, callCrmApi } from "../../../services/crmApiClient.js";
import { accountSearchQueryShape, interpretAccountSearchRead, ACCOUNT_SEARCH_CAP } from "../../../domain/accountSearch.js";

// domain/accountSearch.js decides the bound, the +1 truncation probe and every resulting state; this hook runs the
// folded-name prefix search through the EOS API (listAccounts nameStartsWith) and nothing more. A ONE-SHOT read per
// keystroke (debounced), with a stale-response guard.
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

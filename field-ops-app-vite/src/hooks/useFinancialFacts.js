import { useEffect, useMemo, useState } from "react";
import { fetchFinancialFacts } from "../services/financeReadCallableClient.js";
import { fetchFinancialFactsFromEos } from "../services/eosFinancialsClient.js";
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";

// WHICH SOURCE ANSWERS, decided once at BUILD time (Firebase exit B1, DECISIONS #B1) by the same compile-time flag F1 and F7c use
// (access/eosSessionSource.js): where an EOS API is declared the Financials facts are the Finance register's receivables (the
// server decides company reach AND credited-person / team reach); everywhere else -- production declares none -- the Firebase
// callable `listFinancialFacts` is the SOLE source, exactly as before. There is no runtime fallback in either direction.
export const fetchFacts = EOS_SESSION_SOURCE ? fetchFinancialFactsFromEos : fetchFinancialFacts;

// One-shot read of the governed financial facts within the caller's requested filters.
//
// NO REQUEST DEDUPLICATION and no cache, unlike hooks/useAccountAr.js. That hook shares an
// in-flight promise because three components on the Account page each read the same account; here
// a single Financials page is the only consumer of its own read, so there is nothing to share —
// and a cache keyed on a filter object would be the wrong shape anyway: a filter change must issue
// a genuinely fresh read, never replay a slice taken under different requested filters.
//
// The filters are serialized into the effect key so a page can pass an object literal without
// re-reading on every render.
export function useFinancialFacts(filters, { limit = 200, enabled = true } = {}) {
  const key = JSON.stringify(filters ?? {});
  const [state, setState] = useState({ loading: enabled, errorStatus: null, result: null });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, errorStatus: null, result: null });
    fetchFacts(JSON.parse(key), limit).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [key, limit, enabled]);

  return useMemo(() => state, [state]);
}

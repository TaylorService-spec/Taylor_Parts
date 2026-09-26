import { useEffect, useMemo, useState } from "react";
import { fetchFinancialFacts } from "../services/financeReadCallableClient.js";
import { financialFactsCompleteness } from "../domain/financialFactsView.js";

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
//
// `limit` is the PAGE SIZE of the server's complete, cursor-paged read — it no longer bounds the
// answer, so the default is the server's maximum page (fewest round trips). The returned
// `completeness` is the server's own contract (COMPLETE | PARTIAL | NOT_READ, with a named reason
// and counts), surfaced verbatim so a page can say why it shows nothing. No figure is ever derived
// from a non-COMPLETE read; the server does not send one.
export function useFinancialFacts(filters, { limit = 500, enabled = true } = {}) {
  const key = JSON.stringify(filters ?? {});
  const [state, setState] = useState({ loading: enabled, errorStatus: null, result: null });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, errorStatus: null, result: null });
    fetchFinancialFacts(JSON.parse(key), limit).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [key, limit, enabled]);

  return useMemo(
    () => ({ ...state, completeness: state.result ? financialFactsCompleteness(state.result) : null }),
    [state],
  );
}

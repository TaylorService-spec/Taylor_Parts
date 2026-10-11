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
// `limit` defaults to the server's EXISTING maximum (MAX_REPORTING_LIMIT = 500), so the invoice
// read has the same bound the server already applies to payment applications and receipts. This
// is a temporary Firebase-era bound, not a capacity increase: past it the server answers PARTIAL /
// READ_LIMIT_REACHED with no rows and no figures. The returned `completeness` is the server's own
// contract (COMPLETE | PARTIAL | NOT_READ, with a named reason and counts), surfaced verbatim.
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

import { useEffect, useState } from "react";
import { financeReader, resolveScope } from "../services/eosFinancialsClient.js";

// One fresh, bounded read from the EOS Finance register per (key) -- Firebase exit B1 (DECISIONS #B1). NO cache and NO request
// sharing: a filter change must issue a genuinely fresh read, and a different signed-in principal never receives another's answer
// because nothing is kept between reads (the bearer on each request is the signed-in principal's own).
//
// `run(reader)` returns `{ result }` or `{ errorStatus }` (services/eosFinancialsClient.js). The effect key is serialized so a page
// can pass object literals without re-reading on every render.
export function useEosFinanceRead(run, key, { enabled = true } = {}) {
  const [state, setState] = useState({ loading: enabled, errorStatus: null, result: null });
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, errorStatus: null, result: null });
    run(financeReader()).then((out) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: out.errorStatus ?? null, result: out.result ?? null });
    });
    return () => { cancelled = true; };
    // `run` closes over exactly what `key` serializes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return state;
}

/** The scope (companies the server lets this principal open) for a page's company selection, then `read(reader, scope)` over it. */
export function scopedRead(companyId, read) {
  return async (reader) => {
    const resolved = await resolveScope(reader, companyId);
    if (resolved.errorStatus) return resolved;
    return read(reader, resolved.scope, resolved.access);
  };
}

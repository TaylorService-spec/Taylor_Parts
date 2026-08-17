import { useEffect, useState } from "react";
import { fetchAccountInvoiceAr } from "../services/financeReadCallableClient.js";

// One-shot read of an account's AR projection. Own loading/error state (mirrors
// hooks/useAccountServiceActivity.js's cancelled-guard shape) so a slow/failed AR read
// never blocks or misrepresents any other Account section.
//
// IN-FLIGHT SHARING (#1095). Three components read an account's AR on one page load:
// AccountDetail (feeding the health strip), AccountArSection, and
// AccountAttentionSection. A network capture confirmed three identical
// listAccountInvoiceAr calls per load — not a render or StrictMode artifact, just three
// independent consumers each calling this hook.
//
// The fix lives HERE rather than in AccountDetail deliberately. Those sections are
// self-contained by design: each takes only `accountId` and owns its own data, so it can
// be mounted anywhere without depending on the page orchestrator (see
// ActivityAndNotesSection's header for the same property and its rationale). Hoisting the
// read into AccountDetail and threading it down as props would fix the request count by
// destroying that property. Sharing the in-flight promise fixes the count and leaves the
// components untouched.
//
// This is REQUEST DEDUPLICATION, NOT A CACHE, and the distinction is load-bearing. The
// entry is cleared as soon as the request settles, so:
//   - concurrent callers share one network round trip;
//   - a later mount (navigate away, come back) issues a genuinely fresh read;
//   - nobody ever renders a stale AR balance, which for a financial figure would be a
//     worse defect than the duplicate reads this removes.
const inFlightByAccountId = new Map();

function sharedFetch(accountId) {
  const existing = inFlightByAccountId.get(accountId);
  if (existing) return existing;

  const request = fetchAccountInvoiceAr(accountId).finally(() => {
    // Cleared on settle — success or failure. Leaving a rejected promise cached would
    // pin a transient failure for every later consumer of this account.
    inFlightByAccountId.delete(accountId);
  });
  inFlightByAccountId.set(accountId, request);
  return request;
}

/** Test-only: drop any shared in-flight entries so cases cannot leak into each other. */
export function __resetAccountArInFlightForTest() {
  inFlightByAccountId.clear();
}

export function useAccountAr(accountId) {
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState({ loading: true, errorStatus: null, result: null });
    sharedFetch(accountId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

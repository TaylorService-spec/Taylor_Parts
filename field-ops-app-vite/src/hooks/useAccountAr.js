import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchAccountInvoiceAr } from "../services/financeReadCallableClient.js";
import { fetchAccountReceivablesFromEos } from "../services/eosAccountReceivablesClient.js";
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";

// WHICH SOURCE ANSWERS, decided once at BUILD time (Firebase exit F7c, DECISIONS #245) by the same compile-time flag F1 uses
// (access/eosSessionSource.js): where an EOS API is declared the Account's receivables are the Finance register's RECEIVABLE
// obligations (listObligations); everywhere else -- production declares none -- the Firebase callable is the SOLE source, exactly
// as before. There is no runtime fallback in either direction.
export const fetchAccountAr = EOS_SESSION_SOURCE ? fetchAccountReceivablesFromEos : fetchAccountInvoiceAr;

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
//
// PRINCIPAL ISOLATION (F7c review). The key is `${uid}:${accountId}`, never the account alone: with the EOS source the
// answer is decided per caller (company reach), so a request in flight for principal A must never be handed to principal B
// who signs in on the same tab before it settles. Different principals never share a request.
const inFlight = new Map();

/** @param {(accountId: string) => Promise<object>} fetchOne */
export function makeSharedFetch(fetchOne, map = inFlight) {
  return function sharedFetch(uid, accountId) {
    const key = `${uid ?? ""}:${accountId}`;
    const existing = map.get(key);
    if (existing) return existing;

    const request = fetchOne(accountId).finally(() => {
      // Cleared on settle — success or failure. Leaving a rejected promise cached would
      // pin a transient failure for every later consumer of this account.
      map.delete(key);
    });
    map.set(key, request);
    return request;
  };
}

const sharedFetch = makeSharedFetch((accountId) => fetchAccountAr(accountId));

/** Test-only: drop any shared in-flight entries so cases cannot leak into each other. */
export function __resetAccountArInFlightForTest() {
  inFlight.clear();
}

export function useAccountAr(accountId) {
  const uid = (useAuth() ?? {}).user?.uid ?? null;
  const [state, setState] = useState({ loading: true, errorStatus: null, result: null });

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState({ loading: false, errorStatus: null, result: null });
      return undefined;
    }
    setState({ loading: true, errorStatus: null, result: null });
    sharedFetch(uid, accountId).then(({ result, errorStatus }) => {
      if (cancelled) return;
      setState({ loading: false, errorStatus: errorStatus ?? null, result: result ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, uid]);

  return state;
}

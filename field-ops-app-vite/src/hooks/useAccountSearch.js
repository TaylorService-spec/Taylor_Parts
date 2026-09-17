import { useEffect, useRef, useState } from "react";
import { collection, getDocs, limit as fsLimit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { accountSearchQueryShape, interpretAccountSearchRead, ACCOUNT_SEARCH_CAP } from "../domain/accountSearch.js";
import { useAccountSearch as useAccountSearchEosApi } from "./crm/eosApi/useAccountSearch.js";

// Build-time CRM authority route (domain/crmAuthorityRoute.js): true only in a platform-sandbox build.
const CRM_VIA_EOS_API = typeof __APP_CRM_VIA_EOS_API__ === "boolean" && __APP_CRM_VIA_EOS_API__;

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

function useAccountSearchFirestore(term, { cap = ACCOUNT_SEARCH_CAP } = {}) {
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
        const q = query(
          collection(db, shape.collection),
          where(shape.fieldPath, ">=", shape.start),
          where(shape.fieldPath, "<=", shape.end),
          orderBy(shape.fieldPath, "asc"),
          fsLimit(shape.limit)
        );
        const snap = await getDocs(q);
        if (token !== requestRef.current) return;
        setRaw({ docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null });
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

// ════════════════════ BUILD-TIME CRM AUTHORITY ROUTE ════════════════════
// `useAccountSearch` is selected ONCE, from the build's environment (domain/crmAuthorityRoute.js): a platform-sandbox build
// uses the EOS API implementation (hooks/crm/eosApi/useAccountSearch.js); every other build -- production included -- uses the legacy
// Firestore implementation above, unchanged. No runtime switch and no fallback between the two.
export const useAccountSearch = CRM_VIA_EOS_API ? useAccountSearchEosApi : useAccountSearchFirestore;

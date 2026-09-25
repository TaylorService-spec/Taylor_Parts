// The one React hook that reads the cross-account Sales Agreement index.
//
// It calls POST /commercial/sales { operation: "listSalesAgreements" } once per mount and hands the
// envelope to domain/salesAgreementIndex.js, which does all the interpretation. This file owns the
// LIFECYCLE only: when to fetch, how to discard a stale or unmounted answer, and how to retry --
// the same split `useExperienceContext` makes, and for the same reason.
//
// NO FALLBACK LIVES HERE. A failed call is rendered as a failure. It is never retried against
// Firestore (`sales_agreements` is an explicit deny-all in firestore.rules, read AND write), never
// softened into an empty list, and never allowed to mean "assume the legacy role".
import { useCallback, useEffect, useMemo, useState } from "react";
import { commercialApiClient } from "../services/commercialApiClient.js";
import { salesAgreementIndexView } from "../domain/salesAgreementIndex.js";

export const SALES_AGREEMENT_INDEX_OPERATION = "listSalesAgreements";

/**
 * @param {object} options
 * @param {{call: Function}} [options.client] injectable transport seam
 * @param {number} [options.limit]            page size; the server caps it and refuses anything larger
 * @returns {{view: object, reload: Function}}
 */
export function useSalesAgreementIndex({ client = commercialApiClient, limit = 50 } = {}) {
  const [result, setResult] = useState(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Cleared before the new read starts: showing the previous answer under a retry would make a
    // stale success look like a fresh one.
    setResult(null);
    (async () => {
      const answer = await client.call(SALES_AGREEMENT_INDEX_OPERATION, { input: { limit } });
      if (cancelled) return;
      setResult(answer);
    })();
    return () => { cancelled = true; };
  }, [client, limit, generation]);

  const view = useMemo(() => salesAgreementIndexView(result), [result]);
  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return { view, reload };
}

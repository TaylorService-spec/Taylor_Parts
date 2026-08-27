import { useCallback, useEffect, useRef, useState } from "react";
import { getSalesAgreementContext } from "../services/salesAgreementCommandClient.js";
import { salesAgreementView, SALES_AGREEMENT_VIEW_STATE } from "../domain/salesAgreementView.js";
import {
  planSalesAgreementRead,
  interpretSalesAgreementReadResponse,
  salesAgreementAbsence,
  SALES_AGREEMENT_READ_MODE,
} from "../domain/salesAgreementRead.js";

// ONE SALES AGREEMENT, BY ITS OWN IDENTITY — the read a routed record page needs.
//
// PR 2 of the Sales Agreement North Star implementation. It composes the EXISTING governed
// `getSalesAgreementContext` callable, which was already exported from functions/src/index.ts and
// already wired in services/salesAgreementCommandClient.js. No callable, no capability, no index
// and no Rules change: the read authority this page needs has existed the whole time and nothing
// called it.
//
// ════════════════════ READ-ONLY, DELIBERATELY ════════════════════
//
// `useSalesAgreement` bundles create / updateDraft / accept because the Opportunity surface needs
// them together. This hook exposes NO mutation. PR 4 wires the two governed commands onto the
// record page; until then a surface holding an agreement id cannot write through this seam even by
// accident — which is the point of introducing it separately.
//
// ════════════════════ THE DECISIONS ARE NOT IN THIS FILE ════════════════════
//
// Whether to read at all, and what one answer means, live in domain/salesAgreementRead.js so node
// can assert them. What remains here is the part that genuinely needs React: the two guards below.
// Both are copied in behaviour from `useSalesAgreement`, and both exist because of real defects.

export function useSalesAgreementById(salesAgreementId, { enabled = true } = {}) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState(null);

  // Guards a stale response from an earlier id overwriting a newer one's.
  const requestSeq = useRef(0);
  // AND GUARDS AN UNMOUNTED TREE. The sequence check only orders responses WITHIN a mount; a read
  // still in flight when the page unmounts resolved into a component that no longer exists. Under
  // jsdom the environment is torn down first, so the setState lands on a global that has been
  // removed and the whole suite fails with "window is not defined", pointing at an innocent file.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const plan = planSalesAgreementRead({ salesAgreementId, enabled });
    if (!plan.shouldRead) {
      setResult(null);
      setLoading(false);
      setErrorStatus(plan.errorStatus);
      return;
    }
    const mine = ++requestSeq.current;
    setLoading(true);
    const response = await getSalesAgreementContext({ salesAgreementId: plan.salesAgreementId });
    if (!mounted.current || mine !== requestSeq.current) return; // unmounted, or already superseded
    const { result: next, errorStatus: nextError } = interpretSalesAgreementReadResponse(response);
    setLoading(false);
    setErrorStatus(nextError);
    setResult(next);
  }, [salesAgreementId, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  const view = salesAgreementView({ result, loading, errorStatus });
  return {
    view,
    // Same view state, two different facts: an id that resolves to nothing is a bad address, not an
    // invitation to draft an agreement from nowhere. See domain/salesAgreementRead.js.
    absence: salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID),
    readMode: SALES_AGREEMENT_READ_MODE.BY_ID,
    refresh,
    STATE: SALES_AGREEMENT_VIEW_STATE,
  };
}

export default useSalesAgreementById;

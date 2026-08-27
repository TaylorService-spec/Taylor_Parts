import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSalesAgreementContext,
  updateSalesAgreementDraft,
  acceptSalesAgreement,
} from "../services/salesAgreementCommandClient.js";
import { useAgreementCommandRunner } from "./useAgreementCommandRunner.js";
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
// ════════════════════ TWO COMMANDS, AND ONLY TWO (PR 4) ════════════════════
//
// It shipped read-only in PR 2 and gains exactly `updateSalesAgreementDraft` and
// `acceptSalesAgreement` here. NOT `createSalesAgreement` — creation belongs to the Opportunity
// surface, which is the only place that knows which Opportunity an agreement would be created FROM,
// and the server derives the customer from it. There is no third command in this family.
//
// Both run through `useAgreementCommandRunner`, the same discipline `useSalesAgreement` uses:
// per-intent idempotency keys, one in-flight command at a time, and an authoritative re-read after
// every success. What differs is only WHICH read is refreshed — this hook's by-id one.
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

  // The shared runner, refreshing through THIS hook's by-id read — which is the whole reason the
  // discipline was extracted: `useSalesAgreement` would have re-read by opportunity after a command
  // and left this page showing pre-command state.
  const { run, pending, commandError, clearCommandError } = useAgreementCommandRunner(refresh);

  const updateDraft = useCallback(
    (patch) => run("updateDraft", (idempotencyKey) =>
      // The id comes from the ROUTE, not from the caller: a page that let a handler name a different
      // agreement would be a way to edit one record from another's address.
      updateSalesAgreementDraft({ ...patch, salesAgreementId, idempotencyKey })),
    [run, salesAgreementId],
  );

  // ACCEPT TAKES NO COMMERCIAL INPUT — only which agreement, and the retry key. state, acceptedAt
  // and acceptedBy are server-stamped, and sending them is refused rather than ignored.
  const accept = useCallback(
    () => run("accept", (idempotencyKey) => acceptSalesAgreement({ salesAgreementId, idempotencyKey })),
    [run, salesAgreementId],
  );

  const view = salesAgreementView({ result, loading, errorStatus });
  return {
    view,
    updateDraft,
    accept,
    pending,
    commandError,
    clearCommandError,
    // Same view state, two different facts: an id that resolves to nothing is a bad address, not an
    // invitation to draft an agreement from nowhere. See domain/salesAgreementRead.js.
    absence: salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID),
    readMode: SALES_AGREEMENT_READ_MODE.BY_ID,
    refresh,
    STATE: SALES_AGREEMENT_VIEW_STATE,
  };
}

export default useSalesAgreementById;

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSalesAgreementForOpportunity,
  createSalesAgreement,
  updateSalesAgreementDraft,
  acceptSalesAgreement,
} from "../services/salesAgreementCommandClient.js";
import { salesAgreementView, SALES_AGREEMENT_VIEW_STATE } from "../domain/salesAgreementView.js";
import { useAgreementCommandRunner } from "./useAgreementCommandRunner.js";

// The Sales Agreement for one Opportunity: read it, create it, edit the draft, accept it.
//
// ════════════════════ THE COMMAND DISCIPLINE MOVED, IT DID NOT CHANGE ════════════════════
//
// Per-intent idempotency keys, the unmounted-tree guard, the re-read after every successful
// mutation and the refusal to patch local state all now live in `useAgreementCommandRunner`,
// extracted in PR 4 of the Sales Agreement North Star run so the by-id record page shares ONE
// mechanism with this hook rather than growing a second. The behaviour here is unchanged; what each
// hook still owns is its own read, and therefore its own `refresh`.

export function useSalesAgreement(opportunityId, { enabled = true } = {}) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState(null);
  // Guards a stale response from an earlier Opportunity overwriting a newer one's.
  const requestSeq = useRef(0);
  // AND GUARDS AN UNMOUNTED TREE. The sequence check above only orders responses WITHIN a mount;
  // a read still in flight when the workspace unmounts resolved into a component that no longer
  // exists. React's own logs call that a leak; under jsdom it is worse -- the environment is torn
  // down first, so the setState lands on a global that has been removed and the whole suite fails
  // with "window is not defined", pointing at a file that did nothing wrong.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    // DO NOT ASK FOR WHAT THIS CALLER MAY NOT HAVE.
    //
    // The read is a governed callable behind salesAgreement.read. Where that capability is not
    // granted, firing the request anyway produces a doomed round trip per selection. An undeployed
    // Firebase callable answers 404 WITHOUT CORS headers, so the browser reports it as a CORS
    // failure and logs a red error on every single Opportunity a user clicks.
    //
    // This comment used to say the capability was granted in EVERY environment's negative — "which
    // today is EVERY environment". That is stale and was corrected here in PR 2 of the Sales
    // Agreement North Star run: access/environmentCapabilityOverrides.ts activates all four
    // salesAgreement capabilities for eos-platform-sandbox, and App.jsx threads the resolved
    // decision through. NOT_ENABLED is a real state to design for, not a permanent condition.
    //
    // That console noise is not harmless: it is the first thing anyone looks at when something else
    // goes wrong, and it says "blocked by CORS policy" about a feature that is simply not deployed.
    //
    // Not-enabled is reported as its own state, distinct from denied and from unavailable.
    if (!enabled) { setResult(null); setErrorStatus("not-enabled"); return; }
    if (!opportunityId) { setResult(null); setErrorStatus(null); return; }
    const mine = ++requestSeq.current;
    setLoading(true);
    const res = await getSalesAgreementForOpportunity({ opportunityId });
    if (!mounted.current || mine !== requestSeq.current) return; // unmounted, or already superseded
    setLoading(false);
    if (res.errorStatus) { setErrorStatus(res.errorStatus); setResult(null); return; }
    setErrorStatus(null);
    setResult(res.result ?? null);
  }, [opportunityId, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  // The shared runner, refreshing through THIS hook's by-opportunity read.
  const { run, pending, commandError, clearCommandError } = useAgreementCommandRunner(refresh);

  const create = useCallback(
    (input) => run("create", (idempotencyKey) =>
      // accountId is NOT sent. The server derives the customer from the Opportunity, because that
      // is the fact that decides who gets billed — and the callable rejects a payload carrying one.
      createSalesAgreement({ ...input, opportunityId, idempotencyKey })),
    [run, opportunityId],
  );

  const updateDraft = useCallback(
    (salesAgreementId, patch) => run("updateDraft", (idempotencyKey) =>
      updateSalesAgreementDraft({ ...patch, salesAgreementId, idempotencyKey })),
    [run],
  );

  const accept = useCallback(
    (salesAgreementId) => run("accept", (idempotencyKey) =>
      acceptSalesAgreement({ salesAgreementId, idempotencyKey })),
    [run],
  );

  return {
    view: salesAgreementView({ result, loading, errorStatus }),
    refresh,
    create,
    updateDraft,
    accept,
    pending,
    commandError,
    clearCommandError,
    STATE: SALES_AGREEMENT_VIEW_STATE,
  };
}

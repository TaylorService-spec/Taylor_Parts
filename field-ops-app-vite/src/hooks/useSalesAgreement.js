import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSalesAgreementForOpportunity,
  createSalesAgreement,
  updateSalesAgreementDraft,
  acceptSalesAgreement,
} from "../services/salesAgreementCommandClient.js";
import { salesAgreementView, SALES_AGREEMENT_VIEW_STATE } from "../domain/salesAgreementView.js";

// The Sales Agreement for one Opportunity: read it, create it, edit the draft, accept it.
//
// ════════════════════ IDEMPOTENCY KEYS ARE MINTED PER INTENT, NOT PER CALL ════════════════════
//
// Each command's key is generated ONCE when the user forms the intent and reused across every
// retry of that intent. A key minted inside the transport layer would make every retry a fresh
// create — which is precisely the failure the server's replay path exists to prevent, defeated on
// the client. The key is cleared only when the command SUCCEEDS, so a network failure followed by a
// retry replays rather than duplicating.
//
// ════════════════════ EVERY MUTATION RE-READS ════════════════════
//
// Nothing here patches local state from a command's return value. The server owns totals, state,
// timestamps and the allocated number; a locally-assembled optimistic record would be a second
// answer that disagrees the moment any of them is derived differently. Slower, and honest.

let keySeq = 0;
const mintKey = (prefix) => `${prefix}-${Date.now()}-${++keySeq}-${Math.floor(Math.random() * 1e6)}`;

export function useSalesAgreement(opportunityId) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [commandError, setCommandError] = useState(null);
  // Keys survive a re-render so a retry reuses the SAME key. Keyed by intent, not by attempt.
  const keys = useRef({});
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
    if (!opportunityId) { setResult(null); setErrorStatus(null); return; }
    const mine = ++requestSeq.current;
    setLoading(true);
    const res = await getSalesAgreementForOpportunity({ opportunityId });
    if (!mounted.current || mine !== requestSeq.current) return; // unmounted, or already superseded
    setLoading(false);
    if (res.errorStatus) { setErrorStatus(res.errorStatus); setResult(null); return; }
    setErrorStatus(null);
    setResult(res.result ?? null);
  }, [opportunityId]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async (intent, fn) => {
    setPending(intent);
    setCommandError(null);
    keys.current[intent] = keys.current[intent] ?? mintKey(intent);
    const res = await fn(keys.current[intent]);
    // A command that lands after unmount still SUCCEEDED on the server -- the write is real and the
    // idempotency key is spent. Only the local state update is abandoned.
    if (!mounted.current) return res.errorStatus ? { ok: false, errorStatus: res.errorStatus } : { ok: true, result: res.result };
    setPending(null);
    if (res.errorStatus) {
      // The key is DELIBERATELY kept: the next attempt is a retry of the same intent, and the
      // server must be able to recognise it as one.
      setCommandError(res.errorStatus === "internal" ? "That did not go through. Try again." : res.errorStatus);
      return { ok: false, errorStatus: res.errorStatus };
    }
    delete keys.current[intent];
    await refresh();
    return { ok: true, result: res.result };
  }, [refresh]);

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
    clearCommandError: () => setCommandError(null),
    STATE: SALES_AGREEMENT_VIEW_STATE,
  };
}

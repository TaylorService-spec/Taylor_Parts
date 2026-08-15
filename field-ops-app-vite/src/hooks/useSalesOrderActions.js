import { useCallback, useRef, useState } from "react";
import { salesOrderCommandClient } from "../services/salesOrderCommandClient.js";
import {
  outcomeFromErrorCode,
  outcomeFromTransitionResult,
  outcomeFromAllocateResult,
  outcomeFromServiceResult,
} from "../domain/salesOrderActions.js";

function newIdempotencyKey() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `so-${uuid}`.slice(0, 200);
}

// Sales Order operational-action hook. The ONLY place the three trusted Sales Order write callables
// are invoked from the workspace (salesOrderCommandClient.js). `deps.client` lets tests inject a
// MOCKED client without touching `firebase` (mirrors hooks/usePartMasterWrite.js's deps.client seam).
//
// IDEMPOTENCY KEY STRATEGY (the load-bearing correctness detail for transitionSalesOrder, the only one
// of the three commands that takes an idempotencyKey): a key is generated ONCE per user INTENT, not
// once per render and not once per network attempt. "Intent" = one open confirmation for one
// transition (ADVANCE or CANCEL). The key is created lazily the first time that transition is run and
// cached in a ref keyed by transition name; every subsequent call for the SAME transition -- in
// particular a user re-clicking Confirm after a failed attempt, i.e. a retry of the same intent --
// reuses the exact same cached key, so a network-level double-send can never apply twice. The key is
// discarded (so the NEXT click starts a genuinely new intent with a fresh key) only when: (a) the
// transition succeeds, or (b) the caller explicitly abandons the intent via discardTransitionIntent
// (e.g. the confirmation dialog is closed without confirming). It is deliberately NOT cleared on a
// failed attempt -- that is exactly the retry case this exists to protect.
export function useSalesOrderActions(salesOrderId, deps) {
  const client = deps?.client ?? salesOrderCommandClient;
  const [pending, setPending] = useState({ advance: false, cancel: false, allocate: false, service: false });
  const transitionKeysRef = useRef({});

  // A retained key MUST NOT survive a change of Sales Order.
  //
  // The server derives the replay identity as mkAuditId(command, actorUid, idempotencyKey) --
  // salesOrderId is NOT part of it (functions/src/salesOrder/salesOrderCallables.ts). A key kept after
  // a failed attempt on one Sales Order, then reused on a different one, would match the earlier audit
  // id and take the replay branch, which returns `{ success: true, replayed: true }` WITHOUT applying
  // the transition -- reporting success for a transition that never happened.
  //
  // This component is not guaranteed to remount between orders (the same route with a different
  // :salesOrderId re-renders in place), so the cache is scoped explicitly rather than relying on
  // unmount. Any pending intent belongs to the order it was created for and is dropped with it.
  const keyScopeRef = useRef(salesOrderId);
  if (keyScopeRef.current !== salesOrderId) {
    keyScopeRef.current = salesOrderId;
    transitionKeysRef.current = {};
  }

  // Exposed so tests can assert stability without depending on internal timing.
  const peekTransitionIntentKey = useCallback((transition) => transitionKeysRef.current[transition] ?? null, []);

  const discardTransitionIntent = useCallback((transition) => {
    delete transitionKeysRef.current[transition];
  }, []);

  const runTransition = useCallback(async (transition) => {
    const pendingField = transition === "ADVANCE" ? "advance" : "cancel";
    if (!transitionKeysRef.current[transition]) {
      transitionKeysRef.current[transition] = newIdempotencyKey();
    }
    const idempotencyKey = transitionKeysRef.current[transition];
    setPending((p) => ({ ...p, [pendingField]: true }));
    try {
      const { result, errorStatus } = await client.transitionSalesOrder({ salesOrderId, transition, idempotencyKey });
      if (errorStatus) {
        throw Object.assign(new Error(outcomeFromErrorCode(errorStatus).message), { outcome: outcomeFromErrorCode(errorStatus) });
      }
      const outcome = outcomeFromTransitionResult(result);
      delete transitionKeysRef.current[transition]; // this intent is finished -- a future click starts a new one
      return outcome;
    } finally {
      setPending((p) => ({ ...p, [pendingField]: false }));
    }
  }, [salesOrderId, client]);

  const runAllocate = useCallback(async () => {
    setPending((p) => ({ ...p, allocate: true }));
    try {
      const { result, errorStatus } = await client.allocateSalesOrder({ salesOrderId });
      if (errorStatus) {
        throw Object.assign(new Error(outcomeFromErrorCode(errorStatus).message), { outcome: outcomeFromErrorCode(errorStatus) });
      }
      return outcomeFromAllocateResult(result);
    } finally {
      setPending((p) => ({ ...p, allocate: false }));
    }
  }, [salesOrderId, client]);

  const runCreateService = useCallback(async () => {
    setPending((p) => ({ ...p, service: true }));
    try {
      const { result, errorStatus } = await client.createServiceForSalesOrder({ salesOrderId });
      if (errorStatus) {
        throw Object.assign(new Error(outcomeFromErrorCode(errorStatus).message), { outcome: outcomeFromErrorCode(errorStatus) });
      }
      return outcomeFromServiceResult(result);
    } finally {
      setPending((p) => ({ ...p, service: false }));
    }
  }, [salesOrderId, client]);

  return { pending, runTransition, runAllocate, runCreateService, peekTransitionIntentKey, discardTransitionIntent };
}

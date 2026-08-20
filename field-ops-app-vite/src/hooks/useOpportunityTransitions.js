import { useCallback, useRef, useState } from "react";
import { opportunityCommandClient } from "../services/opportunityCommandClient.js";
import { outcomeFromErrorCode, outcomeFromTransitionResult } from "../domain/opportunityCommandOutcome.js";

function newIdempotencyKey() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `opp-tr-${uuid}`.slice(0, 200);
}

// One transition INTENT -> a stable cache key. ADVANCE is keyed by its target stage (only one ADVANCE is
// ever legally offered at a time, but keying by target keeps a stale key from a since-changed target from
// ever being reused); OUTCOME is keyed by WON/LOST separately since both can be offered simultaneously.
function intentKey(intent) {
  return intent.kind === "ADVANCE" ? `ADVANCE:${intent.toStage}` : `OUTCOME:${intent.outcome}`;
}

// Opportunity lifecycle TRANSITION action hook. The ONLY place transitionOpportunity is invoked from the
// workspace (services/opportunityCommandClient.js). `deps.client` lets tests inject a MOCKED client
// (mirrors hooks/useSalesOrderActions.js's deps.client seam).
//
// IDEMPOTENCY KEY STRATEGY + SCOPING HAZARD -- copied directly from hooks/useSalesOrderActions.js's
// load-bearing comment, because the server-side hazard is IDENTICAL: a key is generated ONCE per user
// INTENT (one open confirmation for one ADVANCE-to-a-stage or one OUTCOME) and reused across a retry of
// that same intent (a re-click of the same button after a failed attempt), so a network-level double-send
// can never apply twice. The key is discarded on success or via discardIntent; it is deliberately NOT
// cleared on a failed attempt (that is the retry case this protects).
//
// The server derives the replay identity as mkAuditId("transitionOpportunity", actorUid, idempotencyKey)
// (functions/src/opportunity/opportunityCallables.ts) -- opportunityId is NOT part of it. A key kept after
// a failed attempt on one Opportunity, then reused (by a stale ref) on a DIFFERENT Opportunity, would match
// the earlier audit id and take the replay branch, returning `{ success: true, replayed: true }` WITHOUT
// applying the transition to the new Opportunity -- reporting success for a transition that never happened.
// This hook is not guaranteed to remount between Opportunities (the same detail pane re-selects a different
// row in place), so the cache is scoped explicitly by opportunityId rather than relying on unmount: any
// pending intent belongs to the Opportunity it was created for and is dropped with it.
export function useOpportunityTransitions(opportunityId, deps) {
  const client = deps?.client ?? opportunityCommandClient;
  const [pending, setPending] = useState({});
  const keysRef = useRef({});

  const keyScopeRef = useRef(opportunityId);
  if (keyScopeRef.current !== opportunityId) {
    keyScopeRef.current = opportunityId;
    keysRef.current = {};
  }

  const peekIntentKey = useCallback((intent) => keysRef.current[intentKey(intent)] ?? null, []);

  const discardIntent = useCallback((intent) => {
    delete keysRef.current[intentKey(intent)];
  }, []);

  const runTransition = useCallback(
    async (intent) => {
      const ik = intentKey(intent);
      if (!keysRef.current[ik]) {
        keysRef.current[ik] = newIdempotencyKey();
      }
      const idempotencyKey = keysRef.current[ik];
      setPending((p) => ({ ...p, [ik]: true }));
      try {
        // WON DOES NOT GO THROUGH transitionOpportunity.
        //
        // It can -- the callable accepts outcome WON -- and that is exactly the defect. The
        // transition sets WON and creates NO Sales Order, so a Won routed through it leaves
        // an Opportunity that is WON, terminal, and orderless: the split-brain
        // closeOpportunityAsWon was built to make unreachable. Before this, clicking
        // "Mark Won" did precisely that.
        //
        // The atomic command does both halves in one transaction. A client cannot assemble
        // that guarantee out of two calls, so it does not try -- it calls the one command
        // that carries it. LOST and every ADVANCE stay on the transition path, which is
        // correct for them: neither creates an order.
        //
        // The Sales Order's own owner and channel come from the Opportunity being closed.
        // The server derives account and lines itself rather than trusting the payload, so
        // only these two are sent.
        const isWon = intent.kind === "OUTCOME" && intent.outcome === "WON";
        const { result, errorStatus } = isWon
          ? await client.closeOpportunityAsWon({
              opportunityId,
              ownerEmployeeId: intent.ownerEmployeeId,
              salesChannel: intent.salesChannel,
              idempotencyKey,
            })
          : await client.transitionOpportunity({
              opportunityId,
              idempotencyKey,
              ...(intent.kind === "ADVANCE" ? { toStage: intent.toStage } : { outcome: intent.outcome }),
            });
        if (errorStatus) {
          throw Object.assign(new Error(outcomeFromErrorCode(errorStatus).message), { outcome: outcomeFromErrorCode(errorStatus) });
        }
        // The atomic command returns the Sales Order it created OR found. Carried through so
        // the caller can link to it -- a Won that does not show its order leaves the user to
        // go hunting for the thing they just made.
        const outcome = outcomeFromTransitionResult(result);
        if (isWon && result) {
          outcome.salesOrderId = result.salesOrderId ?? null;
          outcome.salesOrderNumber = result.salesOrderNumber ?? null;
          outcome.recovered = result.recovered === true;
        }
        delete keysRef.current[ik]; // this intent is finished -- a future click starts a new one
        return outcome;
      } finally {
        setPending((p) => ({ ...p, [ik]: false }));
      }
    },
    [opportunityId, client],
  );

  return { pending, runTransition, peekIntentKey, discardIntent };
}

import { useCallback, useRef, useState } from "react";
import { opportunityCommandClient } from "../services/opportunityCommandClient.js";
import { outcomeFromErrorCode, outcomeFromCreateResult } from "../domain/opportunityCommandOutcome.js";

function newIdempotencyKey() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `opp-${uuid}`.slice(0, 200);
}

// Opportunity CREATE action hook. The ONLY place createOpportunity is invoked from the workspace
// (services/opportunityCommandClient.js). `deps.client` lets tests inject a MOCKED client without
// touching `firebase` (mirrors hooks/useSalesOrderActions.js's deps.client seam).
//
// IDEMPOTENCY KEY STRATEGY (copied from hooks/useSalesOrderActions.js's load-bearing comment, adapted to
// create having no pre-existing entity id to scope by): a key is generated ONCE per user INTENT, not once
// per render and not once per network attempt. "Intent" here = one open New-Opportunity form submission
// cycle. The key is created lazily on the first submit and cached in a ref; a re-click of Submit after a
// FAILED attempt — the retry case — reuses the exact same key, so a network-level double-send can never
// create two Opportunities for one user action. The key is discarded (a future submit starts a genuinely
// new intent with a fresh key) only when: (a) the create succeeds, or (b) the caller explicitly abandons
// the intent via discardIntent (e.g. the form is closed/cancelled without submitting). It is deliberately
// NOT cleared on a failed attempt.
//
// Unlike a Sales Order transition, there is no existing entity id this key could be mistakenly replayed
// against across a DIFFERENT record — a create intent is scoped to itself by construction (each open of
// the New Opportunity form is expected to get its own hook instance / fresh key via discardIntent), so no
// keyScope-reset-on-id-change is needed here (contrast hooks/useSalesOrderActions.js and
// hooks/useOpportunityTransitions.js, both of which mutate an EXISTING entity and must reset on id change).
export function useOpportunityCreate(deps) {
  const client = deps?.client ?? opportunityCommandClient;
  const [pending, setPending] = useState(false);
  const keyRef = useRef(null);

  // Exposed so tests can assert stability without depending on internal timing.
  const peekIntentKey = useCallback(() => keyRef.current, []);

  const discardIntent = useCallback(() => {
    keyRef.current = null;
  }, []);

  const runCreate = useCallback(
    async (input) => {
      if (!keyRef.current) {
        keyRef.current = newIdempotencyKey();
      }
      const idempotencyKey = keyRef.current;
      setPending(true);
      try {
        const { result, errorStatus } = await client.createOpportunity({ ...input, idempotencyKey });
        if (errorStatus) {
          throw Object.assign(new Error(outcomeFromErrorCode(errorStatus).message), { outcome: outcomeFromErrorCode(errorStatus) });
        }
        const outcome = outcomeFromCreateResult(result);
        keyRef.current = null; // this intent is finished -- a future submit starts a new one
        return outcome;
      } finally {
        setPending(false);
      }
    },
    [client],
  );

  return { pending, runCreate, peekIntentKey, discardIntent };
}

import { useCallback, useRef, useState } from "react";
import { crmActivityCallableClient } from "../services/crmActivityCallableClient.js";

function newIdempotencyKey() {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `crmact-${uuid}`.slice(0, 200);
}

// CRM Activity create-action hook. The ONLY place the trusted createCrmActivity callable is invoked from
// the workspace (services/crmActivityCallableClient.js). `deps.client` lets tests inject a MOCKED client
// without touching `firebase` (mirrors hooks/useSalesOrderActions.js's deps.client seam).
//
// IDEMPOTENCY KEY STRATEGY -- copied verbatim from hooks/useSalesOrderActions.js's own documented
// contract (the load-bearing correctness detail):
// A key is generated ONCE per user INTENT, not once per render and not once per network attempt.
// "Intent" = one open Add-Note form submission. The key is created lazily the first time submit is
// attempted and cached in a ref; every subsequent call for the SAME open intent -- in particular a user
// re-clicking Submit after a failed attempt, i.e. a retry of the same intent -- reuses the exact same
// cached key, so a network-level double-send can never create two activities. The key is discarded (so
// the NEXT submit starts a genuinely new intent with a fresh key) only when: (a) the create succeeds, or
// (b) the caller explicitly abandons the intent via discardCreateIntent (e.g. the Add Note form is closed
// without submitting). It is deliberately NOT cleared on a failed attempt -- that is exactly the retry
// case this exists to protect.
//
// SCOPING (mirrors useSalesOrderActions.js's own "a retained key MUST NOT survive a change of..." rule):
// the server derives the replay identity as mkAuditId("createCrmActivity", actorUid, idempotencyKey) --
// accountId is NOT part of it (crmActivityCallables.ts). A key kept after a failed attempt on one
// account, then reused for a DIFFERENT account, would match the earlier audit id and take the replay
// branch -- returning success for a create that never happened against the new account. This hook is
// scoped to ONE accountId (a fresh instance per account, exactly like useSalesOrderActions(salesOrderId)),
// so that hazard cannot occur as long as callers do not share one hook instance across accounts; the key
// is also reset whenever `accountId` changes, defensively, in case the same hook instance IS reused
// across an in-place account switch.
export function useCrmActivityActions(accountId, deps) {
  const client = deps?.client ?? crmActivityCallableClient;
  const [pending, setPending] = useState(false);
  const keyRef = useRef(null);

  const scopeRef = useRef(accountId);
  if (scopeRef.current !== accountId) {
    scopeRef.current = accountId;
    keyRef.current = null;
  }

  const peekCreateIntentKey = useCallback(() => keyRef.current, []);
  const discardCreateIntent = useCallback(() => {
    keyRef.current = null;
  }, []);

  const runCreate = useCallback(
    async ({ type, body, contactId, opportunityId, salesOrderId, occurredAtMillis }) => {
      if (!keyRef.current) keyRef.current = newIdempotencyKey();
      const idempotencyKey = keyRef.current;
      setPending(true);
      try {
        const { result, errorStatus } = await client.createCrmActivity({
          accountId, type, body, contactId, opportunityId, salesOrderId, occurredAtMillis, idempotencyKey,
        });
        if (errorStatus) {
          throw Object.assign(new Error("Could not save the activity."), { errorStatus });
        }
        keyRef.current = null; // this intent is finished -- a future submit starts a new one
        return result;
      } finally {
        setPending(false);
      }
    },
    [accountId, client],
  );

  return { pending, runCreate, peekCreateIntentKey, discardCreateIntent };
}

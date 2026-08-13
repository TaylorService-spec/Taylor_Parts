// Pure (firebase-free) helper for the createWorkOrder callable idempotency guard, factored out so it is
// unit-testable without firebase-admin -- same "pure core + I/O callable" split the finance callables use.
import { createHash } from "node:crypto";

// Deterministic Audit Event id = the idempotency marker for a create. Same (actor, scope, key) -> same id, so
// the callable's transactional existence check collapses a retried create carrying the same key into a no-op
// replay (returning the already-created Work Order instead of minting a second one and burning a WO number).
// `scope` is the create's stable business key (e.g. `${customerId}|${locationId}`). Mirrors
// finance/invoiceCallables.ts `auditId`.
export function createWorkOrderAuditId(actorUid: string, scope: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`${actorUid}|${scope}|${idempotencyKey}`).digest("hex").slice(0, 40);
  return `createWorkOrder_${digest}`;
}

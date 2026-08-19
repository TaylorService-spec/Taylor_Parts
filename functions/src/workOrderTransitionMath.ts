// Pure (firebase-free) helper for the transitionWorkOrder callable's Audit Event id (M9/H19 remediation --
// see transitionWorkOrder.ts's header comment). Same "pure core + I/O callable" split as
// workOrderCreateMath.ts's createWorkOrderAuditId / workOrderExecutionMath.ts's executionDataAuditId.
//
// Deterministic Audit Event id = workOrderId + action. TRANSITIONS in transitionEngine.ts is a DAG with no
// cycles and no repeated outgoing edges for a given status -- every action can apply to a given Work Order
// document at most once across its whole lifecycle (canTransition() rejects re-entering a status already
// left behind), so (workOrderId, action) alone is already collision-free without a caller-supplied key. This
// gives every applied transition a stable, reconstructible id (unlike createWorkOrder/
// updateWorkOrderExecutionData, whose deterministic id exists to collapse a RETRY into a no-op replay, this
// id exists purely so the audit trail is traceable to the exact transition that produced it -- it is not
// itself an idempotency gate; canTransition() already makes a genuine retry of an applied action fail before
// this id is ever computed).
import { createHash } from "node:crypto";

export function transitionWorkOrderAuditId(workOrderId: string, action: string): string {
  const digest = createHash("sha256").update(`${workOrderId}|${action}`).digest("hex").slice(0, 40);
  return `transitionWorkOrder_${digest}`;
}

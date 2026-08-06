import { makeCollectionStore } from "../firebase/collectionStore";

// UNUSED / NON-CANONICAL (verified 2026-08-05, W0): the `workOrdersStore`
// export below has NO consumer anywhere in src -- this `workOrders`
// collection is NOT the governed Work Order path. The canonical, persisted
// Work Order model is `fieldops_wos`, written ONLY by the createWorkOrder /
// transitionWorkOrder Cloud Functions (see docs/architecture/ADR-002 and
// CLAUDE_CONTEXT rule 2). This legacy store predates that engine; the shape
// noted below is historical, not authoritative. Retire it in W4 once a
// zero-consumer check is re-confirmed.
//
// (Historical shape: { id, customerId, customerName, status, priority,
// scheduledDate, createdAt, updatedAt }, status "open"|"scheduled"|
// "in_progress"|"closed".)

export const workOrdersStore = makeCollectionStore("workOrders");

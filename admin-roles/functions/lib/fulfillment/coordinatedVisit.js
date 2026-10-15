"use strict";
// Fulfillment — PURE coordinated-visit projection (Cycle 8 impl; framework-independent, unit-tested). Groups
// the Work Orders that fulfill one Sales Order (they share `salesOrderId`, established in Cycle 7) into a
// single coordinated-visit view for Dispatch/Scheduling — WITHOUT a new Job/Visit/WorkOrderGroup authority
// (multi-equipment-coordination-assessment.md: the Sales Order IS the coordinator). No Firestore imports.
//
// This is an OPERATIONAL (Service/Dispatch) read — deliberately SEPARATE from commercial coverage/territory
// (register #15): it groups by the Sales Order and shows the shared customer/site + per-Work-Order execution,
// and never asserts sales ownership. Per-unit accountability = one Work Order per row; one coordinated visit =
// this group; partial completion is honest (never a fake whole-visit COMPLETE/INCOMPLETE).
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED_STATUSES = exports.DONE_STATUSES = void 0;
exports.groupWorkOrdersBySalesOrder = groupWorkOrdersBySalesOrder;
exports.buildCoordinatedVisit = buildCoordinatedVisit;
exports.buildCoordinatedVisits = buildCoordinatedVisits;
// Work Order statuses that count as "done" for the coordinated-visit rollup. Kept small + explicit; unknown
// statuses are treated as not-done (honest — we don't assume completion we can't read).
// Exported (not just module-local) so tests can assert every status this projection references is a member
// of the canonical WorkOrderStatus set -- see coordinatedVisit.test.mjs.
exports.DONE_STATUSES = new Set(["COMPLETED", "CLOSED"]);
// Statuses that actively need attention (blockers). Others are simply "in progress".
// ONLY canonical WorkOrderStatus values (types/workOrder.ts) belong here -- "BLOCKED"/"ON_HOLD" are NOT real
// lifecycle statuses (PR #1030 audit finding: they made this Set dead vocabulary that could never match a
// real Work Order, so ATTENTION could only ever be reached via CANCELLED). Regression-tested in
// coordinatedVisit.test.mjs against the canonical status set.
exports.BLOCKED_STATUSES = new Set(["CANCELLED"]);
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
// Group Work Orders by their `salesOrderId` (only those that carry one — standalone Work Orders are not part
// of a Sales-Order coordinated visit). Returns a map salesOrderId → Work Orders.
function groupWorkOrdersBySalesOrder(workOrders) {
    const groups = new Map();
    for (const wo of Array.isArray(workOrders) ? workOrders : []) {
        const soId = str(wo?.salesOrderId);
        if (!soId)
            continue;
        const list = groups.get(soId) ?? [];
        list.push(wo);
        groups.set(soId, list);
    }
    return groups;
}
// Build the coordinated-visit view for one Sales Order's Work Orders. Honest partial completion: all done ⇒
// READY; any blocked ⇒ ATTENTION; some done + some not ⇒ PARTIAL; otherwise IN_PROGRESS. Customer/location are
// the shared context; if the Work Orders disagree, contextConsistent=false (surfaced, not hidden).
function buildCoordinatedVisit(salesOrderId, workOrders) {
    const list = Array.isArray(workOrders) ? workOrders : [];
    const customers = new Set(list.map((w) => str(w.customerId)).filter((v) => v !== null));
    const locations = new Set(list.map((w) => str(w.locationId)).filter((v) => v !== null));
    let completed = 0;
    let blocked = 0;
    const rows = list.map((w) => {
        const status = str(w.status);
        if (status && exports.DONE_STATUSES.has(status))
            completed += 1;
        if (status && exports.BLOCKED_STATUSES.has(status))
            blocked += 1;
        return { id: w.id, woNumber: str(w.woNumber), status, lineRefs: Array.isArray(w.salesOrderLineRefs) ? w.salesOrderLineRefs : [] };
    });
    const total = rows.length;
    let readiness;
    if (blocked > 0)
        readiness = "ATTENTION";
    else if (total > 0 && completed === total)
        readiness = "READY";
    else if (completed > 0)
        readiness = "PARTIAL";
    else
        readiness = "IN_PROGRESS";
    return {
        salesOrderId,
        customerId: customers.size ? [...customers][0] : null,
        locationId: locations.size ? [...locations][0] : null,
        contextConsistent: customers.size <= 1 && locations.size <= 1,
        total,
        completed,
        blocked,
        readiness,
        workOrders: rows,
    };
}
// Build coordinated-visit views for a set of Work Orders (one per Sales Order that has Work Orders).
function buildCoordinatedVisits(workOrders) {
    const groups = groupWorkOrdersBySalesOrder(workOrders);
    return [...groups.entries()].map(([soId, wos]) => buildCoordinatedVisit(soId, wos));
}
//# sourceMappingURL=coordinatedVisit.js.map
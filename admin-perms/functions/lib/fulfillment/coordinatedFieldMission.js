"use strict";
// Fulfillment — PURE coordinated field-mission projection (Cycle 9; framework-independent, unit-tested). The
// technician-facing view of a coordinated visit: ONE customer/location mission context, with per-equipment
// (per-Work-Order) execution + readiness, and honest overall progress. Built on the coordinated-visit
// projection (coordinatedVisit.ts) — the Sales Order coordinates; the Work Orders keep independent execution
// authority (no merged Work Order authority merely for presentation). No Firestore imports.
//
// F1/F2 principles: authority-derived + honest readiness (missing evidence ⇒ UNKNOWN, never a fake READY),
// per-unit completion/blocker preserved, no demo-inventory path. Field signals (parts readiness, load
// verification) are INJECTED from the governed sources; this projection never fabricates them.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED = exports.DONE = void 0;
exports.buildCoordinatedFieldMission = buildCoordinatedFieldMission;
// Exported so tests can assert every status this projection references is a member of the canonical
// WorkOrderStatus set -- see coordinatedFieldMission.test.mjs.
exports.DONE = new Set(["COMPLETED", "CLOSED"]);
// ONLY canonical WorkOrderStatus values (types/workOrder.ts) belong here -- see coordinatedVisit.ts for the
// PR #1030 audit finding this mirrors ("BLOCKED"/"ON_HOLD" are not real lifecycle statuses).
exports.BLOCKED = new Set(["CANCELLED"]);
// Per-unit readiness: a done unit is READY; a blocked status is ATTENTION; unknown parts evidence is UNKNOWN
// (never assume ready); parts ATTENTION or an unverified/missing load is ATTENTION; otherwise READY.
function unitReadinessOf(status, partsReadiness, loadVerified) {
    if (status && exports.DONE.has(status))
        return "READY";
    if (status && exports.BLOCKED.has(status))
        return "ATTENTION";
    if (partsReadiness === "UNKNOWN" || loadVerified === null)
        return "UNKNOWN";
    if (partsReadiness === "ATTENTION" || loadVerified === false)
        return "ATTENTION";
    return "READY";
}
// Roll a set of unit readinesses into a mission-level readiness. Worst-known wins: any ATTENTION ⇒ ATTENTION;
// else any UNKNOWN ⇒ UNKNOWN; else READY. `PARTIAL` is used only for the completion progress rollup (below).
function rollup(readinesses) {
    if (readinesses.some((r) => r === "ATTENTION"))
        return "ATTENTION";
    if (readinesses.some((r) => r === "UNKNOWN"))
        return "UNKNOWN";
    return "READY";
}
// Build the coordinated field mission from a coordinated visit + injected per-WO field signals.
function buildCoordinatedFieldMission(visit, signalsByWorkOrderId = {}) {
    const units = (visit?.workOrders ?? []).map((w) => {
        const sig = signalsByWorkOrderId[w.id] ?? {};
        const partsReadiness = sig.partsReadiness === "READY" || sig.partsReadiness === "ATTENTION" ? sig.partsReadiness : "UNKNOWN";
        const loadVerified = typeof sig.loadVerified === "boolean" ? sig.loadVerified : null;
        return {
            workOrderId: w.id,
            woNumber: w.woNumber,
            status: w.status,
            lineRefs: w.lineRefs,
            partsReadiness,
            loadVerified,
            unitReadiness: unitReadinessOf(w.status, partsReadiness, loadVerified),
        };
    });
    const total = units.length;
    const completed = units.filter((u) => u.status && exports.DONE.has(u.status)).length;
    const blocked = units.filter((u) => u.status && exports.BLOCKED.has(u.status)).length;
    // Load readiness rolls up only the load dimension (verified / unverified / undetermined).
    const loadReadiness = total === 0
        ? "UNKNOWN"
        : units.some((u) => u.loadVerified === false) ? "ATTENTION"
            : units.some((u) => u.loadVerified === null) ? "UNKNOWN"
                : "READY";
    let missionReadiness;
    if (total === 0)
        missionReadiness = "UNKNOWN";
    else if (completed === total)
        missionReadiness = "READY";
    else if (completed > 0 && rollup(units.map((u) => u.unitReadiness)) === "READY")
        missionReadiness = "PARTIAL";
    else
        missionReadiness = rollup(units.map((u) => u.unitReadiness));
    return {
        salesOrderId: visit?.salesOrderId ?? "",
        customerId: visit?.customerId ?? null,
        locationId: visit?.locationId ?? null,
        contextConsistent: visit?.contextConsistent ?? true,
        units,
        progress: { total, completed, blocked },
        loadReadiness,
        missionReadiness,
    };
}
//# sourceMappingURL=coordinatedFieldMission.js.map
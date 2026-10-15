"use strict";
// Fulfillment — PURE allocation-seam projection (framework-independent; unit-tested). This is the seam LOGIC
// that turns a committed Sales Order's remaining demand + an AVAILABILITY determination into an honest,
// per-line allocation plan. No Firestore/firebase-functions imports.
//
// AUTHORITY BOUNDARY (Owner §5): Sales REQUESTS/observes fulfillment; it is NOT the authority over inventory.
// Therefore this projection CONSUMES an availability determination — it does not compute inventory truth. The
// availability determination is produced by the canonical Inventory/Equipment authorities (a later trusted
// command supplies it via Admin-SDK reads); this module never trusts a client-supplied availability.
//
// Availability vocabulary mirrors the readiness model (KNOWN quantity / UNKNOWN / UNAVAILABLE) so the whole
// platform speaks one language: an unknown source ⇒ UNKNOWN (never silently "0"); a known-zero from an
// available source ⇒ BACKORDERED; a source that reports the item unavailable ⇒ UNAVAILABLE.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOCATION_STATES = void 0;
exports.allocateLine = allocateLine;
exports.buildAllocationPlan = buildAllocationPlan;
exports.ALLOCATION_STATES = ["ALLOCATED", "PARTIAL", "BACKORDERED", "UNAVAILABLE", "UNKNOWN"];
const int0 = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
// Allocate one line against its availability determination. `requestedQty` is what still needs allocating
// (orderedQty minus what's already allocated). Never allocates more than requested or more than available.
function allocateLine(line, availability) {
    const requestedQty = Math.max(0, line.orderedQty - int0(line.allocatedQty));
    const base = { ref: line.ref, kind: line.kind, requestedQty };
    if (requestedQty === 0) {
        return { ...base, allocatableQty: 0, shortfallQty: 0, state: "ALLOCATED" };
    }
    if (!availability || availability.kind === "UNKNOWN") {
        return { ...base, allocatableQty: 0, shortfallQty: requestedQty, state: "UNKNOWN" };
    }
    if (availability.kind === "UNAVAILABLE") {
        return { ...base, allocatableQty: 0, shortfallQty: requestedQty, state: "UNAVAILABLE" };
    }
    const available = Math.max(0, availability.quantity);
    const allocatableQty = Math.min(requestedQty, available);
    const shortfallQty = requestedQty - allocatableQty;
    const state = allocatableQty === requestedQty ? "ALLOCATED" : allocatableQty > 0 ? "PARTIAL" : "BACKORDERED";
    return { ...base, allocatableQty, shortfallQty, state };
}
function buildAllocationPlan(lines, availabilityByRef) {
    const allocations = (Array.isArray(lines) ? lines : []).map((l) => allocateLine(l, availabilityByRef[l.ref] ?? { kind: "UNKNOWN" }));
    const counts = { ALLOCATED: 0, PARTIAL: 0, BACKORDERED: 0, UNAVAILABLE: 0, UNKNOWN: 0 };
    for (const a of allocations)
        counts[a.state] += 1;
    let readiness;
    if (allocations.length === 0)
        readiness = "UNKNOWN";
    else if (counts.UNAVAILABLE > 0 || counts.BACKORDERED > 0)
        readiness = "BLOCKED";
    else if (counts.UNKNOWN > 0)
        readiness = "UNKNOWN";
    else if (counts.PARTIAL > 0)
        readiness = "PARTIAL";
    else
        readiness = "READY";
    return { lines: allocations, readiness, counts };
}
//# sourceMappingURL=allocationProjection.js.map
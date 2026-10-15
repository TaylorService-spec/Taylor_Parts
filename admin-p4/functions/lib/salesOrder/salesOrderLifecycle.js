"use strict";
// Sales Order — PURE lifecycle authority (framework-independent; unit-tested). The committed commercial order
// that follows a WON Opportunity. No Firestore/firebase-functions imports.
//
// Cardinality invariant (the core one): a line is PRODUCT-LEVEL with a quantity — `C713 × 5` is ONE line with
// orderedQty 5, NOT five lines and NOT five serialized assets. Serialized `equipment` assets are assigned
// downstream at FULFILLMENT, never here. Each line tracks ordered/allocated/fulfilled so partial fulfillment
// is first-class: orderedQty >= allocatedQty >= fulfilledQty >= 0, and remainingQty = orderedQty - fulfilledQty.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_CHANNELS = exports.SALES_ORDER_LINE_KINDS = exports.SALES_ORDER_STATES = void 0;
exports.isSalesOrderState = isSalesOrderState;
exports.isSalesChannel = isSalesChannel;
exports.checkTransition = checkTransition;
exports.remainingQty = remainingQty;
exports.allLinesFulfilled = allLinesFulfilled;
exports.SALES_ORDER_STATES = ["CONFIRMED", "IN_FULFILLMENT", "FULFILLED", "CLOSED", "CANCELLED"];
exports.SALES_ORDER_LINE_KINDS = ["EQUIPMENT_MODEL", "PART", "SERVICE"];
// Commercial Coverage (#15) ratified minimum channels — STRATEGIC_ACCOUNTS added. Kept in sync with the
// Opportunity channel set (opportunityLifecycle.ts) and the client mirror; a later increment unifies these into
// one configurable ref-data source (see docs/assessments/commercial-coverage-territory-authority-model.md).
exports.SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"];
function isSalesOrderState(v) {
    return typeof v === "string" && exports.SALES_ORDER_STATES.includes(v);
}
function isSalesChannel(v) {
    return typeof v === "string" && exports.SALES_CHANNELS.includes(v);
}
// Minimal, defensible transition graph. A Sales Order is created CONFIRMED (commercial commitment from WON).
// Fulfillment progresses CONFIRMED → IN_FULFILLMENT → FULFILLED → CLOSED. CANCEL is allowed only before the
// order is FULFILLED (a fulfilled/closed order is not cancellable — that is a return/credit, a later domain).
const FORWARD = {
    CONFIRMED: "IN_FULFILLMENT",
    IN_FULFILLMENT: "FULFILLED",
    FULFILLED: "CLOSED",
    CLOSED: null,
    CANCELLED: null,
};
// Pure legality check. `allLinesFulfilled` gates the IN_FULFILLMENT → FULFILLED advance so an order cannot be
// marked FULFILLED while quantity remains (honest partial-fulfillment). Never throws.
function checkTransition(state, transition, ctx = {}) {
    if (!isSalesOrderState(state))
        return { ok: false, code: "INVALID" };
    if (state === "CLOSED" || state === "CANCELLED")
        return { ok: false, code: "TERMINAL" };
    if (transition === "CANCEL") {
        if (state === "FULFILLED")
            return { ok: false, code: "ILLEGAL_TRANSITION" }; // return/credit, not cancel
        return { ok: true, to: "CANCELLED" };
    }
    // ADVANCE
    const to = FORWARD[state];
    if (to === null)
        return { ok: false, code: "ILLEGAL_TRANSITION" };
    if (state === "IN_FULFILLMENT" && ctx.allLinesFulfilled !== true)
        return { ok: false, code: "NOT_FULFILLABLE" };
    return { ok: true, to };
}
// The remaining (un-fulfilled) quantity for a line. Pure helper reused by the command + projections.
function remainingQty(line) {
    const fulfilled = typeof line.fulfilledQty === "number" && Number.isFinite(line.fulfilledQty) ? line.fulfilledQty : 0;
    return Math.max(0, line.orderedQty - fulfilled);
}
// True when every line is fully fulfilled (fulfilledQty == orderedQty) — the gate for FULFILLED.
function allLinesFulfilled(lines) {
    return lines.length > 0 && lines.every((l) => remainingQty(l) === 0);
}
//# sourceMappingURL=salesOrderLifecycle.js.map
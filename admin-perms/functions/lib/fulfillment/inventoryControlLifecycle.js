"use strict";
// Fulfillment — PURE two-condition INVENTORY-CONTROL projection (trusted-read mirror of the
// client authority field-ops-app-vite/src/domain/inventoryControlLifecycle.js). Encodes the
// single Owner-confirmed rule (business-processes/ventana-ice-machine-commercial-inventory-
// lifecycle.md): Taylor inventory control BEGINS at receipt into Taylor control and ENDS only
// when BOTH (1) installation is complete AND (2) the associated sale closes. Allocation,
// delivery, and invoicing end none of it.
//
// PURE: no Firestore/firebase-functions import. A trusted read (Admin-SDK) derives the three
// boolean signals from their own authorities and supplies them here; this module never trusts
// a client-supplied conclusion. The decision table is identical to the client mirror; parity is
// asserted by test/inventoryControlLifecycle.test.mjs against the same canonical case table.
//
// AUTHORITY SEPARATION: inventory control is ONE axis; ownership/title is separate and is NEVER
// inferred from it (resolveOwnershipTitle), and availability is never inferred from presence
// (isPresentableAsAvailable).
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISPOSITION = exports.OWNERSHIP = exports.EXIT_CONDITIONS = exports.INVENTORY_CONTROL_STATES = void 0;
exports.computeInventoryControl = computeInventoryControl;
exports.resolveOwnershipTitle = resolveOwnershipTitle;
exports.resolveVentanaChainTitle = resolveVentanaChainTitle;
exports.resolveCancelOrDamageDisposition = resolveCancelOrDamageDisposition;
exports.isPresentableAsAvailable = isPresentableAsAvailable;
exports.rollupOrderInventoryControl = rollupOrderInventoryControl;
exports.INVENTORY_CONTROL_STATES = ["UNKNOWN", "NOT_STARTED", "CONTROLLED", "EXITED"];
exports.EXIT_CONDITIONS = {
    INSTALLATION_INCOMPLETE: "INSTALLATION_INCOMPLETE",
    SALE_OPEN: "SALE_OPEN",
};
// true / false / unknown. Any non-boolean (null, undefined, number, ...) is unknown — an absent
// signal is NEVER silently treated as false.
const tri = (v) => (v === true ? true : v === false ? false : null);
// The projection. `context` (allocated/delivered/invoiced) is display-only and PROVABLY cannot
// end control — it is echoed, never consulted for the exit decision.
function computeInventoryControl(input) {
    const began = tri(input?.controlBegan);
    const installed = tri(input?.installationComplete);
    const closed = tri(input?.saleClosed);
    const context = Object.freeze({
        allocated: tri(input?.context?.allocated),
        delivered: tri(input?.context?.delivered),
        invoiced: tri(input?.context?.invoiced),
    });
    const base = { began, installationComplete: installed, saleClosed: closed, context };
    // Freeze results (and unmetConditions) so immutability matches the client mirror byte-for-decision.
    const done = (state, unmet) => Object.freeze({ state, unmetConditions: Object.freeze(unmet), ...base });
    if (began === null)
        return done("UNKNOWN", []);
    if (began === false)
        return done("NOT_STARTED", []);
    if (installed === null || closed === null)
        return done("UNKNOWN", []);
    const unmet = [];
    if (installed !== true)
        unmet.push(exports.EXIT_CONDITIONS.INSTALLATION_INCOMPLETE);
    if (closed !== true)
        unmet.push(exports.EXIT_CONDITIONS.SALE_OPEN);
    if (unmet.length === 0)
        return done("EXITED", []);
    return done("CONTROLLED", unmet);
}
// OWNERSHIP GUARD (INV-4): title is a separate axis, NEVER derived from inventory-control state.
exports.OWNERSHIP = { VENTANA: "VENTANA", TAYLOR: "TAYLOR", CUSTOMER: "CUSTOMER", UNKNOWN: "UNKNOWN" };
function resolveOwnershipTitle(input = {}) {
    const h = input.explicitTitleHolder;
    if (h === exports.OWNERSHIP.VENTANA || h === exports.OWNERSHIP.TAYLOR || h === exports.OWNERSHIP.CUSTOMER)
        return h;
    return exports.OWNERSHIP.UNKNOWN;
}
// Ventana-chain TITLE (Owner rulings D-1 / D-2): Ventana until purchase, Taylor after purchase (D-1),
// customer after successful delivery/acceptance (D-2 — never installation-complete or sale-close).
// Its own axis; never reads inventory-control state. Fail-closed to UNKNOWN.
function resolveVentanaChainTitle(input = {}) {
    if (input.deliveredAndAccepted === true)
        return exports.OWNERSHIP.CUSTOMER;
    if (input.purchasedFromVentana === true)
        return exports.OWNERSHIP.TAYLOR;
    if (input.purchasedFromVentana === false)
        return exports.OWNERSHIP.VENTANA;
    return exports.OWNERSHIP.UNKNOWN;
}
// Disposition on cancellation/damage (Owner ruling D-7): NEVER auto-return to available inventory;
// require an explicit disposition + reason/audit. Fail-closed default = HOLD / disposition-required.
exports.DISPOSITION = { DISPOSITION_REQUIRED: "DISPOSITION_REQUIRED", NONE: "NONE" };
function resolveCancelOrDamageDisposition(input = {}) {
    if (input.saleCancelled === true || input.damaged === true) {
        return Object.freeze({ disposition: exports.DISPOSITION.DISPOSITION_REQUIRED, autoReturnToAvailable: false, reasonRequired: true });
    }
    return Object.freeze({ disposition: exports.DISPOSITION.NONE, autoReturnToAvailable: false, reasonRequired: false });
}
// AVAILABILITY GUARD (INV-2): present-and-committed is UNAVAILABLE. Fail-closed to false.
function isPresentableAsAvailable(input = {}) {
    return input.availableForAssignment === true && input.committedToSalesOrder !== true;
}
// Order-level rollup (C713 × 5). NOT_STARTED units (drop-ship that never entered Taylor custody)
// are OUTSIDE the exit denominator — never counted as controlled, never able to strand the order.
// The order EXITS when every unit that entered Taylor control has EXITED; if none ever entered
// control it is NOT_STARTED; one still-controlled unit keeps it CONTROLLED; any unknown unit fails
// the order closed to UNKNOWN.
function rollupOrderInventoryControl(unitResults) {
    const units = Array.isArray(unitResults) ? unitResults.filter((u) => u && typeof u === "object") : [];
    const total = units.length;
    const counts = { UNKNOWN: 0, NOT_STARTED: 0, CONTROLLED: 0, EXITED: 0 };
    for (const u of units)
        counts[u.state] = (counts[u.state] || 0) + 1;
    const underControl = total - counts.NOT_STARTED;
    let state;
    if (total === 0)
        state = "UNKNOWN";
    else if (counts.UNKNOWN > 0)
        state = "UNKNOWN";
    else if (underControl === 0)
        state = "NOT_STARTED";
    else if (counts.EXITED === underControl)
        state = "EXITED";
    else
        state = "CONTROLLED";
    return Object.freeze({
        state,
        total,
        underControl,
        exitedUnits: counts.EXITED,
        controlledUnits: counts.CONTROLLED,
        notStartedUnits: counts.NOT_STARTED,
        counts: Object.freeze(counts),
    });
}
//# sourceMappingURL=inventoryControlLifecycle.js.map
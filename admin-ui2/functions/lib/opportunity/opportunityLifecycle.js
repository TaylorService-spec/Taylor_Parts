"use strict";
// Sales Opportunity — PURE lifecycle authority (framework-independent; unit-tested). This is the WRITE-side
// authority for the ratified Opportunity lifecycle; the field-ops domain/opportunityLifecycle.js mirrors the
// SAME stage vocabulary for read/UI affordance, but this module is where legal transitions are decided for a
// governed write. No Firestore, no firebase-functions imports here.
//
// Ratified single lifecycle (both channels): IDENTIFIED -> QUALIFYING -> SOLUTION -> QUOTING ->
// CUSTOMER_REVIEW -> DECISION -> (WON | LOST). Opportunity is PRE-COMMITMENT: nothing here creates inventory
// movement, warehouse demand, Work Orders, or invoices. Solution lines reference PRODUCT/MODEL/PART, never a
// serialized Equipment asset (serialized allocation happens downstream of WON -> Sales Order -> fulfillment).
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPPORTUNITY_LINE_KINDS = exports.SALES_CHANNELS = exports.OPPORTUNITY_OUTCOMES = exports.OPPORTUNITY_STAGES = void 0;
exports.isStage = isStage;
exports.isOutcome = isOutcome;
exports.isChannel = isChannel;
exports.nextStage = nextStage;
exports.checkTransition = checkTransition;
exports.OPPORTUNITY_STAGES = [
    "IDENTIFIED",
    "QUALIFYING",
    "SOLUTION",
    "QUOTING",
    "CUSTOMER_REVIEW",
    "DECISION",
];
exports.OPPORTUNITY_OUTCOMES = ["WON", "LOST"];
// Commercial Coverage (#15) ratified minimum channels — STRATEGIC_ACCOUNTS added. Kept in sync with the Sales
// Order channel set (salesOrderLifecycle.ts) and the client mirror; a later increment unifies these into one
// configurable ref-data source (see docs/assessments/commercial-coverage-territory-authority-model.md).
exports.SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"];
// Solution line kinds — product-level commercial intent ONLY. A serialized Equipment asset is deliberately
// NOT a valid line kind (that identity is assigned during fulfillment, not while selling).
exports.OPPORTUNITY_LINE_KINDS = ["EQUIPMENT_MODEL", "PART", "SERVICE"];
function isStage(v) {
    return typeof v === "string" && exports.OPPORTUNITY_STAGES.includes(v);
}
function isOutcome(v) {
    return typeof v === "string" && exports.OPPORTUNITY_OUTCOMES.includes(v);
}
function isChannel(v) {
    return typeof v === "string" && exports.SALES_CHANNELS.includes(v);
}
// The MINIMAL, defensible transition graph (kept intentionally small — reopening/reversing a closed
// opportunity, or skipping stages, are lifecycle-CHANGE decisions that require a new Owner decision, so they
// are NOT permitted here):
//   - advance forward by EXACTLY one stage (IDENTIFIED->QUALIFYING->...->DECISION);
//   - LOST may be set from ANY open stage (a deal can be lost at any point);
//   - WON may be set ONLY from DECISION (a commitment follows a decision);
//   - a closed opportunity (WON|LOST) accepts NO further transition.
function nextStage(stage) {
    const i = exports.OPPORTUNITY_STAGES.indexOf(stage);
    return i >= 0 && i < exports.OPPORTUNITY_STAGES.length - 1 ? exports.OPPORTUNITY_STAGES[i + 1] : null;
}
// Pure legality check for a single transition. Returns a discriminated result; the command/callable maps the
// code to an error. Never throws.
function checkTransition(state, intent) {
    if (!isStage(state.stage))
        return { ok: false, code: "INVALID" };
    if (state.outcome === "WON" || state.outcome === "LOST")
        return { ok: false, code: "ALREADY_CLOSED" };
    if (intent.kind === "ADVANCE") {
        if (!isStage(intent.toStage))
            return { ok: false, code: "INVALID" };
        const expected = nextStage(state.stage);
        if (expected === null || intent.toStage !== expected)
            return { ok: false, code: "ILLEGAL_TRANSITION" };
        return { ok: true };
    }
    if (intent.kind === "OUTCOME") {
        if (!isOutcome(intent.outcome))
            return { ok: false, code: "INVALID" };
        if (intent.outcome === "LOST")
            return { ok: true }; // lost from any open stage
        // WON requires being at DECISION
        if (state.stage !== "DECISION")
            return { ok: false, code: "OUTCOME_REQUIRES_DECISION" };
        return { ok: true };
    }
    return { ok: false, code: "INVALID" };
}
//# sourceMappingURL=opportunityLifecycle.js.map
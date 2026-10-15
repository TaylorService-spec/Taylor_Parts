"use strict";
// THE COMMERCIAL COMMITMENT — states, kinds, and the money vocabulary.
//
// GOVERNANCE: docs/assessments/core-transaction-actionability-audit.md gap 2; Owner Decision 2.
//
// ════════════════════ WHY THIS OBJECT EXISTS ════════════════════
//
// Nothing owned commercial commitment. Opportunity carries `expectedValue` — one forecast number on
// the header — and its lines are `{ kind, ref, qty }` with no price at all. So the WON -> Sales Order
// path produced orders with no committed pricing, which is where the seven unpriced CONFIRMED
// records in sandbox came from, and it is why a Sales Order could be confirmed and then refused by
// invoicing.
//
// The Taylor signed Sales & Security Agreement is that missing authority written on paper: buyer,
// site, PO, lease, ship-via, deliver/install, line pricing, warranty, trade-in, down payment,
// balance, and a signature.
//
// ════════════════════ WHERE IT ATTACHES — DERIVED, NOT INVENTED ════════════════════
//
// The Opportunity ladder already has the right rungs:
//
//     IDENTIFIED -> QUALIFYING -> SOLUTION -> QUOTING -> CUSTOMER_REVIEW -> DECISION -> WON | LOST
//
// QUOTING is where an Agreement is drafted. CUSTOMER_REVIEW is where it sits with the customer.
// DECISION/WON is where acceptance has happened. No new Opportunity stage is added, because the
// stages that describe this already exist.
//
// ════════════════════ THREE STATES, AND NO MORE ════════════════════
//
// DRAFT      being built; pricing may be incomplete, because it is still being decided
// ACCEPTED   the customer committed. Pricing is COMPLETE by invariant — this is the gate
// DECLINED   they did not
//
// There is deliberately no PRESENTED/SENT/EXPIRED. Those describe a sales activity, not a change in
// what the business is committed to, and a state that changes no invariant is a state that only has
// to be maintained.
//
// ════════════════════ THE BOUNDARY WITH SALES ORDER ════════════════════
//
// Agreement owns COMMITMENT. Sales Order owns OPERATIONAL FULFILLMENT. The Sales Order does not
// become the negotiation object, and the Agreement does not grow allocation or shipment state.
// An accepted Agreement is what a priced Sales Order is created FROM.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGREEMENT_LINE_CONDITIONS = exports.FULFILLMENT_INTENTS = exports.SALES_AGREEMENT_LINE_KINDS = exports.SALES_AGREEMENT_STATES = void 0;
exports.isAgreementState = isAgreementState;
exports.checkAgreementTransition = checkAgreementTransition;
exports.SALES_AGREEMENT_STATES = ["DRAFT", "ACCEPTED", "DECLINED"];
/** Product-level commercial intent, matching the Opportunity and Sales Order line vocabularies. */
exports.SALES_AGREEMENT_LINE_KINDS = ["EQUIPMENT_MODEL", "PART", "SERVICE"];
/**
 * What the customer is buying the delivery of.
 *
 * From the Agreement's own "deliver / install / both" box. It is a COMMERCIAL commitment, not a
 * dispatch instruction: it says what was sold, and the install Work Order is what carries it out.
 */
exports.FULFILLMENT_INTENTS = ["DELIVER", "INSTALL", "BOTH"];
/**
 * Line condition, as the paper form carries it.
 *
 * ARTIFACT_DETAIL_PENDING: the permitted values are not stated in the accepted evidence. NEW and
 * USED are the two the artifact demonstrably distinguishes; anything else stays unmodelled rather
 * than guessed, and a line may carry none.
 */
exports.AGREEMENT_LINE_CONDITIONS = ["NEW", "USED"];
function isAgreementState(v) {
    return typeof v === "string" && exports.SALES_AGREEMENT_STATES.includes(v);
}
/**
 * Which transitions are legal.
 *
 * ACCEPTED and DECLINED are TERMINAL. A customer who accepted and then changed their mind has not
 * un-accepted a commitment — they have a new commercial conversation, which is a new Agreement.
 * Allowing an accepted Agreement back to DRAFT would let the committed prices a Sales Order was
 * created from change underneath it.
 */
function checkAgreementTransition(from, to) {
    if (from === "ACCEPTED" || from === "DECLINED") {
        return { ok: false, reason: `A ${from} agreement is terminal and cannot move to ${to}.` };
    }
    if (to === "DRAFT")
        return { ok: false, reason: "An agreement cannot return to DRAFT." };
    return { ok: true };
}
//# sourceMappingURL=salesAgreementLifecycle.js.map
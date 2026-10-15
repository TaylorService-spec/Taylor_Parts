"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAgreementConvertible = assertAgreementConvertible;
exports.salesOrderLinesFromAgreement = salesOrderLinesFromAgreement;
exports.salesOrderFieldsFromAgreement = salesOrderFieldsFromAgreement;
const https_1 = require("firebase-functions/v2/https");
const salesAgreementCommands_js_1 = require("./salesAgreementCommands.js");
/**
 * Every precondition, in the order that produces the most useful refusal.
 *
 * EXISTENCE, then OWNERSHIP, then STATE. A caller pointed at the wrong agreement should be told
 * that, not told it is unaccepted — the second sends them to chase a signature on a document that
 * was never theirs.
 */
function assertAgreementConvertible(agreement, opportunity) {
    if (!agreement.exists) {
        throw new https_1.HttpsError("failed-precondition", "This opportunity has no sales agreement. A Sales Order is created from an accepted agreement, " +
            "which is where committed prices are recorded — an opportunity carries a forecast, not prices.");
    }
    if (agreement.sourceOpportunityId !== opportunity.id) {
        throw new https_1.HttpsError("failed-precondition", "That sales agreement belongs to a different opportunity.");
    }
    // ACCOUNT IS STRICT, and is checked against the OPPORTUNITY's account rather than the caller's
    // claim — the same reason the Work Order equipment check reads the stored record.
    if (agreement.accountId !== opportunity.accountId) {
        throw new https_1.HttpsError("failed-precondition", "The sales agreement belongs to a different customer than the opportunity.");
    }
    if (agreement.state !== "ACCEPTED") {
        throw new https_1.HttpsError("failed-precondition", `The sales agreement is ${agreement.state ?? "in an unknown state"} and has not been accepted. ` +
            "Only accepted commercial terms can produce a Sales Order.");
    }
    if (!Array.isArray(agreement.lines) || agreement.lines.length === 0) {
        throw new https_1.HttpsError("failed-precondition", "The sales agreement has no lines.");
    }
}
/**
 * The Sales Order line inputs an accepted Agreement produces.
 *
 * Delegates to the Agreement's own derivation so there is ONE place that turns committed prices
 * into order lines — a second mapping is how a price comes to be re-decided in transit.
 */
function salesOrderLinesFromAgreement(agreement) {
    try {
        return (0, salesAgreementCommands_js_1.deriveSalesOrderLinesFromAgreement)({
            state: agreement.state,
            lines: agreement.lines ?? [],
        });
    }
    catch (err) {
        if (err instanceof salesAgreementCommands_js_1.SalesAgreementCommandError) {
            throw new https_1.HttpsError("failed-precondition", err.message);
        }
        throw err;
    }
}
/**
 * WHICH AGREEMENT FACTS TRAVEL TO THE SALES ORDER, AND WHICH DO NOT.
 *
 * The rule is operational need, not completeness. A Sales Order that copied every agreement field
 * would become a second commercial record, and the two would drift the moment either was amended.
 *
 * COPIED — operational fulfillment genuinely needs a stable value:
 *
 *   accountId          who the order is for
 *   locationId         where it goes; fulfillment cannot ask the Agreement at pick time
 *   customerPO         appears on the pick ticket and the invoice
 *   line ref/qty/price the order IS these
 *
 * NOT COPIED — reachable through `sourceAgreementId`, and commercial rather than operational:
 *
 *   isLease              a financing arrangement; changes nothing a warehouse does
 *   shippingInstructions ) genuinely operational, and deliberately NOT snapshotted YET: there is no
 *   shipVia              ) shipment object to carry them (audit gap 5 — fulfillment has no pick or
 *   fulfillmentIntent    ) shipment authority). Copying them onto the order now would put warehouse
 *                        ) instructions on a document that cannot act on them, and would have to be
 *                        ) moved again when Slice 5 lands. Reachable via the Agreement meanwhile.
 *   warranty             a commitment to the customer, settled at sale, read from the Agreement
 *   estimatedArrival     what the customer was told; the order's own dates come from fulfillment
 *   condition            a commercial descriptor of what was sold
 *   totals               the Agreement's arithmetic. The order's money is its lines; a copied total
 *                        would be a second answer to the same question.
 *
 * `specialInstructions` maps to the order's `notes` because that field already exists and is what a
 * person reads before acting on the order — the one commercial note with an operational consumer.
 */
function salesOrderFieldsFromAgreement(agreement) {
    return {
        locationId: agreement.locationId ?? undefined,
        customerPO: agreement.customerPO ?? undefined,
        notes: agreement.specialInstructions ?? undefined,
    };
}
//# sourceMappingURL=agreementToSalesOrder.js.map
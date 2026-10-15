"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS = exports.SalesAgreementCommandError = void 0;
exports.computeAgreementTotals = computeAgreementTotals;
exports.buildCreateSalesAgreement = buildCreateSalesAgreement;
exports.buildAcceptSalesAgreement = buildAcceptSalesAgreement;
exports.deriveSalesOrderLinesFromAgreement = deriveSalesOrderLinesFromAgreement;
exports.buildUpdateSalesAgreementDraft = buildUpdateSalesAgreementDraft;
const salesAgreementLifecycle_js_1 = require("./salesAgreementLifecycle.js");
const commercialCompanyScope_1 = require("../ownership/commercialCompanyScope");
const financialAttribution_1 = require("../finance/financialAttribution");
class SalesAgreementCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SalesAgreementCommandError";
    }
}
exports.SalesAgreementCommandError = SalesAgreementCommandError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
const posInt = (v) => finiteNum(v) && v > 0 && Number.isInteger(v);
/** Integer minor units, non-negative. Zero is a real amount; negative is not one of these. */
const minorUnits = (v) => finiteNum(v) && Number.isInteger(v) && v >= 0;
const trimmed = (v) => (nonEmpty(v) ? v.trim() : null);
function validateLine(line, index) {
    if (!line || typeof line !== "object") {
        throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} is not an object`);
    }
    const l = line;
    if (!salesAgreementLifecycle_js_1.SALES_AGREEMENT_LINE_KINDS.includes(l.kind)) {
        throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
    }
    // The same identity boundary the Sales Order holds: commitment is product-level. A serial is
    // assigned from physical inventory at fulfillment, and selling "this exact machine" before one has
    // been picked is a promise the warehouse never made.
    if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
        throw new SalesAgreementCommandError("SERIALIZED_LINE_FORBIDDEN", `Line ${index} references a serialized asset; agreement lines are product-level (serials are assigned at fulfillment)`);
    }
    if (!nonEmpty(l.ref))
        throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
    if (!posInt(l.quantity))
        throw new SalesAgreementCommandError("QTY_INVALID", `Line ${index} quantity must be a positive integer`);
    if (l.unitPrice !== undefined && l.unitPrice !== null && !minorUnits(l.unitPrice)) {
        throw new SalesAgreementCommandError("MONEY_INVALID", `Line ${index} unitPrice must be a non-negative integer in minor units`);
    }
    if (l.condition !== undefined && l.condition !== null && !salesAgreementLifecycle_js_1.AGREEMENT_LINE_CONDITIONS.includes(l.condition)) {
        throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} condition is not a recognised value`);
    }
    if (l.estimatedArrivalMillis !== undefined && l.estimatedArrivalMillis !== null && !finiteNum(l.estimatedArrivalMillis)) {
        throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} estimatedArrivalMillis must be a number`);
    }
    // FIN-002: attribute the line to its reporting unit at creation. deriveLineBusinessUnit refuses
    // an ambiguous SERVICE line (BUSINESS_UNIT_REQUIRED) and a contradictory explicit value — an
    // ordinary new reportable line can no longer enter the system with silent BU ambiguity.
    let businessUnitId;
    try {
        businessUnitId = (0, financialAttribution_1.deriveLineBusinessUnit)(l.kind, l.businessUnitId);
    }
    catch (err) {
        if (err instanceof financialAttribution_1.AttributionError) {
            throw new SalesAgreementCommandError("BUSINESS_UNIT_INVALID", `Line ${index}: ${err.message}`);
        }
        throw err;
    }
    const unitPrice = minorUnits(l.unitPrice) ? l.unitPrice : null;
    return {
        lineId: `line-${index + 1}`,
        kind: l.kind,
        ref: l.ref.trim(),
        businessUnitId,
        quantity: l.quantity,
        unitPrice,
        condition: trimmed(l.condition),
        warranty: trimmed(l.warranty),
        estimatedArrivalMillis: finiteNum(l.estimatedArrivalMillis) ? l.estimatedArrivalMillis : null,
        // Null, never 0, while unpriced: an unpriced line has no extension, and zero would say it is free.
        extendedMinor: unitPrice === null ? null : l.quantity * unitPrice,
    };
}
/**
 * The document's own arithmetic.
 *
 * NULL PROPAGATES. If any line is unpriced there is no subtotal, therefore no total, therefore no
 * balance — a partial sum presented as a total is a real number that is not what the customer is
 * committing to, and it is worse than nothing because somebody would sign it.
 */
function computeAgreementTotals(lines, charges) {
    for (const [field, v] of Object.entries(charges)) {
        if (v !== undefined && v !== null && !minorUnits(v)) {
            throw new SalesAgreementCommandError("MONEY_INVALID", `${field} must be a non-negative integer in minor units`);
        }
    }
    const shippingMinor = minorUnits(charges.shippingMinor) ? charges.shippingMinor : 0;
    const installChargeMinor = minorUnits(charges.installChargeMinor) ? charges.installChargeMinor : 0;
    const taxMinor = minorUnits(charges.taxMinor) ? charges.taxMinor : 0;
    const downPaymentMinor = minorUnits(charges.downPaymentMinor) ? charges.downPaymentMinor : 0;
    const tradeInMinor = minorUnits(charges.tradeInMinor) ? charges.tradeInMinor : 0;
    const fullyPriced = lines.length > 0 && lines.every((l) => l.extendedMinor !== null);
    const subtotalMinor = fullyPriced ? lines.reduce((n, l) => n + l.extendedMinor, 0) : null;
    const totalMinor = subtotalMinor === null ? null : subtotalMinor + shippingMinor + installChargeMinor + taxMinor;
    const balanceMinor = totalMinor === null ? null : totalMinor - downPaymentMinor - tradeInMinor;
    return { subtotalMinor, shippingMinor, installChargeMinor, taxMinor, totalMinor, downPaymentMinor, tradeInMinor, balanceMinor };
}
/** Build a DRAFT. Pricing MAY be incomplete here — it is still being decided. */
function buildCreateSalesAgreement(input, ctx) {
    if (!nonEmpty(input?.accountId))
        throw new SalesAgreementCommandError("ACCOUNT_REQUIRED", "accountId is required");
    if (!nonEmpty(input?.ownerEmployeeId))
        throw new SalesAgreementCommandError("OWNER_REQUIRED", "ownerEmployeeId is required");
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
        throw new SalesAgreementCommandError("NO_LINES", "An agreement requires at least one line");
    }
    if (input.fulfillmentIntent !== undefined && !salesAgreementLifecycle_js_1.FULFILLMENT_INTENTS.includes(input.fulfillmentIntent)) {
        throw new SalesAgreementCommandError("INTENT_INVALID", "fulfillmentIntent must be DELIVER, INSTALL or BOTH");
    }
    const lines = input.lines.map((l, i) => validateLine(l, i));
    // Only the CHARGE fields. Handing the whole input in made every string on it -- accountId
    // included -- run through the money validator.
    const totals = computeAgreementTotals(lines, {
        shippingMinor: input.shippingMinor,
        installChargeMinor: input.installChargeMinor,
        taxMinor: input.taxMinor,
        downPaymentMinor: input.downPaymentMinor,
        tradeInMinor: input.tradeInMinor,
    });
    return {
        accountId: input.accountId.trim(),
        ownerEmployeeId: input.ownerEmployeeId.trim(),
        // R-14: explicit-or-inherited, never inferred, no production default. The callable supplies
        // the inherited value from the source Opportunity it read inside its own transaction.
        operatingCompanyId: (0, commercialCompanyScope_1.resolveCommercialCompanyScope)(input.operatingCompanyId, input.inheritedOperatingCompanyId),
        // Credit chain: explicit → inherited from the Opportunity → this agreement's commercial owner.
        // ctx.actorUid deliberately absent: the creator is an actor, never the default credit.
        creditedSalespersonId: (0, financialAttribution_1.resolveCreditedSalesperson)(input.creditedSalespersonId, input.inheritedCreditedSalespersonId, input.ownerEmployeeId),
        locationId: trimmed(input.locationId),
        sourceOpportunityId: trimmed(input.sourceOpportunityId),
        customerPO: trimmed(input.customerPO),
        isLease: input.isLease === true,
        fulfillmentIntent: input.fulfillmentIntent ?? null,
        shippingInstructions: trimmed(input.shippingInstructions),
        shipVia: trimmed(input.shipVia),
        specialInstructions: trimmed(input.specialInstructions),
        // Single-currency, server-set, matching the Sales Order header so a committed price survives
        // into billing without a conversion nobody authorised.
        currency: "USD",
        state: "DRAFT",
        lines,
        totals,
        createdByUid: ctx.actorUid,
        createdAtMillis: ctx.nowMillis,
        updatedAtMillis: ctx.nowMillis,
    };
}
/**
 * ACCEPTANCE IS THE PRICING GATE.
 *
 * A DRAFT may be incomplete — that is what a draft is. An ACCEPTED agreement is what the customer
 * committed to and what a Sales Order will be created from, so every billable line must carry a
 * committed price by the time it gets there. Every line kind is billable, exactly as on the Sales
 * Order: `billingEligibleQty` discriminates by quantity and never by kind.
 *
 * This is the same invariant the Sales Order enforces, moved to the place where the commercial
 * decision is actually made. Enforcing it only at the order would put the refusal in front of
 * somebody who cannot fix it.
 */
function buildAcceptSalesAgreement(current, ctx) {
    const check = (0, salesAgreementLifecycle_js_1.checkAgreementTransition)(current.state, "ACCEPTED");
    if (!check.ok)
        throw new SalesAgreementCommandError("ILLEGAL_TRANSITION", check.reason ?? "Illegal transition");
    // ACCEPTANCE IS ALSO THE COMPANY GATE (company-authority correction, DECISIONS #154 addendum).
    // An accepted agreement is a REPORTABLE commercial commitment, and no reportable financial fact
    // exists without its operating company. A DRAFT may negotiate company-unresolved (R-14 posture);
    // committing that way is refused HERE, atomically, before anything is stamped — no inference,
    // no Taylor default, no current-user fallback. Fix it upstream (Opportunity/explicit) and accept
    // again.
    if (typeof current.operatingCompanyId !== "string" || current.operatingCompanyId.trim().length === 0) {
        throw new SalesAgreementCommandError("COMPANY_REQUIRED", "This agreement has no resolved operating company. An accepted agreement is a reportable " +
            "commercial commitment and must carry a governed operatingCompanyId (explicit or inherited " +
            "from its Opportunity) — it is never inferred or defaulted.");
    }
    const unpriced = (current.lines ?? []).filter((l) => l.unitPrice === null || l.unitPrice === undefined);
    if (unpriced.length > 0) {
        // Names every one, not the first: pricing an agreement should not be a round trip per line.
        throw new SalesAgreementCommandError("UNPRICED_LINE", "An accepted agreement requires a committed unit price on every line. Unpriced: " +
            unpriced.map((l) => `${l.lineId} (${l.ref})`).join(", "));
    }
    return {
        state: "ACCEPTED",
        acceptedAtMillis: ctx.nowMillis,
        acceptedByUid: ctx.actorUid,
        updatedAtMillis: ctx.nowMillis,
    };
}
/**
 * The Sales Order lines an accepted Agreement produces.
 *
 * THIS IS THE REPLACEMENT FOR THE UNPRICED SHORTCUT. `deriveSalesOrderLines` mapped Opportunity
 * `{ kind, ref, qty }` straight through with no price, because an Opportunity has none — which is
 * how unpriced CONFIRMED orders came to exist. Prices come from the Agreement now, because that is
 * where they were committed.
 *
 * It refuses on a non-accepted agreement rather than reading a draft's provisional prices: a price
 * nobody accepted is not a commitment.
 */
function deriveSalesOrderLinesFromAgreement(agreement) {
    if (agreement.state !== "ACCEPTED") {
        throw new SalesAgreementCommandError("ILLEGAL_TRANSITION", "A Sales Order can only be created from an ACCEPTED agreement; a draft's prices are not a commitment.");
    }
    return (agreement.lines ?? []).map((l) => {
        if (l.unitPrice === null || l.unitPrice === undefined) {
            // Unreachable through acceptance, and asserted anyway: this function is what hands prices to
            // the Sales Order, and it must never be the place a null slips through.
            throw new SalesAgreementCommandError("UNPRICED_LINE", `Accepted agreement line ${l.lineId} has no committed price.`);
        }
        // FIN-002: the line's reporting attribution travels with its committed price — the order must
        // not re-classify (or lose) what the accepted agreement already decided. Older accepted
        // agreements written before businessUnitId existed carry none; the key is then OMITTED (not
        // set undefined) and the order's own validator re-derives — or refuses an ambiguous SERVICE
        // line — never silently defaults.
        return {
            kind: l.kind, ref: l.ref,
            ...(l.businessUnitId !== undefined && l.businessUnitId !== null ? { businessUnitId: l.businessUnitId } : {}),
            orderedQty: l.quantity, unitPrice: l.unitPrice,
        };
    });
}
// ════════════════════ BOUNDED DRAFT EDITING ════════════════════
//
// GOVERNANCE: Owner Slice 4 §H, authorized explicitly — "without bounded Draft editing the
// create → accept workflow is not operationally usable."
//
// A draft is a negotiation: prices move, lines are added and dropped, the PO number arrives after
// the terms do. Without an edit path the only way to correct a typo would be to abandon the
// agreement and create another, and the counter would carry the scars.
//
// THIS IS NOT A PATCH ENDPOINT. It takes an explicit ALLOWLIST of commercial fields and nothing
// else. A generic update would let a caller move accountId, sourceOpportunityId, currency, state,
// acceptedByUid, createdAtMillis or the totals — every one of which is either identity or a
// server-derived fact, and all of which the create and accept commands exist to own.
//
// WHAT CANNOT MOVE, AND WHY:
//
//   accountId, sourceOpportunityId  IDENTITY. An agreement that could change customer or
//                                   opportunity is a different agreement wearing the same number.
//                                   Repointing it would silently rewrite lineage a Sales Order may
//                                   already depend on.
//   salesAgreementNumber            immutable by construction (salesAgreementNumbering.ts).
//   currency                        server-set, single-currency; a conversion nobody authorised.
//   state, acceptedAtMillis,        the ACCEPT command's to write, from server context. A client
//   acceptedByUid                   that could set them could accept its own unpriced agreement.
//   totals                          COMPUTED here from the lines and charges, never accepted from
//                                   a caller. A supplied total is a second answer to a question
//                                   the lines already answer.
//   salesOrderId                    written by the conversion, in the same commit as the order.
//
// ONLY WHILE DRAFT. ACCEPTED and DECLINED are terminal (salesAgreementLifecycle.ts): an accepted
// commitment whose prices could still move is not a commitment, and a Sales Order created from it
// would be quoting a number that changed after the customer signed. Amendment of an accepted
// agreement is deliberately NOT in this slice — it is a new commercial conversation, and modelling
// it means versioning, which is its own decision.
/** Exactly the fields a draft may change. Anything not named here cannot be reached. */
exports.SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS = Object.freeze([
    "locationId",
    // FIN-002: explicit pre-commitment credit reassignment. A DRAFT is still a negotiation, and the
    // Owner policy allows explicit sales reassignment BEFORE the immutable boundary. At ACCEPTED the
    // whole document freezes (state !== DRAFT refusal below), so accepted credit is history — a later
    // change is a FIN-007 attribution adjustment. operatingCompanyId is deliberately NOT here: the
    // company entered the chain at the Opportunity (R-14) and an agreement that could switch company
    // mid-negotiation would be a different deal wearing the same number.
    "creditedSalespersonId",
    "customerPO",
    "isLease",
    "fulfillmentIntent",
    "shippingInstructions",
    "shipVia",
    "specialInstructions",
    "lines",
    "shippingMinor",
    "installChargeMinor",
    "taxMinor",
    "downPaymentMinor",
    "tradeInMinor",
]);
/**
 * The patch a bounded draft edit produces.
 *
 * Returns a PATCH, not a whole document: a command that rebuilt the agreement would have to
 * restate the identity fields it must not touch, and restating them is how they come to move.
 */
function buildUpdateSalesAgreementDraft(current, input, ctx) {
    if (current?.state !== "DRAFT") {
        throw new SalesAgreementCommandError("ILLEGAL_TRANSITION", `A ${current?.state ?? "missing-state"} agreement cannot be edited. Only a DRAFT is still being negotiated.`);
    }
    // REJECT, never ignore. Silently dropping an unknown key lets a caller believe they changed
    // something they did not — and a UI built against that belief ships a control that does nothing.
    const allowed = new Set(exports.SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS);
    const unknown = Object.keys(input ?? {}).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
        throw new SalesAgreementCommandError("FIELD_NOT_EDITABLE", `These fields cannot be changed on a Sales Agreement: ${unknown.join(", ")}. ` +
            "Identity, currency, acceptance and totals are not caller-supplied.");
    }
    const patch = {};
    if ("locationId" in input)
        patch.locationId = trimmed(input.locationId);
    // Credit moves only by EXPLICIT reassignment, and never to nothing: a draft may re-credit a
    // different salesperson, but a commercial record with no credited salesperson at all is not a
    // state this chain produces.
    if ("creditedSalespersonId" in input) {
        if (!nonEmpty(input.creditedSalespersonId)) {
            throw new SalesAgreementCommandError("INVALID", "creditedSalespersonId cannot be cleared, only reassigned");
        }
        patch.creditedSalespersonId = input.creditedSalespersonId.trim();
    }
    if ("customerPO" in input)
        patch.customerPO = trimmed(input.customerPO);
    if ("shippingInstructions" in input)
        patch.shippingInstructions = trimmed(input.shippingInstructions);
    if ("shipVia" in input)
        patch.shipVia = trimmed(input.shipVia);
    if ("specialInstructions" in input)
        patch.specialInstructions = trimmed(input.specialInstructions);
    // Explicit boolean only: `isLease: "yes"` is a caller mistake, not a lease.
    if ("isLease" in input) {
        if (typeof input.isLease !== "boolean") {
            throw new SalesAgreementCommandError("INTENT_INVALID", "isLease must be true or false");
        }
        patch.isLease = input.isLease;
    }
    if ("fulfillmentIntent" in input) {
        const v = input.fulfillmentIntent;
        // Null is legitimate: not every agreement states delivery intent, and clearing it is an edit.
        if (v !== null && v !== undefined && !salesAgreementLifecycle_js_1.FULFILLMENT_INTENTS.includes(v)) {
            throw new SalesAgreementCommandError("INTENT_INVALID", "fulfillmentIntent must be DELIVER, INSTALL or BOTH");
        }
        patch.fulfillmentIntent = v ?? null;
    }
    // Lines run through the SAME validator the create command uses. A second, laxer line rule on the
    // edit path is how a serialized reference or a fractional price reaches a document that the
    // create path would have refused.
    const lines = "lines" in input ? (input.lines ?? []).map((l, i) => validateLine(l, i)) : current.lines;
    if ("lines" in input && lines.length === 0) {
        throw new SalesAgreementCommandError("NO_LINES", "An agreement requires at least one line");
    }
    if ("lines" in input)
        patch.lines = lines;
    // TOTALS ARE ALWAYS RECOMPUTED, even when only a charge moved — the balance depends on both, and
    // a patch that changed shipping without re-deriving the total would leave the document
    // internally inconsistent for as long as nobody looked.
    const charge = (k, inputKey) => inputKey in input ? input[inputKey] : current.totals?.[k];
    patch.totals = computeAgreementTotals(lines, {
        shippingMinor: charge("shippingMinor", "shippingMinor"),
        installChargeMinor: charge("installChargeMinor", "installChargeMinor"),
        taxMinor: charge("taxMinor", "taxMinor"),
        downPaymentMinor: charge("downPaymentMinor", "downPaymentMinor"),
        tradeInMinor: charge("tradeInMinor", "tradeInMinor"),
    });
    patch.updatedAtMillis = ctx.nowMillis;
    patch.updatedByUid = ctx.actorUid;
    return patch;
}
//# sourceMappingURL=salesAgreementCommands.js.map
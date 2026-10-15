"use strict";
// Sales Order — PURE governed write core (framework-independent; unit-tested). Builds the field maps the
// callable persists; enforces the ratified invariants. No Firestore/firebase-functions imports.
//
// INVARIANTS: product-level lines only (a serialized-asset reference is FORBIDDEN — assigned at fulfillment);
// quantity model orderedQty >= allocatedQty >= fulfilledQty >= 0; canonical refs reused (accountId,
// ownerEmployeeId, salesChannel, locationId?, sourceOpportunityId?); `unitPrice` is an OPTIONAL passive
// pricing SNAPSHOT — this command invents no pricing/discount/tax authority. Created CONFIRMED.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesOrderCommandError = void 0;
exports.buildCreateSalesOrder = buildCreateSalesOrder;
exports.buildTransitionPatch = buildTransitionPatch;
const creationOwnerResolution_1 = require("../ownership/creationOwnerResolution");
const commercialCompanyScope_1 = require("../ownership/commercialCompanyScope");
const accountablePersonStorage_1 = require("../responsibility/accountablePersonStorage");
const financialAttribution_1 = require("../finance/financialAttribution");
const salesOrderLifecycle_1 = require("./salesOrderLifecycle");
class SalesOrderCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SalesOrderCommandError";
    }
}
exports.SalesOrderCommandError = SalesOrderCommandError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
const posInt = (v) => finiteNum(v) && v > 0 && Number.isInteger(v);
/** Integer minor units, non-negative. Zero is a real committed price; negative is not a price. */
const minorUnits = (v) => finiteNum(v) && Number.isInteger(v) && v >= 0;
// Validate + normalize one line. The ONE identity mistake that corrupts commercial↔physical separation is a
// serialized-asset reference on a line — reject it. Quantities initialize allocated/fulfilled to 0.
function validateLine(line, index) {
    if (!line || typeof line !== "object")
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is not an object`);
    const l = line;
    if (!salesOrderLifecycle_1.SALES_ORDER_LINE_KINDS.includes(l.kind)) {
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
    }
    if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
        throw new SalesOrderCommandError("SERIALIZED_LINE_FORBIDDEN", `Line ${index} references a serialized asset; Sales Order lines are product-level (serialized assets are assigned at fulfillment)`);
    }
    if (!nonEmpty(l.ref))
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
    if (!posInt(l.orderedQty))
        throw new SalesOrderCommandError("QTY_INVALID", `Line ${index} orderedQty must be a positive integer`);
    // INTEGER MINOR UNITS, and non-negative. The invoice engine snapshots this exact value as
    // `unitPriceMinor` and refuses any invoice price that disagrees with it, so a float here is not a
    // rounding inconvenience -- it is a price no downstream consumer can honour. A fractional value
    // was previously accepted and then silently treated as ABSENT by the read projection, which
    // produced an order that looked priced and billed as unpriced.
    if (l.unitPrice !== undefined && !minorUnits(l.unitPrice)) {
        throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} unitPrice must be a non-negative integer in minor units`);
    }
    // FIN-002: line-level reporting attribution, derived-or-required exactly as on the Agreement —
    // one authority (deriveLineBusinessUnit), two call sites, no laxer path.
    let businessUnitId;
    try {
        businessUnitId = (0, financialAttribution_1.deriveLineBusinessUnit)(l.kind, l.businessUnitId);
    }
    catch (err) {
        if (err instanceof financialAttribution_1.AttributionError) {
            throw new SalesOrderCommandError("BUSINESS_UNIT_INVALID", `Line ${index}: ${err.message}`);
        }
        throw err;
    }
    const out = {
        lineId: `line-${index + 1}`,
        kind: l.kind,
        ref: l.ref.trim(),
        businessUnitId,
        orderedQty: l.orderedQty,
        allocatedQty: 0,
        fulfilledQty: 0,
        billedQty: 0,
    };
    if (l.unitPrice !== undefined)
        out.unitPrice = l.unitPrice;
    return out;
}
/**
 * A COMMERCIALLY CONFIRMED SALES ORDER CARRIES A PRICE ON EVERY BILLABLE LINE.
 *
 * ════════════════════ THE CONTRADICTION THIS CLOSES ════════════════════
 *
 * `unitPrice` was optional and creation goes straight to CONFIRMED, while invoiceCommands REFUSES
 * to bill a line that has none (UNPRICED). So the system let somebody commit to an order it would
 * later decline to invoice, and nothing said so until billing. Seven of fourteen sandbox orders are
 * in exactly that state.
 *
 * EVERY LINE IS BILLABLE. `billingEligibleQty` discriminates by QUANTITY -- min(ordered, fulfilled)
 * -- and never by kind, so EQUIPMENT_MODEL, PART and SERVICE are equally billable and there is no
 * subset to exempt.
 *
 * ════════════════════ WHAT THIS IS NOT ════════════════════
 *
 * NOT a pricing engine. It computes nothing, looks nothing up, and defaults nothing. It requires
 * that a price was DECIDED somewhere with the authority to decide it, and refuses the order
 * otherwise.
 *
 * NOT a zero default. Zero is a real committed price -- a no-charge line is a legitimate commercial
 * act -- and defaulting an ABSENT price to zero would turn "nobody priced this" into "this is free",
 * which is the single most expensive mistake available here.
 *
 * ════════════════════ IT REPORTS EVERY UNPRICED LINE, NOT THE FIRST ════════════════════
 *
 * Failing on line 1 of a six-line order makes pricing an order a six-round trip. The error names
 * them all.
 *
 * The existing seven records are NOT touched. They are invalid fixtures; inventing prices for them
 * would be the same failure in the opposite direction.
 */
function requireCompletePricing(lines) {
    const unpriced = lines
        .map((l, i) => ({ index: i, lineId: l.lineId, ref: l.ref, priced: typeof l.unitPrice === "number" }))
        .filter((l) => !l.priced);
    if (unpriced.length === 0)
        return;
    throw new SalesOrderCommandError("UNPRICED_LINE", `A confirmed Sales Order requires a committed unit price on every line. Unpriced: ` +
        unpriced.map((l) => `${l.lineId} (${l.ref})`).join(", "));
}
// Build a NEW Sales Order (CONFIRMED = the commercial commitment following a WON Opportunity). Reuses
// canonical refs; never assigns serialized assets. `actorUid`/`nowMillis` come from the callable.
function buildCreateSalesOrder(input, ctx) {
    if (!input || typeof input !== "object")
        throw new SalesOrderCommandError("INVALID", "Missing input");
    if (!nonEmpty(input.accountId))
        throw new SalesOrderCommandError("ACCOUNT_REQUIRED", "accountId is required");
    // Ruling D-4. OWNER_REQUIRED is preserved as the refusal code, so a caller that supplies nothing
    // and has nothing to inherit fails exactly as it did before -- only the message gained the reason.
    let resolvedOwner;
    try {
        resolvedOwner = (0, creationOwnerResolution_1.resolveCreationOwner)(input.ownerEmployeeId, input.inheritedOwner, "the Opportunity");
    }
    catch (e) {
        throw new SalesOrderCommandError("OWNER_REQUIRED", e.message);
    }
    if (!(0, salesOrderLifecycle_1.isSalesChannel)(input.salesChannel))
        throw new SalesOrderCommandError("CHANNEL_INVALID", "salesChannel is invalid");
    if (!Array.isArray(input.lines) || input.lines.length === 0)
        throw new SalesOrderCommandError("NO_LINES", "A Sales Order requires at least one line");
    // #184: the builder VERIFIES the governed mark; it never establishes accountability itself. A value
    // without the mark is refused rather than written, so no caller-supplied id can become persisted
    // accountability without the Employee authority having answered.
    if (input.accountablePerson !== undefined && !(0, accountablePersonStorage_1.isGovernedAccountablePerson)(input.accountablePerson)) {
        throw new SalesOrderCommandError("ACCOUNTABLE_PERSON_NOT_GOVERNED", "accountablePerson must be the result of a governed establishment " +
            "(responsibility/accountablePersonEstablishment.ts). An id, a plain object, or a serialized " +
            "copy is not evidence that the Employee authority was consulted (#184, #182 s5).");
    }
    const accountability = input.accountablePerson === undefined ? {} : (0, accountablePersonStorage_1.accountablePersonFields)(input.accountablePerson);
    const lines = input.lines.map((l, i) => validateLine(l, i));
    requireCompletePricing(lines);
    // COMPANY GATE (company-authority correction). A CONFIRMED order is a reportable commitment; if
    // neither explicit nor inherited governed authority resolves a company, creation refuses HERE —
    // pure, before any write, so both conversion transactions abort whole (no order written, no
    // Opportunity falsely WON, no half-committed Agreement→Order lineage) and the direct callable
    // refuses cleanly. No inference, no Taylor default, no actor fallback.
    const resolvedCompany = (0, commercialCompanyScope_1.resolveCommercialCompanyScope)(input.operatingCompanyId, input.inheritedOperatingCompanyId);
    if (resolvedCompany === null) {
        throw new SalesOrderCommandError("COMPANY_REQUIRED", "This Sales Order has no resolved operating company. A confirmed order is a reportable " +
            "commercial commitment and requires a governed operatingCompanyId — set it on the source " +
            "Opportunity/Agreement (or supply it explicitly) and retry; it is never inferred or defaulted.");
    }
    return {
        accountId: input.accountId.trim(),
        ownerEmployeeId: resolvedOwner.ownerEmployeeId,
        ...accountability,
        salesChannel: input.salesChannel,
        operatingCompanyId: resolvedCompany,
        // Credit chain: explicit → inherited (agreement's frozen credit, read transactionally by the
        // conversion caller) → this order's resolved commercial owner. ctx.actorUid deliberately
        // absent — the person who clicked Create is an actor, not the credited salesperson.
        creditedSalespersonId: (0, financialAttribution_1.resolveCreditedSalesperson)(input.creditedSalespersonId, input.inheritedCreditedSalespersonId, resolvedOwner.ownerEmployeeId),
        // Server context only. A conversion passes the agreement's acceptedAtMillis; direct creation
        // books at server creation time. Never a caller-supplied clock.
        bookedAtMillis: ctx.bookedAtMillis ?? ctx.nowMillis,
        currency: "USD",
        locationId: nonEmpty(input.locationId) ? input.locationId.trim() : null,
        sourceOpportunityId: nonEmpty(input.sourceOpportunityId) ? input.sourceOpportunityId.trim() : null,
        customerPO: nonEmpty(input.customerPO) ? input.customerPO.trim() : null,
        notes: nonEmpty(input.notes) ? input.notes.trim() : null,
        state: "CONFIRMED",
        lines,
        createdByUid: ctx.actorUid,
        createdAtMillis: ctx.nowMillis,
        updatedAtMillis: ctx.nowMillis,
    };
}
// Build the field patch for a lifecycle transition, after validating legality (FULFILLED requires every line
// fully fulfilled). Throws fail-closed on any illegal transition; the callable maps the code to an HttpsError.
function buildTransitionPatch(current, transition, ctx) {
    if (!current || !(0, salesOrderLifecycle_1.isSalesOrderState)(current.state))
        throw new SalesOrderCommandError("INVALID", "Invalid current state");
    const fulfilledAll = (0, salesOrderLifecycle_1.allLinesFulfilled)(Array.isArray(current.lines) ? current.lines : []);
    const check = (0, salesOrderLifecycle_1.checkTransition)(current.state, transition, { allLinesFulfilled: fulfilledAll });
    if (!check.ok) {
        const msg = check.code === "TERMINAL"
            ? "Sales Order is closed or cancelled"
            : check.code === "NOT_FULFILLABLE"
                ? "Cannot mark FULFILLED while quantity remains unfulfilled"
                : check.code === "ILLEGAL_TRANSITION"
                    ? "Illegal Sales Order transition"
                    : "Invalid transition";
        throw new SalesOrderCommandError(check.code, msg);
    }
    return { state: check.to, updatedByUid: ctx.actorUid, updatedAtMillis: ctx.nowMillis };
}
//# sourceMappingURL=salesOrderCommands.js.map
"use strict";
// Reorder — the PURE trusted command core (Owner rulings R-13 / R-15 / R-16, 2026-08-30).
//
// Workstream 2B moves exactly TWO writes behind trusted authority: the two that author a governed
// company fact. Everything else in the reorder workflow keeps its existing client-direct path under
// unchanged Rules, because moving it would be rebuilding a working state machine rather than moving
// the authority the new facts require.
//
//   createReorderRequest        derives operatingCompanyId from the governed Warehouse
//   recordReorderPurchaseOrder  copies it from the request onto the PO
//
// PURE: no Firestore, no firebase-functions, no clock. The callable supplies the actor, the time,
// the warehouse read and the transaction; every decision that can be wrong lives here where a test
// can reach it.
//
// ============================ THE COMPANY IS DERIVED, NEVER SUPPLIED ============================
//
// Ruling R-13 as refined: a client-supplied `operatingCompanyId` is REFUSED with an explicit
// forbidden-authority error -- not ignored. Ignoring it would let a caller believe it had set the
// company and be silently wrong, and it would leave the boundary invisible in the API. The refusal
// is the documentation.
//
// ============================ IDENTITY IS INHERITED, NOT REDESIGNED ============================
//
// The PO's document id IS the reorder request's id, its `reorderRequestId` is pinned equal to it,
// and the request's `purchaseOrderId` points back at the same value. That 1:1 contract predates this
// change and survives it unaltered -- no new id is minted, and this is not a multi-line purchasing
// model.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PO_RECORDABLE_STATUS = exports.ReorderCommandError = void 0;
exports.buildCreateReorderRequest = buildCreateReorderRequest;
exports.buildRecordReorderPurchaseOrder = buildRecordReorderPurchaseOrder;
exports.commandFingerprint = commandFingerprint;
const operatingCompanyAuthority_1 = require("../ownership/operatingCompanyAuthority");
const acquisitionCost_js_1 = require("../finance/acquisitionCost.js");
class ReorderCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ReorderCommandError";
    }
}
exports.ReorderCommandError = ReorderCommandError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
// The two initial statuses the existing client create produces, preserved exactly. This command
// changes WHO may write and WHAT company travels with the record -- not the state machine.
const RECOMMENDATION_STATUSES = ["READY", "NEEDS_PLANNING"];
/**
 * Build a NEW reorder request.
 *
 * @param warehouseCompanyId the company read from the governed Warehouse by the caller, INSIDE its
 *        transaction. Passed in rather than fetched so this stays pure, and read transactionally so
 *        the company cannot drift between the read and the write.
 */
function buildCreateReorderRequest(input, ctx) {
    if (!input || typeof input !== "object")
        throw new ReorderCommandError("INVALID", "Missing input");
    // FIRST, before anything else: refuse a client-supplied company outright. Checked ahead of the
    // ordinary field validation so the boundary error is what a caller sees, rather than a generic
    // complaint about some other field they got wrong at the same time.
    if (input.operatingCompanyId !== undefined) {
        throw new ReorderCommandError("COMPANY_NOT_CLIENT_SUPPLIABLE", "operatingCompanyId is derived from the governed Warehouse and cannot be supplied by a caller.");
    }
    if (!nonEmpty(input.partId))
        throw new ReorderCommandError("PART_REQUIRED", "partId is required");
    if (!nonEmpty(input.warehouseId)) {
        throw new ReorderCommandError("WAREHOUSE_REQUIRED", "warehouseId is required -- a reorder replenishes a specific warehouse");
    }
    if (!RECOMMENDATION_STATUSES.includes(input.recommendationStatus)) {
        throw new ReorderCommandError("RECOMMENDATION_STATUS_INVALID", "recommendationStatus must be READY or NEEDS_PLANNING");
    }
    if (!isInt(input.requestedQty))
        throw new ReorderCommandError("QUANTITY_INVALID", "requestedQty must be a whole number");
    if (input.recommendationStatus === "NEEDS_PLANNING" && input.requestedQty <= 0) {
        throw new ReorderCommandError("QUANTITY_INVALID", "A manually entered quantity must be greater than zero");
    }
    if (!nonEmpty(input.quantitySource))
        throw new ReorderCommandError("INVALID", "quantitySource is required");
    if (input.workOrderId != null && !nonEmpty(input.workOrderId)) {
        throw new ReorderCommandError("WORK_ORDER_REF_INVALID", "workOrderId, when provided, must be a non-empty Work Order id");
    }
    // R-17 -- THE SELECTOR IS UX, THIS IS ENFORCEMENT.
    //
    // Checked BEFORE the governed/company facts, so a caller who posts a warehouse outside their scope
    // learns that and nothing else. Telling them instead that the warehouse is ungoverned, or has no
    // company, would answer a question about a warehouse they are not entitled to ask about.
    //
    // The scope comes from the same resolver listReorderWarehouseOptions filters by, which is what
    // makes the ruling's invariant hold in both directions: everything offered is accepted, and
    // nothing unoffered is accepted just because it was typed instead of clicked.
    if (!ctx.warehouseInScope) {
        throw new ReorderCommandError("WAREHOUSE_NOT_IN_SCOPE", `You are not authorized to raise a reorder for warehouse "${input.warehouseId}"`);
    }
    // The warehouse must be a governed, ACTIVE warehouse -- resolved by the caller through the
    // existing receiving-location authority, not by a second opinion invented here.
    if (!ctx.warehouseGoverned) {
        throw new ReorderCommandError("WAREHOUSE_NOT_GOVERNED", `warehouseId "${input.warehouseId}" is not a governed ACTIVE warehouse`);
    }
    // And it must carry a governed company. Today no sandbox warehouse does, so this REFUSES rather
    // than inventing one -- which is the correct answer until the physical roots are populated.
    const company = ctx.warehouseCompanyId;
    if (!nonEmpty(company) || (0, operatingCompanyAuthority_1.resolveOperatingCompany)(company).company === null) {
        throw new ReorderCommandError("WAREHOUSE_NO_COMPANY", `warehouse "${input.warehouseId}" carries no governed operatingCompanyId, so a reorder against it has no owner`);
    }
    return {
        partId: input.partId.trim(),
        warehouseId: input.warehouseId.trim(),
        operatingCompanyId: company.trim(),
        recommendationStatus: input.recommendationStatus,
        urgency: nonEmpty(input.urgency) ? input.urgency.trim() : null,
        quantitySource: input.quantitySource.trim(),
        recommendedQty: isInt(input.recommendedQty) ? input.recommendedQty : null,
        requestedQty: input.requestedQty,
        // Unchanged initial state, matching what the client path produced.
        status: input.recommendationStatus === "READY" ? "READY_FOR_PARTS_MANAGER" : "PENDING_REVIEW",
        currentOwner: "INVENTORY",
        // The ACTOR. Deliberately not the owner: company responsibility is the warehouse's, and who
        // asked is a different fact from who is responsible.
        requestedBy: ctx.actorUid,
        createdAt: ctx.nowMillis,
        workOrderId: nonEmpty(input.workOrderId) ? input.workOrderId.trim() : null,
    };
}
// ============================ RECORD PURCHASE ORDER ============================
/** The state a request must be in for its PO to be recorded. Unchanged from the retired Rules branch. */
exports.PO_RECORDABLE_STATUS = "PURCHASING_IN_PROGRESS";
/**
 * Build the PO and its paired request transition.
 *
 * Returns BOTH halves together, deliberately. The invariant migrating out of Rules (R-16) is that
 * neither exists without the other, and a builder that could produce one alone would make the
 * caller responsible for remembering the pairing. Here it is impossible to have one and not the
 * other before the transaction even opens.
 *
 * @param request the reorder request document, read by the caller inside the transaction.
 */
function buildRecordReorderPurchaseOrder(input, request, ctx) {
    if (!input || typeof input !== "object")
        throw new ReorderCommandError("INVALID", "Missing input");
    if (input.operatingCompanyId !== undefined) {
        throw new ReorderCommandError("COMPANY_NOT_CLIENT_SUPPLIABLE", "operatingCompanyId is inherited from the reorder request and cannot be supplied by a caller.");
    }
    if (!nonEmpty(input.reorderRequestId))
        throw new ReorderCommandError("INVALID", "reorderRequestId is required");
    if (request === null)
        throw new ReorderCommandError("REQUEST_NOT_FOUND", `No reorder request ${input.reorderRequestId}`);
    if (request.status !== exports.PO_RECORDABLE_STATUS) {
        throw new ReorderCommandError("REQUEST_STATE_INVALID", `reorder request is ${String(request.status)}, not ${exports.PO_RECORDABLE_STATUS}`);
    }
    // 1:1 is enforced by identity, and this is the guard that says so out loud.
    if (ctx.purchaseOrderExists) {
        throw new ReorderCommandError("PO_ALREADY_EXISTS", "this reorder request already has a purchase order");
    }
    // The company is INHERITED from the historical request -- not re-derived from the warehouse.
    // Re-deriving would silently rewrite history if the warehouse were later reassigned.
    const company = request.operatingCompanyId;
    if (!nonEmpty(company) || (0, operatingCompanyAuthority_1.resolveOperatingCompany)(company).company === null) {
        throw new ReorderCommandError("REQUEST_NO_COMPANY", "the reorder request carries no governed operatingCompanyId, so its purchase order would have no owner");
    }
    if (!nonEmpty(request.partId))
        throw new ReorderCommandError("REQUEST_STATE_INVALID", "the reorder request has no partId");
    if (!nonEmpty(input.supplierName))
        throw new ReorderCommandError("SUPPLIER_REQUIRED", "supplierName is required");
    if (!nonEmpty(input.externalPoNumber))
        throw new ReorderCommandError("PO_FIELD_INVALID", "externalPoNumber is required");
    if (typeof input.orderedQuantity !== "number" || !(input.orderedQuantity > 0)) {
        throw new ReorderCommandError("PO_FIELD_INVALID", "orderedQuantity must be greater than zero");
    }
    if (!nonEmpty(input.orderedDate))
        throw new ReorderCommandError("PO_FIELD_INVALID", "orderedDate is required");
    if (input.expectedArrivalDate != null && !nonEmpty(input.expectedArrivalDate)) {
        throw new ReorderCommandError("PO_FIELD_INVALID", "expectedArrivalDate, when provided, must be a non-empty string");
    }
    // FIN-BLOCK-003A -- THE VENDOR COMMITMENT POINT. Recording the purchase order IS the moment the
    // price is committed to the supplier: the request moves to ORDERED and the PO becomes immutable. No
    // new purchasing state was invented for cost; the money is governed at the transition that already
    // means "placed with the vendor".
    //
    // The price authority lives in finance/acquisitionCost.ts, not here. Purchasing decides WHETHER a
    // price was committed; finance decides what a governed price IS. Re-implementing the integer and
    // currency checks locally would give the repo two answers to one question.
    let price;
    try {
        price = (0, acquisitionCost_js_1.governedPurchasePrice)({ unitPriceMinor: input.unitPriceMinor, currency: input.currency });
    }
    catch (err) {
        if (err instanceof acquisitionCost_js_1.AcquisitionCostError)
            throw new ReorderCommandError("PO_FIELD_INVALID", err.message);
        throw err;
    }
    // ACTIVATION (Decision #164 §7 → this ruling): price is now MANDATORY on every NEW commitment.
    //
    // The optional phase existed so the deployed workflow kept working while the authority was built.
    // It is over: a purchase this command records is a purchase whose price the business chose, and
    // recording one without a price would create a new UNKNOWN-cost receipt for no reason.
    //
    // This does NOT touch the purchase orders already in Firestore. Those are legacy by their missing
    // version stamp, not by their missing price, and they stay receivable — see PRICE_AUTHORITY_VERSION.
    //
    // Explicit ZERO is accepted and is NOT the same as absent. A no-charge line — a warranty
    // replacement, a sample, a supplier making good — is a real commercial fact worth recording as
    // 0, and refusing it would push exactly that case back into the UNKNOWN bucket where it cannot
    // be told apart from a price nobody entered.
    if (price === null) {
        throw new ReorderCommandError("PO_PRICE_REQUIRED", "a committed purchase order requires unitPriceMinor and currency — enter 0 for a no-charge line rather than omitting the price");
    }
    const requestId = input.reorderRequestId.trim();
    return {
        purchaseOrder: {
            // Pinned equal to the document id the caller will use. Identity unchanged (R-16).
            reorderRequestId: requestId,
            partId: request.partId.trim(),
            operatingCompanyId: company.trim(),
            supplierName: input.supplierName.trim(),
            externalPoNumber: input.externalPoNumber.trim(),
            orderedQuantity: input.orderedQuantity,
            orderedDate: input.orderedDate.trim(),
            expectedArrivalDate: nonEmpty(input.expectedArrivalDate) ? input.expectedArrivalDate.trim() : null,
            unitPriceMinor: price.unitPriceMinor,
            currency: price.currency,
            // SERVER-AUTHORED, never client-supplied. This stamp is what makes a purchase order recorded
            // today distinguishable from one recorded before the authority existed — for good, and without
            // consulting a clock or inferring anything from a missing field.
            priceAuthorityVersion: acquisitionCost_js_1.PRICE_AUTHORITY_VERSION,
            status: "ORDERED",
            createdBy: ctx.actorUid,
            createdAt: ctx.nowMillis,
        },
        requestPatch: {
            status: "ORDERED",
            // The forward link, equal to the PO's id and to the request's own id.
            purchaseOrderId: requestId,
            orderedBy: ctx.actorUid,
            orderedAt: ctx.nowMillis,
        },
    };
}
/**
 * The fingerprint an idempotency key is bound to.
 *
 * Ruling: a retry with the SAME key and a materially different payload must be REFUSED, not
 * silently treated as the original. So the key alone is not the identity -- the key plus what it
 * was used to say is. Field order is fixed, and only the fields that change the record are
 * included, so a cosmetic difference cannot manufacture a mismatch.
 *
 * SEPARATED by U+001F, not concatenated. Joining on "" would let field boundaries move without
 * changing the result -- ["ab","c"] and ["a","bc"] would fingerprint identically, so a retry that
 * shifted a value across two fields would replay as though it were the original. The unit separator
 * cannot occur in a part id, a warehouse id, a date or a supplier name, so no value can forge a
 * boundary. `null` is marked with U+0000 rather than "": an absent field is not an empty one.
 */
function commandFingerprint(parts) {
    return parts.map((p) => (p === null ? "\u0000" : String(p))).join("\u001F");
}
//# sourceMappingURL=reorderCommands.js.map
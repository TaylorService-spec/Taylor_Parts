"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertConvertibleAgreement = assertConvertibleAgreement;
exports.stageSalesOrderFromAgreement = stageSalesOrderFromAgreement;
exports.createSalesOrder = createSalesOrder;
exports.createSalesOrderFromOpportunity = createSalesOrderFromOpportunity;
exports.transitionSalesOrder = transitionSalesOrder;
const salesOrderCommands_1 = require("../../salesOrder/salesOrderCommands");
const salesOrderLifecycle_1 = require("../../salesOrder/salesOrderLifecycle");
const salesAgreementCommands_1 = require("../../salesAgreement/salesAgreementCommands");
const typedOwner_1 = require("../../ownership/typedOwner");
const commercialNumbering_1 = require("../commercialNumbering");
const commercialCommandKernel_1 = require("./commercialCommandKernel");
const commercialCreation_1 = require("./commercialCreation");
const commercialRecordStore_1 = require("./commercialRecordStore");
/** Fields a client may never supply: server-derived inheritance and lifecycle. */
const SERVER_DERIVED_ORDER_FIELDS = ["inheritedOwner", "inheritedOperatingCompanyId", "inheritedCreditedSalespersonId", "state",
    "salesOrderNumber", "bookedAtMillis", "currency"];
function refuseServerDerived(input, fields) {
    const present = fields.filter((f) => f in input);
    if (present.length > 0)
        (0, commercialCommandKernel_1.fail)("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `server-derived fields may not be supplied: ${present.join(", ")}`);
}
/** Refuse unless the Agreement is the ACCEPTED Agreement of this Opportunity, for the same Account, with lines. */
function assertConvertibleAgreement(agreement, opportunity) {
    if (!agreement)
        return (0, commercialCommandKernel_1.fail)("AGREEMENT_REQUIRED", "PRECONDITION_FAILED", "an ACCEPTED Sales Agreement is required to create the Sales Order");
    if (agreement.opportunityId !== opportunity.id)
        (0, commercialCommandKernel_1.fail)("AGREEMENT_SOURCE_MISMATCH", "PRECONDITION_FAILED", "the Agreement belongs to a different Opportunity");
    if (agreement.accountId !== opportunity.accountId)
        (0, commercialCommandKernel_1.fail)("AGREEMENT_ACCOUNT_MISMATCH", "PRECONDITION_FAILED", "the Agreement is for a different Account");
    if (agreement.state !== "ACCEPTED")
        (0, commercialCommandKernel_1.fail)("AGREEMENT_NOT_ACCEPTED", "PRECONDITION_FAILED", "the Agreement is not ACCEPTED");
    if (agreement.lines.length === 0)
        (0, commercialCommandKernel_1.fail)("NO_LINES", "PRECONDITION_FAILED", "the Agreement has no lines");
    return agreement;
}
/**
 * Stage a Sales Order derived from an ACCEPTED Agreement, on the caller's transaction. Shared by WON close and
 * create-from-Opportunity.
 *
 * NO SECOND CATALOG DECISION. The Agreement's product references were validated when they were written and again at
 * acceptance; the ACCEPTED Agreement is immutable commercial truth. The Order carries exactly those references, so a
 * catalog entry that later disappears cannot rewrite, or block the fulfilment of, a contract the customer accepted.
 */
async function stageSalesOrderFromAgreement(db, actor, now, opportunity, agreement, input) {
    const lines = (0, salesAgreementCommands_1.deriveSalesOrderLinesFromAgreement)({ state: agreement.state, lines: agreement.lines });
    const built = (0, salesOrderCommands_1.buildCreateSalesOrder)({
        accountId: opportunity.accountId,
        ownerEmployeeId: typeof input.ownerEmployeeId === "string" ? input.ownerEmployeeId : undefined,
        inheritedOwner: (0, typedOwner_1.deriveEmployeeRefOwner)({ ownerEmployeeId: opportunity.ownerEmployeeId }),
        inheritedOperatingCompanyId: agreement.operatingCompanyId ?? opportunity.operatingCompanyId,
        inheritedCreditedSalespersonId: agreement.creditedSalespersonId ?? opportunity.creditedSalespersonId,
        salesChannel: input.salesChannel,
        locationId: typeof input.locationId === "string" ? input.locationId : agreement.locationId ?? undefined,
        sourceOpportunityId: opportunity.id,
        customerPO: typeof input.customerPO === "string" ? input.customerPO : agreement.customerPO ?? undefined,
        notes: agreement.specialInstructions ?? undefined,
        lines,
    }, { actorUid: actor.principalId, nowMillis: now.getTime(), bookedAtMillis: agreement.acceptedAtMillis ?? now.getTime() });
    return stageBuiltSalesOrder(db, actor, now, built, { opportunityId: opportunity.id, salesAgreementId: agreement.id }, undefined);
}
async function stageBuiltSalesOrder(db, actor, now, built, source, explicitAccountable) {
    await (0, commercialCommandKernel_1.requireTenantAccount)(db, actor.tenantId, built.accountId);
    await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
    await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
    const established = await (0, commercialCreation_1.resolveCreationAccountablePerson)(db, actor.tenantId, "salesOrder", explicitAccountable, built.ownerEmployeeId);
    const number = await (0, commercialNumbering_1.allocateCommercialNumber)(db, actor.tenantId, "SALES_ORDER", now);
    const id = (0, commercialRecordStore_1.newRecordId)("sor");
    await (0, commercialRecordStore_1.insertSalesOrder)(db, actor.tenantId, actor.principalId, {
        id, number: number.number, accountId: built.accountId, opportunityId: source.opportunityId, salesAgreementId: source.salesAgreementId,
        ownerEmployeeId: built.ownerEmployeeId, operatingCompanyId: built.operatingCompanyId, salesChannel: built.salesChannel,
        creditedSalespersonId: built.creditedSalespersonId, bookedAtMillis: built.bookedAtMillis, locationId: built.locationId,
        customerPO: built.customerPO, notes: built.notes,
        lines: built.lines.map((l) => ({ kind: l.kind, ref: l.ref, businessUnitId: l.businessUnitId, orderedQty: l.orderedQty, unitPrice: l.unitPrice ?? null })),
    });
    const accountable = await (0, commercialCreation_1.stageCreationAccountablePerson)(db, actor.tenantId, actor.principalId, "salesOrder", id, established);
    return { salesOrderId: id, salesOrderNumber: number.number, state: built.state, ...accountable };
}
const lineKey = (l) => `${l.kind}:${l.ref}:${l.qty}`;
const sameMultiset = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
/** Direct governed create. With a source Opportunity it must be WON, same Account, identical lines, and have no Order. */
function createSalesOrder(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "salesOrder.create", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey, async (db, now) => {
        refuseServerDerived(input, SERVER_DERIVED_ORDER_FIELDS);
        if (typeof input.ownerEmployeeId !== "string" || input.ownerEmployeeId.trim() === "") {
            (0, commercialCommandKernel_1.fail)("OWNER_REQUIRED", "INVALID_INPUT", "ownerEmployeeId is required for a direct Sales Order");
        }
        const { idempotencyKey: _k, accountableEmployeeId, sourceOpportunityId, ...fields } = input;
        const built = (0, salesOrderCommands_1.buildCreateSalesOrder)({ ...fields, sourceOpportunityId }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        let opportunityId = null;
        if (typeof sourceOpportunityId === "string" && sourceOpportunityId.trim() !== "") {
            const opportunity = await (0, commercialRecordStore_1.lockOpportunity)(db, actor.tenantId, sourceOpportunityId);
            if (!opportunity)
                (0, commercialCommandKernel_1.fail)("SOURCE_OPPORTUNITY_NOT_FOUND", "NOT_FOUND", "the source Opportunity does not exist in this tenant");
            if (opportunity.outcome !== "WON")
                (0, commercialCommandKernel_1.fail)("OPPORTUNITY_NOT_WON", "PRECONDITION_FAILED", "the source Opportunity is not WON");
            if (opportunity.accountId !== built.accountId)
                (0, commercialCommandKernel_1.fail)("SOURCE_ACCOUNT_MISMATCH", "PRECONDITION_FAILED", "the source Opportunity is for a different Account");
            const expected = opportunity.lines.map(lineKey);
            const actual = built.lines.map((l) => lineKey({ kind: l.kind, ref: l.ref, qty: l.orderedQty }));
            if (!sameMultiset(expected, actual))
                (0, commercialCommandKernel_1.fail)("SOURCE_LINES_MISMATCH", "PRECONDITION_FAILED", "the Order lines do not match the source Opportunity");
            if (await (0, commercialRecordStore_1.lockOrderForOpportunity)(db, actor.tenantId, opportunity.id)) {
                (0, commercialCommandKernel_1.fail)("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the source Opportunity already has a Sales Order");
            }
            opportunityId = opportunity.id;
        }
        // A direct Order carries NEW product references: they pass the catalog authority before any number or row.
        await (0, commercialCommandKernel_1.requireCatalogReferences)(deps, db, actor.tenantId, built.lines);
        const created = await stageBuiltSalesOrder(db, actor, now, built, { opportunityId, salesAgreementId: null }, accountableEmployeeId);
        return { result: created, target: { family: "salesOrder", id: created.salesOrderId } };
    });
}
/** Sales Order from an already-WON Opportunity and its ACCEPTED Agreement. Does not transition the Opportunity. */
function createSalesOrderFromOpportunity(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "salesOrder.createFromOpportunity", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.OPPORTUNITY_CREATE_SALES_ORDER], input?.idempotencyKey, async (db, now) => {
        if (typeof input.opportunityId !== "string")
            (0, commercialCommandKernel_1.fail)("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
        const opportunity = await (0, commercialRecordStore_1.lockOpportunity)(db, actor.tenantId, input.opportunityId);
        if (!opportunity)
            return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
        if (opportunity.outcome !== "WON")
            (0, commercialCommandKernel_1.fail)("OPPORTUNITY_NOT_WON", "PRECONDITION_FAILED", "the Opportunity is not WON");
        if (await (0, commercialRecordStore_1.lockOrderForOpportunity)(db, actor.tenantId, opportunity.id)) {
            (0, commercialCommandKernel_1.fail)("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Order");
        }
        const agreement = assertConvertibleAgreement(await (0, commercialRecordStore_1.lockAgreementForOpportunity)(db, actor.tenantId, opportunity.id), opportunity);
        const created = await stageSalesOrderFromAgreement(db, actor, now, opportunity, agreement, input);
        return { result: { ...created, opportunityId: opportunity.id }, target: { family: "salesOrder", id: created.salesOrderId } };
    });
}
/** Core lifecycle: CONFIRMED -> IN_FULFILLMENT, CANCEL before FULFILLED. The quantity-decided step refuses (D2). */
function transitionSalesOrder(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "salesOrder.transition", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey, async (db, now) => {
        const transition = input.transition;
        if (transition !== "ADVANCE" && transition !== "CANCEL")
            (0, commercialCommandKernel_1.fail)("TRANSITION_INVALID", "INVALID_INPUT", "transition must be ADVANCE or CANCEL");
        const order = await (0, commercialRecordStore_1.lockOrderState)(db, actor.tenantId, String(input.salesOrderId ?? ""));
        if (!order)
            return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
        if (!(0, salesOrderLifecycle_1.isSalesOrderState)(order.state))
            return (0, commercialCommandKernel_1.fail)("ORDER_STATE_UNSET", "PRECONDITION_FAILED", "the Sales Order has no governed lifecycle state");
        if (transition === "ADVANCE" && order.state === "IN_FULFILLMENT") {
            (0, commercialCommandKernel_1.fail)("FULFILLMENT_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "IN_FULFILLMENT -> FULFILLED is decided by fulfilled quantities, which PostgreSQL does not govern until execution migrates (D2)");
        }
        const patch = (0, salesOrderCommands_1.buildTransitionPatch)({ state: order.state }, transition, { actorUid: actor.principalId, nowMillis: now.getTime() });
        await db.query(`UPDATE eos_commercial.sales_orders SET state = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, order.id, patch.state, actor.principalId]);
        return { result: { salesOrderId: order.id, state: patch.state }, target: { family: "salesOrder", id: order.id } };
    });
}
//# sourceMappingURL=salesOrderCommandService.js.map
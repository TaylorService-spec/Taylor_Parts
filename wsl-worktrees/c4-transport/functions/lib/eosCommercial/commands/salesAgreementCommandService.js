"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSalesAgreement = createSalesAgreement;
exports.updateSalesAgreementDraft = updateSalesAgreementDraft;
exports.acceptSalesAgreement = acceptSalesAgreement;
const salesAgreementCommands_1 = require("../../salesAgreement/salesAgreementCommands");
const commercialNumbering_1 = require("../commercialNumbering");
const commercialCommandKernel_1 = require("./commercialCommandKernel");
const commercialCreation_1 = require("./commercialCreation");
const commercialRecordStore_1 = require("./commercialRecordStore");
const target = (id) => ({ family: "salesAgreement", id });
const CREATE_FORBIDDEN = ["accountId", "sourceOpportunityId", "state", "salesAgreementNumber", "salesOrderId", "acceptedByUid",
    "acceptedAtMillis", "acceptedBy", "acceptedAt", "currency", "totals", "inheritedOperatingCompanyId", "inheritedCreditedSalespersonId"];
const ACCEPT_FORBIDDEN = ["state", "acceptedAtMillis", "acceptedByUid", "acceptedAt", "acceptedBy", "lines", "totals"];
function refuseFields(input, fields) {
    const present = fields.filter((f) => f in input);
    if (present.length > 0)
        (0, commercialCommandKernel_1.fail)("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `these fields are server-derived and may not be supplied: ${present.join(", ")}`);
}
const agreementLineRows = (lines) => lines.map((l) => ({ kind: l.kind, ref: l.ref, businessUnitId: l.businessUnitId, quantity: l.quantity, unitPrice: l.unitPrice,
    condition: l.condition, warranty: l.warranty, estimatedArrivalMillis: l.estimatedArrivalMillis }));
async function requireAgreement(db, tenantId, id) {
    if (typeof id !== "string" || id.trim() === "")
        (0, commercialCommandKernel_1.fail)("AGREEMENT_REQUIRED", "INVALID_INPUT", "salesAgreementId is required");
    const row = await (0, commercialRecordStore_1.lockAgreement)(db, tenantId, id);
    if (!row)
        return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Agreement does not exist in this tenant");
    if (row.state === null)
        (0, commercialCommandKernel_1.fail)("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Agreement was not created through a governed command and carries no lifecycle");
    return row;
}
function createSalesAgreement(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "salesAgreement.create", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_CREATE], input?.idempotencyKey, async (db, now) => {
        refuseFields(input, CREATE_FORBIDDEN);
        if (typeof input.opportunityId !== "string" || input.opportunityId.trim() === "")
            (0, commercialCommandKernel_1.fail)("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
        const opportunity = await (0, commercialRecordStore_1.lockOpportunity)(db, actor.tenantId, input.opportunityId);
        if (!opportunity)
            return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
        if (opportunity.stage === null)
            (0, commercialCommandKernel_1.fail)("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity carries no governed lifecycle");
        if (opportunity.outcome === "LOST")
            (0, commercialCommandKernel_1.fail)("OPPORTUNITY_LOST", "PRECONDITION_FAILED", "a LOST Opportunity cannot receive a Sales Agreement");
        if (await (0, commercialRecordStore_1.lockAgreementForOpportunity)(db, actor.tenantId, opportunity.id)) {
            (0, commercialCommandKernel_1.fail)("AGREEMENT_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Agreement");
        }
        const { idempotencyKey: _k, opportunityId: _o, accountableEmployeeId, ...fields } = input;
        const built = (0, salesAgreementCommands_1.buildCreateSalesAgreement)({
            ...fields,
            accountId: opportunity.accountId,
            sourceOpportunityId: opportunity.id,
            inheritedOperatingCompanyId: opportunity.operatingCompanyId,
            inheritedCreditedSalespersonId: opportunity.creditedSalespersonId,
        }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        await (0, commercialCommandKernel_1.requireTenantAccount)(db, actor.tenantId, built.accountId);
        await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
        await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
        await (0, commercialCommandKernel_1.requireCatalogReferences)(deps, db, actor.tenantId, built.lines);
        const established = await (0, commercialCreation_1.resolveCreationAccountablePerson)(db, actor.tenantId, "salesAgreement", accountableEmployeeId, built.ownerEmployeeId);
        const number = await (0, commercialNumbering_1.allocateCommercialNumber)(db, actor.tenantId, "SALES_AGREEMENT", now);
        const id = (0, commercialRecordStore_1.newRecordId)("sag");
        await db.query(`INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, opportunity_id, owner_employee_id,
           operating_company_key, state, currency, credited_salesperson_employee_id, location_id, customer_po, is_lease, fulfillment_intent,
           shipping_instructions, ship_via, special_instructions, shipping_minor, install_charge_minor, tax_minor, down_payment_minor,
           trade_in_minor, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT','USD',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)`, [id, actor.tenantId, number.number, built.accountId, opportunity.id, built.ownerEmployeeId, built.operatingCompanyId,
            built.creditedSalespersonId, built.locationId, built.customerPO, built.isLease, built.fulfillmentIntent, built.shippingInstructions,
            built.shipVia, built.specialInstructions, built.totals.shippingMinor, built.totals.installChargeMinor, built.totals.taxMinor,
            built.totals.downPaymentMinor, built.totals.tradeInMinor, actor.principalId]);
        await (0, commercialRecordStore_1.replaceAgreementLines)(db, actor.tenantId, id, agreementLineRows(built.lines));
        const accountable = await (0, commercialCreation_1.stageCreationAccountablePerson)(db, actor.tenantId, actor.principalId, "salesAgreement", id, established);
        return {
            result: { salesAgreementId: id, salesAgreementNumber: number.number, opportunityId: opportunity.id, state: "DRAFT", ...accountable },
            target: target(id),
        };
    });
}
/** Firestore draft-patch field -> column. `lines` and `totals` are handled on their own. */
const DRAFT_COLUMNS = Object.freeze({
    locationId: "location_id", creditedSalespersonId: "credited_salesperson_employee_id", customerPO: "customer_po", isLease: "is_lease",
    fulfillmentIntent: "fulfillment_intent", shippingInstructions: "shipping_instructions", shipVia: "ship_via",
    specialInstructions: "special_instructions",
});
const CHARGE_COLUMNS = Object.freeze({
    shippingMinor: "shipping_minor", installChargeMinor: "install_charge_minor", taxMinor: "tax_minor",
    downPaymentMinor: "down_payment_minor", tradeInMinor: "trade_in_minor",
});
function updateSalesAgreementDraft(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "salesAgreement.updateDraft", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_UPDATE_DRAFT], input?.idempotencyKey, async (db, now) => {
        const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
        const { idempotencyKey: _k, salesAgreementId: _a, ...fields } = input;
        const patch = (0, salesAgreementCommands_1.buildUpdateSalesAgreementDraft)({ state: current.state, lines: current.lines, totals: (0, salesAgreementCommands_1.computeAgreementTotals)(current.lines, current.charges) }, fields, { actorUid: actor.principalId, nowMillis: now.getTime() });
        const changed = Object.keys(fields);
        const values = [actor.tenantId, current.id, actor.principalId];
        const sets = [];
        for (const [field, column] of Object.entries(DRAFT_COLUMNS)) {
            if (!(field in patch))
                continue;
            if (field === "creditedSalespersonId")
                await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, patch[field], "CREDITED_SALESPERSON");
            values.push(patch[field]);
            sets.push(`${column} = $${values.length}`);
        }
        const totals = patch.totals;
        if (totals) {
            for (const [field, column] of Object.entries(CHARGE_COLUMNS)) {
                values.push(totals[field]);
                sets.push(`${column} = $${values.length}`);
            }
        }
        const lines = patch.lines ?? current.lines;
        await (0, commercialCommandKernel_1.requireCatalogReferences)(deps, db, actor.tenantId, lines);
        await db.query(`UPDATE eos_commercial.sales_agreements SET ${[...sets, "updated_by = $3", "updated_at = now()"].join(", ")}
          WHERE tenant_id = $1 AND id = $2 AND state = 'DRAFT'`, values);
        if (patch.lines)
            await (0, commercialRecordStore_1.replaceAgreementLines)(db, actor.tenantId, current.id, agreementLineRows(patch.lines));
        return { result: { salesAgreementId: current.id, changed }, target: target(current.id) };
    });
}
function acceptSalesAgreement(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "salesAgreement.accept", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_ACCEPT], input?.idempotencyKey, async (db, now) => {
        refuseFields(input, ACCEPT_FORBIDDEN);
        const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
        (0, salesAgreementCommands_1.buildAcceptSalesAgreement)({ state: current.state, lines: current.lines, operatingCompanyId: current.operatingCompanyId }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        await (0, commercialCommandKernel_1.requireCatalogReferences)(deps, db, actor.tenantId, current.lines);
        const accepted = await db.query(`UPDATE eos_commercial.sales_agreements SET state = 'ACCEPTED', accepted_at = $3, accepted_by = $4, updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND state = 'DRAFT' RETURNING accepted_at`, [actor.tenantId, current.id, now, actor.principalId]);
        if (accepted.rowCount !== 1)
            (0, commercialCommandKernel_1.fail)("ILLEGAL_TRANSITION", "PRECONDITION_FAILED", "only a DRAFT Sales Agreement can be accepted");
        return {
            result: { salesAgreementId: current.id, state: "ACCEPTED", acceptedAt: accepted.rows[0].accepted_at.toISOString(), acceptedBy: actor.principalId },
            target: target(current.id),
        };
    });
}
//# sourceMappingURL=salesAgreementCommandService.js.map
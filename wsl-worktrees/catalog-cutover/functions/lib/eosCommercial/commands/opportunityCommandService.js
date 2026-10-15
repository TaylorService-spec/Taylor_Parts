"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpportunity = createOpportunity;
exports.updateOpportunity = updateOpportunity;
exports.transitionOpportunity = transitionOpportunity;
exports.closeOpportunityAsWon = closeOpportunityAsWon;
const opportunityCommands_1 = require("../../opportunity/opportunityCommands");
const typedOwner_1 = require("../../ownership/typedOwner");
const commercialOwnershipAuthority_1 = require("../commercialOwnershipAuthority");
const commercialOwnershipRepository_1 = require("../commercialOwnershipRepository");
const commercialNumbering_1 = require("../commercialNumbering");
const commercialCommandKernel_1 = require("./commercialCommandKernel");
const commercialCreation_1 = require("./commercialCreation");
const commercialRecordStore_1 = require("./commercialRecordStore");
const salesOrderCommandService_1 = require("./salesOrderCommandService");
const target = (id) => ({ family: "opportunity", id });
async function requireOpportunity(db, tenantId, id) {
    if (typeof id !== "string" || id.trim() === "")
        (0, commercialCommandKernel_1.fail)("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
    const row = await (0, commercialRecordStore_1.lockOpportunity)(db, tenantId, id);
    if (!row)
        return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
    if (row.stage === null || row.salesChannel === null) {
        (0, commercialCommandKernel_1.fail)("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity was not created through a governed command and carries no lifecycle");
    }
    return row;
}
function createOpportunity(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "opportunity.create", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE], input?.idempotencyKey, async (db, now) => {
        if (typeof input.accountId !== "string" || input.accountId.trim() === "")
            (0, commercialCommandKernel_1.fail)("ACCOUNT_REQUIRED", "INVALID_INPUT", "accountId is required");
        if ("inheritedOwner" in input)
            (0, commercialCommandKernel_1.fail)("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "inheritedOwner is server-derived");
        const account = await (0, commercialCommandKernel_1.requireTenantAccount)(db, actor.tenantId, input.accountId.trim());
        const { idempotencyKey: _k, accountableEmployeeId, ...fields } = input;
        const built = (0, opportunityCommands_1.buildCreateOpportunity)({ ...fields, accountId: account.id, inheritedOwner: (0, typedOwner_1.deriveEmployeeRefOwner)({ ownerEmployeeId: account.ownerEmployeeId }) }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
        if (built.creditedSalespersonId !== null)
            await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
        // New product references pass the catalog authority before any number is allocated or row written.
        await (0, commercialCommandKernel_1.requireCatalogReferences)(deps, db, actor.tenantId, built.lines);
        const established = await (0, commercialCreation_1.resolveCreationAccountablePerson)(db, actor.tenantId, "opportunity", accountableEmployeeId, built.ownerEmployeeId);
        const number = await (0, commercialNumbering_1.allocateCommercialNumber)(db, actor.tenantId, "OPPORTUNITY", now);
        const id = (0, commercialRecordStore_1.newRecordId)("opp");
        await (0, commercialRecordStore_1.insertOpportunity)(db, actor.tenantId, actor.principalId, {
            id, number: number.number, accountId: built.accountId, ownerEmployeeId: built.ownerEmployeeId, operatingCompanyId: built.operatingCompanyId,
            salesChannel: built.salesChannel, stage: built.stage, need: built.need, expectedValue: built.expectedValue,
            expectedCloseAtMillis: built.expectedCloseAt, creditedSalespersonId: built.creditedSalespersonId, lines: built.lines,
        });
        const accountable = await (0, commercialCreation_1.stageCreationAccountablePerson)(db, actor.tenantId, actor.principalId, "opportunity", id, established);
        return {
            result: { opportunityId: id, opportunityNumber: number.number, stage: built.stage, editVersion: 1, ...accountable },
            target: target(id),
        };
    });
}
/** Column for each scalar field the governed edit may change. Owner and lines are handled on their own paths. */
const UPDATE_COLUMNS = Object.freeze({
    accountId: "account_id", creditedSalespersonId: "credited_salesperson_employee_id", salesChannel: "sales_channel", need: "need",
    expectedValue: "expected_value", expectedCloseAt: "expected_close_at", nextAction: "next_action",
});
function updateOpportunity(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "opportunity.update", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE], input?.idempotencyKey, async (db, now) => {
        const current = await requireOpportunity(db, actor.tenantId, input.opportunityId);
        const expected = input.expectedEditVersion;
        if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1) {
            (0, commercialCommandKernel_1.fail)("EDIT_VERSION_REQUIRED", "INVALID_INPUT", "expectedEditVersion is required");
        }
        const { idempotencyKey: _k, expectedEditVersion: _v, ownershipHandoff, ...fields } = input;
        // The builder's own version comparison is satisfied here on purpose: the governing check is the SQL predicate below,
        // evaluated against the locked row, so there is exactly one place a stale write is refused.
        const { patch, changes } = (0, opportunityCommands_1.buildUpdateOpportunity)({ stage: current.stage, outcome: current.outcome, lines: current.lines, updatedAtMillis: expected }, { ...fields, expectedUpdatedAtMillis: expected }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        // Replacement lines are NEW product references: they pass the catalog authority before anything is written.
        if ("lines" in patch)
            await (0, commercialCommandKernel_1.requireCatalogReferences)(deps, db, actor.tenantId, patch.lines);
        const sets = [];
        const values = [actor.tenantId, current.id, expected, actor.principalId];
        for (const [field, column] of Object.entries(UPDATE_COLUMNS)) {
            if (!(field in patch))
                continue;
            let value = patch[field];
            if (field === "accountId")
                await (0, commercialCommandKernel_1.requireTenantAccount)(db, actor.tenantId, value);
            if (field === "creditedSalespersonId")
                await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, value, "CREDITED_SALESPERSON");
            if (field === "expectedCloseAt")
                value = typeof value === "number" ? new Date(value) : null;
            values.push(value);
            sets.push(`${column} = $${values.length}`);
        }
        const bumped = await db.query(`UPDATE eos_commercial.opportunities SET ${[...sets, "edit_version = edit_version + 1", "updated_by = $4", "updated_at = now()"].join(", ")}
        WHERE tenant_id = $1 AND id = $2 AND edit_version = $3`, values);
        if (bumped.rowCount !== 1)
            (0, commercialCommandKernel_1.fail)("VERSION_CONFLICT", "CONFLICT", "the Opportunity changed since it was read; reload and retry");
        if ("lines" in patch)
            await (0, commercialRecordStore_1.replaceOpportunityLines)(db, actor.tenantId, current.id, patch.lines);
        let ownershipHandoffId = null;
        if ("ownerEmployeeId" in patch) {
            const newOwner = await (0, commercialCommandKernel_1.requireTenantEmployee)(db, actor.tenantId, patch.ownerEmployeeId, "OWNER");
            const handoff = (ownershipHandoff ?? {});
            const source = handoff.source ?? "DIRECT_HANDOFF";
            if (!(0, commercialOwnershipAuthority_1.isCommercialHandoffSource)(source))
                (0, commercialCommandKernel_1.fail)("HANDOFF_SOURCE_INVALID", "INVALID_INPUT", "ownershipHandoff.source is not a governed handoff source");
            const recorded = await (0, commercialOwnershipRepository_1.stageCommercialOwnershipTransfer)(db, actor.tenantId, actor.principalId, {
                kind: "OPPORTUNITY", recordId: current.id, newOwnerEmployeeId: newOwner, source: source,
                reason: typeof handoff.reason === "string" ? handoff.reason : null,
            });
            ownershipHandoffId = recorded.id;
        }
        return {
            result: { opportunityId: current.id, changed: changes.map((c) => c.field), editVersion: expected + 1, ownershipHandoffId },
            target: target(current.id),
        };
    });
}
function transitionOpportunity(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "opportunity.transition", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE], input?.idempotencyKey, async (db, now) => {
        const current = await requireOpportunity(db, actor.tenantId, input.opportunityId);
        const hasStage = typeof input.toStage === "string";
        const hasOutcome = typeof input.outcome === "string";
        if (hasStage === hasOutcome)
            (0, commercialCommandKernel_1.fail)("TRANSITION_INVALID", "INVALID_INPUT", "exactly one of toStage or outcome is required");
        if (input.expectedEditVersion !== undefined && input.expectedEditVersion !== current.editVersion) {
            (0, commercialCommandKernel_1.fail)("VERSION_CONFLICT", "CONFLICT", "the Opportunity changed since it was read; reload and retry");
        }
        const patch = (0, opportunityCommands_1.buildTransitionPatch)({ stage: current.stage, outcome: current.outcome, lines: current.lines }, hasStage ? { kind: "ADVANCE", toStage: input.toStage } : { kind: "OUTCOME", outcome: input.outcome }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        await applyOpportunityTransition(db, actor, current.id, current.editVersion, patch.stage, patch.outcome, now);
        return {
            result: { opportunityId: current.id, stage: patch.stage, outcome: patch.outcome, editVersion: current.editVersion + 1 },
            target: target(current.id),
        };
    });
}
/** `now` is the command's governed instant -- the same one the transition patch was built with. No second clock read. */
async function applyOpportunityTransition(db, actor, id, version, stage, outcome, now) {
    const result = await db.query(`UPDATE eos_commercial.opportunities
        SET stage = $4, outcome = $5, closed_at = $6, edit_version = edit_version + 1, updated_by = $7, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND edit_version = $3`, [actor.tenantId, id, version, stage, outcome, outcome === null ? null : now, actor.principalId]);
    if (result.rowCount !== 1)
        (0, commercialCommandKernel_1.fail)("VERSION_CONFLICT", "CONFLICT", "the Opportunity changed since it was read; reload and retry");
}
/**
 * WON + its Sales Order as ONE unit: the Opportunity locked, its ACCEPTED Agreement required, the Order derived from the
 * Agreement (number, lines, owner, credit, company, Accountable Person and history), the Opportunity moved to WON.
 * The Agreement is only read. An Opportunity already WON without an Order gets its Order (recovered); one that already
 * has an Order is refused -- in PostgreSQL the two can only have been committed together.
 */
function closeOpportunityAsWon(deps, actor, input) {
    return (0, commercialCommandKernel_1.runCommercialCommand)(deps, actor, "opportunity.closeAsWon", [commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE, commercialCommandKernel_1.COMMERCIAL_CAPABILITIES.OPPORTUNITY_CREATE_SALES_ORDER], input?.idempotencyKey, async (db, now) => {
        const opportunity = await requireOpportunity(db, actor.tenantId, input.opportunityId);
        if (opportunity.outcome === "LOST")
            (0, commercialCommandKernel_1.fail)("OPPORTUNITY_LOST", "PRECONDITION_FAILED", "a LOST Opportunity cannot be closed as WON");
        if (await (0, commercialRecordStore_1.lockOrderForOpportunity)(db, actor.tenantId, opportunity.id)) {
            (0, commercialCommandKernel_1.fail)("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Order");
        }
        const alreadyWon = opportunity.outcome === "WON";
        const patch = alreadyWon ? null : (0, opportunityCommands_1.buildTransitionPatch)({ stage: opportunity.stage, outcome: opportunity.outcome, lines: opportunity.lines }, { kind: "OUTCOME", outcome: "WON" }, { actorUid: actor.principalId, nowMillis: now.getTime() });
        const agreement = (0, salesOrderCommandService_1.assertConvertibleAgreement)(await (0, commercialRecordStore_1.lockAgreementForOpportunity)(db, actor.tenantId, opportunity.id), opportunity);
        const order = await (0, salesOrderCommandService_1.stageSalesOrderFromAgreement)(db, actor, now, opportunity, agreement, input);
        if (patch)
            await applyOpportunityTransition(db, actor, opportunity.id, opportunity.editVersion, patch.stage, patch.outcome, now);
        return {
            result: {
                opportunityId: opportunity.id, salesOrderId: order.salesOrderId, salesOrderNumber: order.salesOrderNumber, recovered: alreadyWon,
                editVersion: patch ? opportunity.editVersion + 1 : opportunity.editVersion,
            },
            target: target(opportunity.id),
        };
    });
}
//# sourceMappingURL=opportunityCommandService.js.map
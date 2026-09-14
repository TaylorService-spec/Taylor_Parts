// Governed PostgreSQL Opportunity commands -- wave C2. Internal services; nothing external invokes them yet.
//
// Validation is the existing pure builders' (opportunityCommands.ts, opportunityLifecycle.ts); authority, identity,
// numbering, ownership history, accountability history and idempotency are PostgreSQL's, in one transaction.
//
// OWNER CHANGES (blocker #3's PostgreSQL path): an ordinary edit may not overwrite `owner_employee_id`. A changed owner
// goes through the governed ownership handoff -- predecessor read under lock, append-only ownership_handoffs row, owner
// moved -- in the edit's transaction. The Accountable Person is never touched by it; that needs its own governed
// accountability action. The legacy Firestore updateOpportunity remains reachable until cutover, so blocker #3 stays open.
//
// EDIT VERSION: every mutation of an Opportunity bumps `edit_version`, and an edit applies only `WHERE edit_version =
// expected`. The legacy transition that forgot to bump the version is not reproduced.
import type { PoolClient } from "pg";
import { buildCreateOpportunity, buildTransitionPatch, buildUpdateOpportunity } from "../../opportunity/opportunityCommands";
import { deriveEmployeeRefOwner } from "../../ownership/typedOwner";
import { isCommercialHandoffSource } from "../commercialOwnershipAuthority";
import { stageCommercialOwnershipTransfer } from "../commercialOwnershipRepository";
import { allocateCommercialNumber } from "../commercialNumbering";
import {
  COMMERCIAL_CAPABILITIES, fail, requireTenantAccount, requireTenantEmployee, runCommercialCommand,
  type CommercialActorContext, type CommercialCommandDeps,
} from "./commercialCommandKernel";
import { resolveCreationAccountablePerson, stageCreationAccountablePerson } from "./commercialCreation";
import { insertOpportunity, lockAgreementForOpportunity, lockOpportunity, lockOrderForOpportunity, newRecordId, replaceOpportunityLines } from "./commercialRecordStore";
import { assertConvertibleAgreement, stageSalesOrderFromAgreement } from "./salesOrderCommandService";

type Queryable = Pick<PoolClient, "query">;
const target = (id: string) => ({ family: "opportunity" as const, id });

async function requireOpportunity(db: Queryable, tenantId: string, id: unknown) {
  if (typeof id !== "string" || id.trim() === "") fail("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
  const row = await lockOpportunity(db, tenantId, id as string);
  if (!row) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
  if (row.stage === null || row.salesChannel === null) {
    fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity was not created through a governed command and carries no lifecycle");
  }
  return row;
}

export function createOpportunity(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "opportunity.create", [COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE], input?.idempotencyKey, async (db, now) => {
    if (typeof input.accountId !== "string" || input.accountId.trim() === "") fail("ACCOUNT_REQUIRED", "INVALID_INPUT", "accountId is required");
    if ("inheritedOwner" in input) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "inheritedOwner is server-derived");
    const account = await requireTenantAccount(db, actor.tenantId, (input.accountId as string).trim());
    const { idempotencyKey: _k, accountableEmployeeId, ...fields } = input;
    const built = buildCreateOpportunity(
      { ...(fields as Record<string, unknown>), accountId: account.id, inheritedOwner: deriveEmployeeRefOwner({ ownerEmployeeId: account.ownerEmployeeId }) } as never,
      { actorUid: actor.principalId, nowMillis: now.getTime() },
    );
    await requireTenantEmployee(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
    if (built.creditedSalespersonId !== null) await requireTenantEmployee(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
    const established = await resolveCreationAccountablePerson(db, actor.tenantId, "opportunity", accountableEmployeeId, built.ownerEmployeeId);
    const number = await allocateCommercialNumber(db, actor.tenantId, "OPPORTUNITY", now);
    const id = newRecordId("opp");
    await insertOpportunity(db, actor.tenantId, actor.principalId, {
      id, number: number.number, accountId: built.accountId, ownerEmployeeId: built.ownerEmployeeId, operatingCompanyId: built.operatingCompanyId,
      salesChannel: built.salesChannel, stage: built.stage, need: built.need, expectedValue: built.expectedValue,
      expectedCloseAtMillis: built.expectedCloseAt, creditedSalespersonId: built.creditedSalespersonId, lines: built.lines,
    });
    const accountable = await stageCreationAccountablePerson(db, actor.tenantId, actor.principalId, "opportunity", id, established);
    return {
      result: { opportunityId: id, opportunityNumber: number.number, stage: built.stage, editVersion: 1, ...accountable },
      target: target(id),
    };
  });
}

/** Column for each scalar field the governed edit may change. Owner and lines are handled on their own paths. */
const UPDATE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  accountId: "account_id", creditedSalespersonId: "credited_salesperson_employee_id", salesChannel: "sales_channel", need: "need",
  expectedValue: "expected_value", expectedCloseAt: "expected_close_at", nextAction: "next_action",
});

export function updateOpportunity(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "opportunity.update", [COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE], input?.idempotencyKey, async (db, now) => {
    const current = await requireOpportunity(db, actor.tenantId, input.opportunityId);
    const expected = input.expectedEditVersion;
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1) {
      fail("EDIT_VERSION_REQUIRED", "INVALID_INPUT", "expectedEditVersion is required");
    }
    const { idempotencyKey: _k, expectedEditVersion: _v, ownershipHandoff, ...fields } = input;
    // The builder's own version comparison is satisfied here on purpose: the governing check is the SQL predicate below,
    // evaluated against the locked row, so there is exactly one place a stale write is refused.
    const { patch, changes } = buildUpdateOpportunity(
      { stage: current.stage as never, outcome: current.outcome as never, lines: current.lines, updatedAtMillis: expected as number },
      { ...(fields as Record<string, unknown>), expectedUpdatedAtMillis: expected } as never,
      { actorUid: actor.principalId, nowMillis: now.getTime() },
    );

    const sets: string[] = [];
    const values: unknown[] = [actor.tenantId, current.id, expected, actor.principalId];
    for (const [field, column] of Object.entries(UPDATE_COLUMNS)) {
      if (!(field in patch)) continue;
      let value = patch[field];
      if (field === "accountId") await requireTenantAccount(db, actor.tenantId, value as string);
      if (field === "creditedSalespersonId") await requireTenantEmployee(db, actor.tenantId, value as string, "CREDITED_SALESPERSON");
      if (field === "expectedCloseAt") value = typeof value === "number" ? new Date(value) : null;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    const bumped = await db.query(
      `UPDATE eos_commercial.opportunities SET ${[...sets, "edit_version = edit_version + 1", "updated_by = $4", "updated_at = now()"].join(", ")}
        WHERE tenant_id = $1 AND id = $2 AND edit_version = $3`,
      values,
    );
    if (bumped.rowCount !== 1) fail("VERSION_CONFLICT", "CONFLICT", "the Opportunity changed since it was read; reload and retry");

    if ("lines" in patch) await replaceOpportunityLines(db, actor.tenantId, current.id, patch.lines as never);

    let ownershipHandoffId: string | null = null;
    if ("ownerEmployeeId" in patch) {
      const newOwner = await requireTenantEmployee(db, actor.tenantId, patch.ownerEmployeeId as string, "OWNER");
      const handoff = (ownershipHandoff ?? {}) as { source?: unknown; reason?: unknown };
      const source = handoff.source ?? "DIRECT_HANDOFF";
      if (!isCommercialHandoffSource(source)) fail("HANDOFF_SOURCE_INVALID", "INVALID_INPUT", "ownershipHandoff.source is not a governed handoff source");
      const recorded = await stageCommercialOwnershipTransfer(db, actor.tenantId, actor.principalId, {
        kind: "OPPORTUNITY", recordId: current.id, newOwnerEmployeeId: newOwner, source: source as never,
        reason: typeof handoff.reason === "string" ? handoff.reason : null,
      });
      ownershipHandoffId = recorded.id;
    }
    return {
      result: { opportunityId: current.id, changed: changes.map((c) => c.field), editVersion: (expected as number) + 1, ownershipHandoffId },
      target: target(current.id),
    };
  });
}

export function transitionOpportunity(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "opportunity.transition", [COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE], input?.idempotencyKey, async (db, now) => {
    const current = await requireOpportunity(db, actor.tenantId, input.opportunityId);
    const hasStage = typeof input.toStage === "string";
    const hasOutcome = typeof input.outcome === "string";
    if (hasStage === hasOutcome) fail("TRANSITION_INVALID", "INVALID_INPUT", "exactly one of toStage or outcome is required");
    if (input.expectedEditVersion !== undefined && input.expectedEditVersion !== current.editVersion) {
      fail("VERSION_CONFLICT", "CONFLICT", "the Opportunity changed since it was read; reload and retry");
    }
    const patch = buildTransitionPatch(
      { stage: current.stage as never, outcome: current.outcome as never, lines: current.lines },
      hasStage ? { kind: "ADVANCE", toStage: input.toStage as never } : { kind: "OUTCOME", outcome: input.outcome as never },
      { actorUid: actor.principalId, nowMillis: now.getTime() },
    );
    await applyOpportunityTransition(db, actor, current.id, current.editVersion, patch.stage, patch.outcome);
    return {
      result: { opportunityId: current.id, stage: patch.stage, outcome: patch.outcome, editVersion: current.editVersion + 1 },
      target: target(current.id),
    };
  });
}

async function applyOpportunityTransition(db: Queryable, actor: CommercialActorContext, id: string, version: number, stage: string, outcome: string | null) {
  const result = await db.query(
    `UPDATE eos_commercial.opportunities
        SET stage = $4, outcome = $5, closed_at = $6, edit_version = edit_version + 1, updated_by = $7, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND edit_version = $3`,
    [actor.tenantId, id, version, stage, outcome, outcome === null ? null : new Date(), actor.principalId],
  );
  if (result.rowCount !== 1) fail("VERSION_CONFLICT", "CONFLICT", "the Opportunity changed since it was read; reload and retry");
}

/**
 * WON + its Sales Order as ONE unit: the Opportunity locked, its ACCEPTED Agreement required, the Order derived from the
 * Agreement (number, lines, owner, credit, company, Accountable Person and history), the Opportunity moved to WON.
 * The Agreement is only read. An Opportunity already WON without an Order gets its Order (recovered); one that already
 * has an Order is refused -- in PostgreSQL the two can only have been committed together.
 */
export function closeOpportunityAsWon(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "opportunity.closeAsWon",
    [COMMERCIAL_CAPABILITIES.OPPORTUNITY_WRITE, COMMERCIAL_CAPABILITIES.OPPORTUNITY_CREATE_SALES_ORDER], input?.idempotencyKey, async (db, now) => {
      const opportunity = await requireOpportunity(db, actor.tenantId, input.opportunityId);
      if (opportunity.outcome === "LOST") fail("OPPORTUNITY_LOST", "PRECONDITION_FAILED", "a LOST Opportunity cannot be closed as WON");
      if (await lockOrderForOpportunity(db, actor.tenantId, opportunity.id)) {
        fail("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Order");
      }
      const alreadyWon = opportunity.outcome === "WON";
      const patch = alreadyWon ? null : buildTransitionPatch(
        { stage: opportunity.stage as never, outcome: opportunity.outcome as never, lines: opportunity.lines },
        { kind: "OUTCOME", outcome: "WON" },
        { actorUid: actor.principalId, nowMillis: now.getTime() },
      );
      const agreement = assertConvertibleAgreement(await lockAgreementForOpportunity(db, actor.tenantId, opportunity.id), opportunity);
      const order = await stageSalesOrderFromAgreement(db, actor, now, opportunity, agreement, input as { salesChannel: unknown });
      if (patch) await applyOpportunityTransition(db, actor, opportunity.id, opportunity.editVersion, patch.stage, patch.outcome);
      return {
        result: {
          opportunityId: opportunity.id, salesOrderId: order.salesOrderId, salesOrderNumber: order.salesOrderNumber, recovered: alreadyWon,
          editVersion: patch ? opportunity.editVersion + 1 : opportunity.editVersion,
        },
        target: target(opportunity.id),
      };
    });
}

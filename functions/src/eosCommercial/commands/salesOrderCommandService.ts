// Governed PostgreSQL Sales Order commands -- wave C2. Internal services; nothing external invokes them yet.
//
// Core Commercial lifecycle only. D2 (Owner ruling) keeps execution out: no allocated / fulfilled / billed quantity,
// no inventory, no Work Order, no invoice, no service link is read or written here. Because the IN_FULFILLMENT ->
// FULFILLED step is decided by fulfilled quantities that PostgreSQL does not hold, that one step REFUSES with
// FULFILLMENT_AUTHORITY_UNAVAILABLE -- an activation prerequisite, never a guess.
import type { PoolClient } from "pg";
import { buildCreateSalesOrder, buildTransitionPatch } from "../../salesOrder/salesOrderCommands";
import { isSalesOrderState, type SalesOrderTransition } from "../../salesOrder/salesOrderLifecycle";
import { deriveSalesOrderLinesFromAgreement } from "../../salesAgreement/salesAgreementCommands";
import type { SalesAgreementState } from "../../salesAgreement/salesAgreementLifecycle";
import { deriveEmployeeRefOwner } from "../../ownership/typedOwner";
import { allocateCommercialNumber } from "../commercialNumbering";
import {
  COMMERCIAL_CAPABILITIES, fail, requireCatalogReferences, requireTenantAccount, requireTenantEmployee, runCommercialCommand,
  type CommercialActorContext, type CommercialCommandDeps,
} from "./commercialCommandKernel";
import { resolveCreationAccountablePerson, stageCreationAccountablePerson } from "./commercialCreation";
import {
  insertSalesOrder, lockAgreementForOpportunity, lockOpportunity, lockOrderForOpportunity, lockOrderState, newRecordId,
  type AgreementRow, type OpportunityRow,
} from "./commercialRecordStore";

type Queryable = Pick<PoolClient, "query">;

export interface SalesOrderCreated {
  readonly salesOrderId: string;
  readonly salesOrderNumber: string;
  readonly state: string;
  readonly accountableEmployeeId: string;
  readonly accountablePersonSource: string;
}

/** Fields a client may never supply: server-derived inheritance and lifecycle. */
const SERVER_DERIVED_ORDER_FIELDS = ["inheritedOwner", "inheritedOperatingCompanyId", "inheritedCreditedSalespersonId", "state",
  "salesOrderNumber", "bookedAtMillis", "currency"];

function refuseServerDerived(input: Record<string, unknown>, fields: readonly string[]): void {
  const present = fields.filter((f) => f in input);
  if (present.length > 0) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `server-derived fields may not be supplied: ${present.join(", ")}`);
}

/** Refuse unless the Agreement is the ACCEPTED Agreement of this Opportunity, for the same Account, with lines. */
export function assertConvertibleAgreement(agreement: AgreementRow | null, opportunity: OpportunityRow): AgreementRow {
  if (!agreement) return fail("AGREEMENT_REQUIRED", "PRECONDITION_FAILED", "an ACCEPTED Sales Agreement is required to create the Sales Order");
  if (agreement.opportunityId !== opportunity.id) fail("AGREEMENT_SOURCE_MISMATCH", "PRECONDITION_FAILED", "the Agreement belongs to a different Opportunity");
  if (agreement.accountId !== opportunity.accountId) fail("AGREEMENT_ACCOUNT_MISMATCH", "PRECONDITION_FAILED", "the Agreement is for a different Account");
  if (agreement.state !== "ACCEPTED") fail("AGREEMENT_NOT_ACCEPTED", "PRECONDITION_FAILED", "the Agreement is not ACCEPTED");
  if (agreement.lines.length === 0) fail("NO_LINES", "PRECONDITION_FAILED", "the Agreement has no lines");
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
export async function stageSalesOrderFromAgreement(
  db: Queryable, actor: CommercialActorContext, now: Date, opportunity: OpportunityRow, agreement: AgreementRow,
  input: { salesChannel: unknown; ownerEmployeeId?: unknown; locationId?: unknown; customerPO?: unknown },
): Promise<SalesOrderCreated> {
  const lines = deriveSalesOrderLinesFromAgreement({ state: agreement.state as SalesAgreementState, lines: agreement.lines as never });
  const built = buildCreateSalesOrder({
    accountId: opportunity.accountId,
    ownerEmployeeId: typeof input.ownerEmployeeId === "string" ? input.ownerEmployeeId : undefined,
    inheritedOwner: deriveEmployeeRefOwner({ ownerEmployeeId: opportunity.ownerEmployeeId }),
    inheritedOperatingCompanyId: agreement.operatingCompanyId ?? opportunity.operatingCompanyId,
    inheritedCreditedSalespersonId: agreement.creditedSalespersonId ?? opportunity.creditedSalespersonId,
    salesChannel: input.salesChannel as never,
    locationId: typeof input.locationId === "string" ? input.locationId : agreement.locationId ?? undefined,
    sourceOpportunityId: opportunity.id,
    customerPO: typeof input.customerPO === "string" ? input.customerPO : agreement.customerPO ?? undefined,
    notes: agreement.specialInstructions ?? undefined,
    lines,
  }, { actorUid: actor.principalId, nowMillis: now.getTime(), bookedAtMillis: agreement.acceptedAtMillis ?? now.getTime() });
  return stageBuiltSalesOrder(db, actor, now, built, { opportunityId: opportunity.id, salesAgreementId: agreement.id }, undefined);
}

async function stageBuiltSalesOrder(
  db: Queryable, actor: CommercialActorContext, now: Date, built: ReturnType<typeof buildCreateSalesOrder>,
  source: { opportunityId: string | null; salesAgreementId: string | null }, explicitAccountable: unknown,
): Promise<SalesOrderCreated> {
  await requireTenantAccount(db, actor.tenantId, built.accountId);
  await requireTenantEmployee(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
  await requireTenantEmployee(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
  const established = await resolveCreationAccountablePerson(db, actor.tenantId, "salesOrder", explicitAccountable, built.ownerEmployeeId);
  const number = await allocateCommercialNumber(db, actor.tenantId, "SALES_ORDER", now);
  const id = newRecordId("sor");
  await insertSalesOrder(db, actor.tenantId, actor.principalId, {
    id, number: number.number, accountId: built.accountId, opportunityId: source.opportunityId, salesAgreementId: source.salesAgreementId,
    ownerEmployeeId: built.ownerEmployeeId, operatingCompanyId: built.operatingCompanyId, salesChannel: built.salesChannel,
    creditedSalespersonId: built.creditedSalespersonId, bookedAtMillis: built.bookedAtMillis, locationId: built.locationId,
    customerPO: built.customerPO, notes: built.notes,
    lines: built.lines.map((l) => ({ kind: l.kind, ref: l.ref, businessUnitId: l.businessUnitId, orderedQty: l.orderedQty, unitPrice: l.unitPrice ?? null })),
  });
  const accountable = await stageCreationAccountablePerson(db, actor.tenantId, actor.principalId, "salesOrder", id, established);
  return { salesOrderId: id, salesOrderNumber: number.number, state: built.state, ...accountable };
}

const lineKey = (l: { kind: string; ref: string; qty: number }) => `${l.kind}:${l.ref}:${l.qty}`;
const sameMultiset = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** Direct governed create. With a source Opportunity it must be WON, same Account, identical lines, and have no Order. */
export function createSalesOrder(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesOrder.create", [COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey, async (db, now) => {
    refuseServerDerived(input, SERVER_DERIVED_ORDER_FIELDS);
    if (typeof input.ownerEmployeeId !== "string" || input.ownerEmployeeId.trim() === "") {
      fail("OWNER_REQUIRED", "INVALID_INPUT", "ownerEmployeeId is required for a direct Sales Order");
    }
    const { idempotencyKey: _k, accountableEmployeeId, sourceOpportunityId, ...fields } = input;
    const built = buildCreateSalesOrder({ ...(fields as Record<string, unknown>), sourceOpportunityId } as never,
      { actorUid: actor.principalId, nowMillis: now.getTime() });
    let opportunityId: string | null = null;
    if (typeof sourceOpportunityId === "string" && sourceOpportunityId.trim() !== "") {
      const opportunity = await lockOpportunity(db, actor.tenantId, sourceOpportunityId);
      if (!opportunity) fail("SOURCE_OPPORTUNITY_NOT_FOUND", "NOT_FOUND", "the source Opportunity does not exist in this tenant");
      if (opportunity!.outcome !== "WON") fail("OPPORTUNITY_NOT_WON", "PRECONDITION_FAILED", "the source Opportunity is not WON");
      if (opportunity!.accountId !== built.accountId) fail("SOURCE_ACCOUNT_MISMATCH", "PRECONDITION_FAILED", "the source Opportunity is for a different Account");
      const expected = opportunity!.lines.map(lineKey);
      const actual = built.lines.map((l) => lineKey({ kind: l.kind, ref: l.ref, qty: l.orderedQty }));
      if (!sameMultiset(expected, actual)) fail("SOURCE_LINES_MISMATCH", "PRECONDITION_FAILED", "the Order lines do not match the source Opportunity");
      if (await lockOrderForOpportunity(db, actor.tenantId, opportunity!.id)) {
        fail("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the source Opportunity already has a Sales Order");
      }
      opportunityId = opportunity!.id;
    }
    // A direct Order carries NEW product references: they pass the catalog authority before any number or row.
    await requireCatalogReferences(deps, db, actor.tenantId, built.lines);
    const created = await stageBuiltSalesOrder(db, actor, now, built, { opportunityId, salesAgreementId: null }, accountableEmployeeId);
    return { result: created, target: { family: "salesOrder" as const, id: created.salesOrderId } };
  });
}

/** Sales Order from an already-WON Opportunity and its ACCEPTED Agreement. Does not transition the Opportunity. */
export function createSalesOrderFromOpportunity(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesOrder.createFromOpportunity", [COMMERCIAL_CAPABILITIES.OPPORTUNITY_CREATE_SALES_ORDER],
    input?.idempotencyKey, async (db, now) => {
      if (typeof input.opportunityId !== "string") fail("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
      const opportunity = await lockOpportunity(db, actor.tenantId, input.opportunityId as string);
      if (!opportunity) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
      if (opportunity.outcome !== "WON") fail("OPPORTUNITY_NOT_WON", "PRECONDITION_FAILED", "the Opportunity is not WON");
      if (await lockOrderForOpportunity(db, actor.tenantId, opportunity.id)) {
        fail("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Order");
      }
      const agreement = assertConvertibleAgreement(await lockAgreementForOpportunity(db, actor.tenantId, opportunity.id), opportunity);
      const created = await stageSalesOrderFromAgreement(db, actor, now, opportunity, agreement, input as { salesChannel: unknown });
      return { result: { ...created, opportunityId: opportunity.id }, target: { family: "salesOrder" as const, id: created.salesOrderId } };
    });
}

/** Core lifecycle: CONFIRMED -> IN_FULFILLMENT, CANCEL before FULFILLED. The quantity-decided step refuses (D2). */
export function transitionSalesOrder(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesOrder.transition", [COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey,
    async (db, now) => {
      const transition = input.transition as SalesOrderTransition;
      if (transition !== "ADVANCE" && transition !== "CANCEL") fail("TRANSITION_INVALID", "INVALID_INPUT", "transition must be ADVANCE or CANCEL");
      const order = await lockOrderState(db, actor.tenantId, String(input.salesOrderId ?? ""));
      if (!order) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
      if (!isSalesOrderState(order.state)) return fail("ORDER_STATE_UNSET", "PRECONDITION_FAILED", "the Sales Order has no governed lifecycle state");
      if (transition === "ADVANCE" && order.state === "IN_FULFILLMENT") {
        fail("FULFILLMENT_AUTHORITY_UNAVAILABLE", "UNAVAILABLE",
          "IN_FULFILLMENT -> FULFILLED is decided by fulfilled quantities, which PostgreSQL does not govern until execution migrates (D2)");
      }
      const patch = buildTransitionPatch({ state: order.state }, transition, { actorUid: actor.principalId, nowMillis: now.getTime() });
      await db.query(
        `UPDATE eos_commercial.sales_orders SET state = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, order.id, patch.state, actor.principalId],
      );
      return { result: { salesOrderId: order.id, state: patch.state }, target: { family: "salesOrder" as const, id: order.id } };
    });
}

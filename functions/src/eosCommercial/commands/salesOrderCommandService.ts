// Governed PostgreSQL Sales Order commands -- wave C2. Reached only through the C4 transport (commercialHttp.ts).
//
// Core Commercial lifecycle only. D2 (Owner ruling) keeps execution out: no allocated / billed quantity, no inventory, no
// Work Order, no invoice is read or written here. The IN_FULFILLMENT -> FULFILLED step is decided by FULFILLED QUANTITIES,
// which PostgreSQL now governs (DQ-015, DECISIONS #195): eos_commercial.sales_order_fulfillments, written only by the
// Commercial fulfillment authority from Work Order completion. ADVANCE from IN_FULFILLMENT is allowed exactly when every
// line is fully fulfilled -- the Owner-ratified allLinesFulfilled gate -- and refused otherwise. Never a guess.
import type { PoolClient } from "pg";
import { buildCreateSalesOrder, buildTransitionPatch } from "../../salesOrder/salesOrderCommands";
import { isSalesOrderState, type SalesOrderTransition } from "../../salesOrder/salesOrderLifecycle";
import { deriveSalesOrderLinesFromAgreement } from "../../salesAgreement/salesAgreementCommands";
import type { SalesAgreementState } from "../../salesAgreement/salesAgreementLifecycle";
import { deriveEmployeeRefOwner } from "../../ownership/typedOwner";
import { allocateCommercialNumber } from "../commercialNumbering";
import {
  COMMERCIAL_CAPABILITIES, fail, requireAccountLocation, requireActiveSalesChannel, requireActiveTenantAccount, requireCatalogReferences, requireTenantAccount, requireTenantEmployee, runCommercialCommand,
  type CommercialActorContext, type CommercialCommandDeps,
} from "./commercialCommandKernel";
import { resolveCreationAccountablePerson, stageCreationAccountablePerson } from "./commercialCreation";
import { salesOrderFulfillmentLines, salesOrderFullyFulfilled } from "../fulfillment/salesOrderFulfillmentAuthority";
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
 * ONE CHAIN, ONE CHANNEL (Pass 10 P10-4). A Sales Order sourced from an Opportunity carries that Opportunity's stored
 * sales channel: an omitted channel is inherited, and a different one is refused -- a caller could otherwise file a
 * NATIONAL chain's Order under RETAIL and expose its lineage to a RETAIL-scoped reader. An Opportunity with no stored
 * channel (an identity-only record) imposes nothing: the caller's channel is validated as before.
 */
export function salesChannelFromSource(opportunity: OpportunityRow, requested: unknown): unknown {
  if (opportunity.salesChannel === null) return requested;
  if (requested !== undefined && requested !== null && requested !== opportunity.salesChannel) {
    fail("SALES_CHANNEL_MISMATCH", "PRECONDITION_FAILED", "a Sales Order carries its source Opportunity's sales channel");
  }
  return opportunity.salesChannel;
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
    salesChannel: salesChannelFromSource(opportunity, input.salesChannel) as never,
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
  await requireAccountLocation(db, actor.tenantId, built.accountId, built.locationId);
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
  return runCommercialCommand(deps, actor, "salesOrder.create", [COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey, async (db, now, scope) => {
    refuseServerDerived(input, SERVER_DERIVED_ORDER_FIELDS);
    if (typeof input.ownerEmployeeId !== "string" || input.ownerEmployeeId.trim() === "") {
      fail("OWNER_REQUIRED", "INVALID_INPUT", "ownerEmployeeId is required for a direct Sales Order");
    }
    const { idempotencyKey: _k, accountableEmployeeId, sourceOpportunityId, ...fields } = input;
    const built = buildCreateSalesOrder({ ...(fields as Record<string, unknown>), sourceOpportunityId } as never,
      { actorUid: actor.principalId, nowMillis: now.getTime() });
    // DQ-020: the channel it is created in -- which, with a source Opportunity, must equal that Opportunity's (below).
    scope.admitChannel(built.salesChannel);
    let opportunityId: string | null = null;
    if (typeof sourceOpportunityId === "string" && sourceOpportunityId.trim() !== "") {
      const opportunity = await lockOpportunity(db, actor.tenantId, sourceOpportunityId);
      if (!opportunity) fail("SOURCE_OPPORTUNITY_NOT_FOUND", "NOT_FOUND", "the source Opportunity does not exist in this tenant");
      if (opportunity!.outcome !== "WON") fail("OPPORTUNITY_NOT_WON", "PRECONDITION_FAILED", "the source Opportunity is not WON");
      if (opportunity!.accountId !== built.accountId) fail("SOURCE_ACCOUNT_MISMATCH", "PRECONDITION_FAILED", "the source Opportunity is for a different Account");
      salesChannelFromSource(opportunity!, built.salesChannel);
      const expected = opportunity!.lines.map(lineKey);
      const actual = built.lines.map((l) => lineKey({ kind: l.kind, ref: l.ref, qty: l.orderedQty }));
      if (!sameMultiset(expected, actual)) fail("SOURCE_LINES_MISMATCH", "PRECONDITION_FAILED", "the Order lines do not match the source Opportunity");
      if (await lockOrderForOpportunity(db, actor.tenantId, opportunity!.id)) {
        fail("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the source Opportunity already has a Sales Order");
      }
      opportunityId = opportunity!.id;
    }
    // A direct Order with no source Opportunity is NEW Commercial work: its customer must be ACTIVE (DQ-5). With a WON
    // source it continues that Opportunity's lifecycle, which a later customer status never rewrites.
    if (opportunityId === null) {
      await requireActiveTenantAccount(db, actor.tenantId, built.accountId);
      await requireActiveSalesChannel(db, actor.tenantId, built.salesChannel);
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
    input?.idempotencyKey, async (db, now, scope) => {
      if (typeof input.opportunityId !== "string") fail("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
      const opportunity = await lockOpportunity(db, actor.tenantId, input.opportunityId as string);
      if (!opportunity) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
      scope.admitChannel(opportunity.salesChannel);
      if (opportunity.outcome !== "WON") fail("OPPORTUNITY_NOT_WON", "PRECONDITION_FAILED", "the Opportunity is not WON");
      if (await lockOrderForOpportunity(db, actor.tenantId, opportunity.id)) {
        fail("SALES_ORDER_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Order");
      }
      const agreement = assertConvertibleAgreement(await lockAgreementForOpportunity(db, actor.tenantId, opportunity.id), opportunity);
      const created = await stageSalesOrderFromAgreement(db, actor, now, opportunity, agreement, input as { salesChannel: unknown });
      return { result: { ...created, opportunityId: opportunity.id }, target: { family: "salesOrder" as const, id: created.salesOrderId } };
    });
}

/** Core lifecycle: CONFIRMED -> IN_FULFILLMENT -> FULFILLED (only when every line is fulfilled), CANCEL before FULFILLED. */
export function transitionSalesOrder(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesOrder.transition", [COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey,
    async (db, now, scope) => {
      const transition = input.transition as SalesOrderTransition;
      if (transition !== "ADVANCE" && transition !== "CANCEL") fail("TRANSITION_INVALID", "INVALID_INPUT", "transition must be ADVANCE or CANCEL");
      const order = await lockOrderState(db, actor.tenantId, String(input.salesOrderId ?? ""));
      if (!order) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
      scope.admitChannel(order.salesChannel); // DQ-020: its stored channel
      if (!isSalesOrderState(order.state)) return fail("ORDER_STATE_UNSET", "PRECONDITION_FAILED", "the Sales Order has no governed lifecycle state");
      if (transition === "ADVANCE" && order.state === "IN_FULFILLMENT" && !(await salesOrderFullyFulfilled(db, actor.tenantId, order.id))) {
        fail("SALES_ORDER_NOT_FULLY_FULFILLED", "PRECONDITION_FAILED",
          "IN_FULFILLMENT -> FULFILLED is decided by fulfilled quantities: a line still has quantity the governed fulfillment has not covered");
      }
      // The Owner-ratified lifecycle gate (allLinesFulfilled) reads the DERIVED fulfilled quantities -- the same truth as above.
      const lines = await salesOrderFulfillmentLines(db, actor.tenantId, order.id);
      const patch = buildTransitionPatch({ state: order.state, lines } as never, transition, { actorUid: actor.principalId, nowMillis: now.getTime() });
      await db.query(
        `UPDATE eos_commercial.sales_orders SET state = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, order.id, patch.state, actor.principalId],
      );
      return { result: { salesOrderId: order.id, state: patch.state }, target: { family: "salesOrder" as const, id: order.id } };
    }, { family: "salesOrder", id: input?.salesOrderId });
}

/**
 * FBR-F2 (Finance Closure, DECISIONS #206): the SELLER authorizes another operating company to PERFORM SERVICE on its Sales
 * Order -- e.g. Ventana sells equipment to an outside customer and authorizes Taylor Service to deliver / install
 * (INSTALLATION) or service (SERVICE) it. The seller stays the seller: the Sales Order, its fulfillment record's company, its
 * billing package and its receivable all remain Ventana's; Taylor's Work Order is Taylor's (the service-performing company).
 * This is the ONLY cross-company Work Order relationship: without an ACTIVE authorization naming the Work Order's company and
 * scope, SALES_ORDER_COMPANY_MISMATCH still refuses. Authorized by the Sales Order's own edit authority (salesOrder.write, in
 * its channel scope). Revocable; history kept.
 */
export function authorizeSalesOrderServiceProvider(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesOrder.authorizeServiceProvider", [COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey,
    async (db, _now, scope) => {
      for (const k of Object.keys(input ?? {})) {
        if (!["idempotencyKey", "salesOrderId", "serviceOperatingCompanyId", "scopes", "reason"].includes(k)) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
      }
      const order = await lockOrderState(db, actor.tenantId, String(input.salesOrderId ?? ""));
      if (!order) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
      scope.admitChannel(order.salesChannel);
      if (order.state === "CANCELLED") fail("ORDER_CANCELLED", "PRECONDITION_FAILED", "a cancelled Sales Order authorizes no service");
      const scopes = Array.isArray(input.scopes) ? [...new Set(input.scopes as unknown[])] : [];
      if (scopes.length === 0 || scopes.some((s) => s !== "INSTALLATION" && s !== "SERVICE")) {
        fail("SERVICE_SCOPES_INVALID", "INVALID_INPUT", "scopes is a non-empty list of INSTALLATION and / or SERVICE");
      }
      if (typeof input.reason !== "string" || input.reason.trim() === "") fail("REASON_REQUIRED", "INVALID_INPUT", "an authorization states its reason");
      const { rows: so } = await db.query(`SELECT operating_company_key FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, order.id]);
      const { rows: key } = await db.query(`SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys
        WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`, [actor.tenantId, String(input.serviceOperatingCompanyId ?? "")]);
      const serviceKey = key[0]?.operating_company_key ?? fail("SERVICE_COMPANY_UNKNOWN", "PRECONDITION_FAILED", "the service company is not an active operating company");
      if (serviceKey === so[0].operating_company_key) fail("SERVICE_COMPANY_IS_SELLER", "PRECONDITION_FAILED", "the seller needs no authorization to service its own Sales Order");
      await db.query(
        `INSERT INTO eos_commercial.sales_order_service_providers (tenant_id, sales_order_id, service_operating_company_key, scopes, status, reason, authorized_by)
         VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6)
         ON CONFLICT (tenant_id, sales_order_id, service_operating_company_key) DO UPDATE SET scopes = EXCLUDED.scopes, status = 'ACTIVE', reason = EXCLUDED.reason,
           authorized_by = EXCLUDED.authorized_by, authorized_at = now(), revoked_by = NULL, revoked_at = NULL, revoke_reason = NULL`,
        [actor.tenantId, order.id, serviceKey, scopes, (input.reason as string).trim(), actor.principalId]);
      return { result: { salesOrderId: order.id, serviceOperatingCompanyKey: serviceKey, scopes, status: "ACTIVE" }, target: { family: "salesOrder" as const, id: order.id } };
    }, { family: "salesOrder", id: input?.salesOrderId });
}

export function revokeSalesOrderServiceProvider(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesOrder.revokeServiceProvider", [COMMERCIAL_CAPABILITIES.SALES_ORDER_WRITE], input?.idempotencyKey,
    async (db, _now, scope) => {
      const order = await lockOrderState(db, actor.tenantId, String(input.salesOrderId ?? ""));
      if (!order) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
      scope.admitChannel(order.salesChannel);
      if (typeof input.reason !== "string" || input.reason.trim() === "") fail("REASON_REQUIRED", "INVALID_INPUT", "a revocation states its reason");
      const { rowCount } = await db.query(
        `UPDATE eos_commercial.sales_order_service_providers p SET status = 'REVOKED', revoked_by = $4, revoked_at = now(), revoke_reason = $5
           FROM eos_policy.tenant_operating_company_keys k
          WHERE p.tenant_id = $1 AND p.sales_order_id = $2 AND k.tenant_id = p.tenant_id AND k.operating_company_id = $3 AND k.status = 'ACTIVE'
            AND p.service_operating_company_key = k.operating_company_key AND p.status = 'ACTIVE'`,
        [actor.tenantId, order.id, String(input.serviceOperatingCompanyId ?? ""), actor.principalId, (input.reason as string).trim()]);
      if (!rowCount) fail("SERVICE_PROVIDER_NOT_AUTHORIZED", "NOT_FOUND", "no active service-provider authorization for that company");
      return { result: { salesOrderId: order.id, status: "REVOKED" }, target: { family: "salesOrder" as const, id: order.id } };
    }, { family: "salesOrder", id: input?.salesOrderId });
}

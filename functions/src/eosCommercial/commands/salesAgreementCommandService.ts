// Governed PostgreSQL Sales Agreement commands -- wave C2. Internal services; nothing external invokes them yet.
//
// Validation is the existing pure builders' (salesAgreementCommands.ts). Totals are never stored: C1 keeps only the
// charge inputs, and subtotal / total / balance are computed from lines and charges when read. Acceptance metadata is
// written only by accept, from the governed command context -- never from a client-supplied accepted_by.
import type { PoolClient } from "pg";
import {
  buildAcceptSalesAgreement, buildCreateSalesAgreement, buildUpdateSalesAgreementDraft, computeAgreementTotals,
} from "../../salesAgreement/salesAgreementCommands";
import { allocateCommercialNumber } from "../commercialNumbering";
import {
  COMMERCIAL_CAPABILITIES, fail, requireCatalogReferences, requireTenantAccount, requireTenantEmployee, runCommercialCommand,
  type CommercialActorContext, type CommercialCommandDeps,
} from "./commercialCommandKernel";
import { resolveCreationAccountablePerson, stageCreationAccountablePerson } from "./commercialCreation";
import { lockAgreement, lockAgreementForOpportunity, lockOpportunity, newRecordId, replaceAgreementLines, type AgreementRow } from "./commercialRecordStore";

type Queryable = Pick<PoolClient, "query">;
const target = (id: string) => ({ family: "salesAgreement" as const, id });

const CREATE_FORBIDDEN = ["accountId", "sourceOpportunityId", "state", "salesAgreementNumber", "salesOrderId", "acceptedByUid",
  "acceptedAtMillis", "acceptedBy", "acceptedAt", "currency", "totals", "inheritedOperatingCompanyId", "inheritedCreditedSalespersonId"];
const ACCEPT_FORBIDDEN = ["state", "acceptedAtMillis", "acceptedByUid", "acceptedAt", "acceptedBy", "lines", "totals"];

function refuseFields(input: Record<string, unknown>, fields: readonly string[]): void {
  const present = fields.filter((f) => f in input);
  if (present.length > 0) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `these fields are server-derived and may not be supplied: ${present.join(", ")}`);
}

const agreementLineRows = (lines: readonly { kind: string; ref: string; businessUnitId: string; quantity: number; unitPrice: number | null;
  condition: string | null; warranty: string | null; estimatedArrivalMillis: number | null }[]) =>
  lines.map((l) => ({ kind: l.kind as never, ref: l.ref, businessUnitId: l.businessUnitId, quantity: l.quantity, unitPrice: l.unitPrice,
    condition: l.condition, warranty: l.warranty, estimatedArrivalMillis: l.estimatedArrivalMillis }));

async function requireAgreement(db: Queryable, tenantId: string, id: unknown): Promise<AgreementRow> {
  if (typeof id !== "string" || id.trim() === "") fail("AGREEMENT_REQUIRED", "INVALID_INPUT", "salesAgreementId is required");
  const row = await lockAgreement(db, tenantId, id as string);
  if (!row) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Agreement does not exist in this tenant");
  if (row.state === null) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Agreement was not created through a governed command and carries no lifecycle");
  return row;
}

export function createSalesAgreement(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesAgreement.create", [COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_CREATE], input?.idempotencyKey,
    async (db, now) => {
      refuseFields(input, CREATE_FORBIDDEN);
      if (typeof input.opportunityId !== "string" || input.opportunityId.trim() === "") fail("OPPORTUNITY_REQUIRED", "INVALID_INPUT", "opportunityId is required");
      const opportunity = await lockOpportunity(db, actor.tenantId, input.opportunityId as string);
      if (!opportunity) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
      if (opportunity.stage === null) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity carries no governed lifecycle");
      if (opportunity.outcome === "LOST") fail("OPPORTUNITY_LOST", "PRECONDITION_FAILED", "a LOST Opportunity cannot receive a Sales Agreement");
      if (await lockAgreementForOpportunity(db, actor.tenantId, opportunity.id)) {
        fail("AGREEMENT_ALREADY_EXISTS", "CONFLICT", "the Opportunity already has a Sales Agreement");
      }
      const { idempotencyKey: _k, opportunityId: _o, accountableEmployeeId, ...fields } = input;
      const built = buildCreateSalesAgreement({
        ...(fields as Record<string, unknown>),
        accountId: opportunity.accountId,
        sourceOpportunityId: opportunity.id,
        inheritedOperatingCompanyId: opportunity.operatingCompanyId,
        inheritedCreditedSalespersonId: opportunity.creditedSalespersonId,
      } as never, { actorUid: actor.principalId, nowMillis: now.getTime() });
      await requireTenantAccount(db, actor.tenantId, built.accountId);
      await requireTenantEmployee(db, actor.tenantId, built.ownerEmployeeId, "OWNER");
      await requireTenantEmployee(db, actor.tenantId, built.creditedSalespersonId, "CREDITED_SALESPERSON");
      await requireCatalogReferences(deps, db, actor.tenantId, built.lines);
      const established = await resolveCreationAccountablePerson(db, actor.tenantId, "salesAgreement", accountableEmployeeId, built.ownerEmployeeId);
      const number = await allocateCommercialNumber(db, actor.tenantId, "SALES_AGREEMENT", now);
      const id = newRecordId("sag");
      await db.query(
        `INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, opportunity_id, owner_employee_id,
           operating_company_key, state, currency, credited_salesperson_employee_id, location_id, customer_po, is_lease, fulfillment_intent,
           shipping_instructions, ship_via, special_instructions, shipping_minor, install_charge_minor, tax_minor, down_payment_minor,
           trade_in_minor, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT','USD',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)`,
        [id, actor.tenantId, number.number, built.accountId, opportunity.id, built.ownerEmployeeId, built.operatingCompanyId,
          built.creditedSalespersonId, built.locationId, built.customerPO, built.isLease, built.fulfillmentIntent, built.shippingInstructions,
          built.shipVia, built.specialInstructions, built.totals.shippingMinor, built.totals.installChargeMinor, built.totals.taxMinor,
          built.totals.downPaymentMinor, built.totals.tradeInMinor, actor.principalId],
      );
      await replaceAgreementLines(db, actor.tenantId, id, agreementLineRows(built.lines));
      const accountable = await stageCreationAccountablePerson(db, actor.tenantId, actor.principalId, "salesAgreement", id, established);
      return {
        result: { salesAgreementId: id, salesAgreementNumber: number.number, opportunityId: opportunity.id, state: "DRAFT", ...accountable },
        target: target(id),
      };
    });
}

/** Firestore draft-patch field -> column. `lines` and `totals` are handled on their own. */
const DRAFT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  locationId: "location_id", creditedSalespersonId: "credited_salesperson_employee_id", customerPO: "customer_po", isLease: "is_lease",
  fulfillmentIntent: "fulfillment_intent", shippingInstructions: "shipping_instructions", shipVia: "ship_via",
  specialInstructions: "special_instructions",
});
const CHARGE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  shippingMinor: "shipping_minor", installChargeMinor: "install_charge_minor", taxMinor: "tax_minor",
  downPaymentMinor: "down_payment_minor", tradeInMinor: "trade_in_minor",
});

export function updateSalesAgreementDraft(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesAgreement.updateDraft", [COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_UPDATE_DRAFT],
    input?.idempotencyKey, async (db, now) => {
      const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
      const { idempotencyKey: _k, salesAgreementId: _a, ...fields } = input;
      const patch = buildUpdateSalesAgreementDraft(
        { state: current.state as never, lines: current.lines as never, totals: computeAgreementTotals(current.lines as never, current.charges) },
        fields as never,
        { actorUid: actor.principalId, nowMillis: now.getTime() },
      );
      const changed = Object.keys(fields);
      const values: unknown[] = [actor.tenantId, current.id, actor.principalId];
      const sets: string[] = [];
      for (const [field, column] of Object.entries(DRAFT_COLUMNS)) {
        if (!(field in patch)) continue;
        if (field === "creditedSalespersonId") await requireTenantEmployee(db, actor.tenantId, patch[field] as string, "CREDITED_SALESPERSON");
        values.push(patch[field]);
        sets.push(`${column} = $${values.length}`);
      }
      const totals = patch.totals as Record<string, number> | undefined;
      if (totals) {
        for (const [field, column] of Object.entries(CHARGE_COLUMNS)) {
          values.push(totals[field]);
          sets.push(`${column} = $${values.length}`);
        }
      }
      const lines = (patch.lines as AgreementRow["lines"] | undefined) ?? current.lines;
      await requireCatalogReferences(deps, db, actor.tenantId, lines);
      await db.query(
        `UPDATE eos_commercial.sales_agreements SET ${[...sets, "updated_by = $3", "updated_at = now()"].join(", ")}
          WHERE tenant_id = $1 AND id = $2 AND state = 'DRAFT'`,
        values,
      );
      if (patch.lines) await replaceAgreementLines(db, actor.tenantId, current.id, agreementLineRows(patch.lines as AgreementRow["lines"]));
      return { result: { salesAgreementId: current.id, changed }, target: target(current.id) };
    });
}

export function acceptSalesAgreement(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  return runCommercialCommand(deps, actor, "salesAgreement.accept", [COMMERCIAL_CAPABILITIES.SALES_AGREEMENT_ACCEPT], input?.idempotencyKey,
    async (db, now) => {
      refuseFields(input, ACCEPT_FORBIDDEN);
      const current = await requireAgreement(db, actor.tenantId, input.salesAgreementId);
      buildAcceptSalesAgreement(
        { state: current.state as never, lines: current.lines as never, operatingCompanyId: current.operatingCompanyId },
        { actorUid: actor.principalId, nowMillis: now.getTime() },
      );
      await requireCatalogReferences(deps, db, actor.tenantId, current.lines);
      const accepted = await db.query<{ accepted_at: Date }>(
        `UPDATE eos_commercial.sales_agreements SET state = 'ACCEPTED', accepted_at = $3, accepted_by = $4, updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND state = 'DRAFT' RETURNING accepted_at`,
        [actor.tenantId, current.id, now, actor.principalId],
      );
      if (accepted.rowCount !== 1) fail("ILLEGAL_TRANSITION", "PRECONDITION_FAILED", "only a DRAFT Sales Agreement can be accepted");
      return {
        result: { salesAgreementId: current.id, state: "ACCEPTED", acceptedAt: accepted.rows[0].accepted_at.toISOString(), acceptedBy: actor.principalId },
        target: target(current.id),
      };
    });
}

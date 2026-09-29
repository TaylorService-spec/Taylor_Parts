// SQL for the governed Commercial command services -- wave C2. Reads lock the row they return (FOR UPDATE) because
// every caller is about to decide something from it inside its transaction. No business rule lives here.
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { resolveOperatingCompanyKeyForCompany } from "../../eosOps/operatingCompanyBinding";
import { fail } from "./commercialCommandKernel";

type Queryable = Pick<PoolClient, "query">;
const S = "eos_commercial";
export const newRecordId = (prefix: "opp" | "sag" | "sor"): string => `${prefix}_${randomUUID()}`;
const millis = (d: Date | null): number | null => (d === null ? null : d.getTime());
const toTimestamp = (ms: number | null | undefined): Date | null => (typeof ms === "number" ? new Date(ms) : null);

// ════════════════════ Operating company: id in, KEY stored, id out ════════════════════
//
// `operating_company_key` holds an operating company KEY. Commands speak the governed operating company ID. The two are
// different vocabularies and cross ONLY through the governed binding (eos_policy.tenant_operating_company_keys, both
// the binding and the company ACTIVE) -- never by assuming the literal values are equal. Writes resolve the key inside
// the command's transaction and refuse an unkeyed company (OPERATING_COMPANY_KEY_NOT_BOUND); reads map the stored key
// back to its company through the same binding.

/**
 * The governed key for a company a NEW record is booked to, or null when the record states no company.
 *
 * Called only on CREATE (every insert below); an existing record's company is never re-resolved or remapped.
 * DQ-008 (Controller 2026-09-28): a new Commercial record may be booked only to an ACTIVE governed operating company of
 * THIS tenant -- an INACTIVE one refuses OPERATING_COMPANY_INACTIVE and one this tenant does not govern refuses
 * OPERATING_COMPANY_NOT_GOVERNED, before the key binding is consulted (whose own refusal stays
 * OPERATING_COMPANY_KEY_NOT_BOUND for an ACTIVE company with no ACTIVE key). Historical records are untouched.
 */
export async function operatingCompanyKeyFor(db: Queryable, tenantId: string, operatingCompanyId: string | null): Promise<string | null> {
  if (operatingCompanyId === null) return null;
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2`,
    [tenantId, operatingCompanyId],
  );
  if (rows.length === 0) {
    fail("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `operating company '${operatingCompanyId}' is not governed in this tenant`);
  }
  if (rows[0].status !== "ACTIVE") {
    fail("OPERATING_COMPANY_INACTIVE", "PRECONDITION_FAILED", `operating company '${operatingCompanyId}' is not ACTIVE; a new Commercial record cannot be booked to it`);
  }
  return resolveOperatingCompanyKeyForCompany(db, tenantId, operatingCompanyId);
}

/** SQL: the ACTIVE company bound to a record's stored key (`alias` is the record table's alias). */
export const operatingCompanyIdOfKey = (alias: string): string =>
  `(SELECT k.operating_company_id FROM eos_policy.tenant_operating_company_keys k
     WHERE k.tenant_id = ${alias}.tenant_id AND k.operating_company_key = ${alias}.operating_company_key AND k.status = 'ACTIVE')`;

// ════════════════════ Opportunity ════════════════════

export interface OpportunityLineRow { kind: "EQUIPMENT_MODEL" | "PART" | "SERVICE"; ref: string; qty: number }
export interface OpportunityRow {
  id: string; number: string; accountId: string; ownerEmployeeId: string; operatingCompanyId: string | null;
  salesChannel: string | null; stage: string | null; outcome: string | null; closedAtMillis: number | null;
  need: string | null; expectedValue: number | null; expectedCloseAtMillis: number | null; nextAction: string | null;
  creditedSalespersonId: string | null; accountableEmployeeId: string | null; editVersion: number; lines: OpportunityLineRow[];
}

export async function lockOpportunity(db: Queryable, tenantId: string, id: string): Promise<OpportunityRow | null> {
  const { rows } = await db.query(
    `SELECT o.id, o.opportunity_number, o.account_id, o.owner_employee_id, ${operatingCompanyIdOfKey("o")} AS operating_company_id,
            o.sales_channel::text, o.stage::text, o.outcome::text, o.closed_at, o.need, o.expected_value::float8 AS expected_value,
            o.expected_close_at, o.next_action, o.credited_salesperson_employee_id, o.accountable_employee_id, o.edit_version
       FROM ${S}.opportunities o WHERE o.tenant_id = $1 AND o.id = $2 FOR UPDATE OF o`,
    [tenantId, id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const lines = await db.query(
    `SELECT kind::text, ref, qty FROM ${S}.opportunity_lines WHERE tenant_id = $1 AND opportunity_id = $2 ORDER BY line_number`,
    [tenantId, id],
  );
  return {
    id: r.id, number: r.opportunity_number, accountId: r.account_id, ownerEmployeeId: r.owner_employee_id,
    operatingCompanyId: r.operating_company_id, salesChannel: r.sales_channel, stage: r.stage, outcome: r.outcome,
    closedAtMillis: millis(r.closed_at), need: r.need, expectedValue: r.expected_value, expectedCloseAtMillis: millis(r.expected_close_at),
    nextAction: r.next_action, creditedSalespersonId: r.credited_salesperson_employee_id, accountableEmployeeId: r.accountable_employee_id,
    editVersion: Number(r.edit_version), lines: lines.rows.map((l) => ({ kind: l.kind, ref: l.ref, qty: l.qty })),
  };
}

export async function insertOpportunity(db: Queryable, tenantId: string, actorId: string, o: {
  id: string; number: string; accountId: string; ownerEmployeeId: string; operatingCompanyId: string | null; salesChannel: string;
  stage: string; need: string | null; expectedValue: number | null; expectedCloseAtMillis: number | null;
  creditedSalespersonId: string | null; lines: readonly OpportunityLineRow[];
}): Promise<void> {
  await db.query(
    `INSERT INTO ${S}.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, operating_company_key,
       sales_channel, stage, need, expected_value, expected_close_at, credited_salesperson_employee_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [o.id, tenantId, o.number, o.accountId, o.ownerEmployeeId, await operatingCompanyKeyFor(db, tenantId, o.operatingCompanyId), o.salesChannel, o.stage, o.need,
      o.expectedValue, toTimestamp(o.expectedCloseAtMillis), o.creditedSalespersonId, actorId],
  );
  await replaceOpportunityLines(db, tenantId, o.id, o.lines);
}

export async function replaceOpportunityLines(db: Queryable, tenantId: string, id: string, lines: readonly OpportunityLineRow[]): Promise<void> {
  await db.query(`DELETE FROM ${S}.opportunity_lines WHERE tenant_id = $1 AND opportunity_id = $2`, [tenantId, id]);
  for (const [i, l] of lines.entries()) {
    await db.query(
      `INSERT INTO ${S}.opportunity_lines (tenant_id, opportunity_id, line_number, kind, ref, qty) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, id, i + 1, l.kind, l.ref, l.qty],
    );
  }
}

// ════════════════════ Sales Agreement ════════════════════

export interface AgreementLineRow {
  lineId: string; kind: "EQUIPMENT_MODEL" | "PART" | "SERVICE"; ref: string; businessUnitId: string; quantity: number;
  unitPrice: number | null; condition: string | null; warranty: string | null; estimatedArrivalMillis: number | null;
  extendedMinor: number | null;
}
export interface AgreementRow {
  id: string; number: string; accountId: string; opportunityId: string | null; ownerEmployeeId: string; operatingCompanyId: string | null;
  state: string | null; creditedSalespersonId: string | null; locationId: string | null; customerPO: string | null; isLease: boolean | null;
  fulfillmentIntent: string | null; shippingInstructions: string | null; shipVia: string | null; specialInstructions: string | null;
  charges: { shippingMinor: number; installChargeMinor: number; taxMinor: number; downPaymentMinor: number; tradeInMinor: number };
  acceptedAtMillis: number | null; lines: AgreementLineRow[];
}

const agreementSelect = `SELECT a.id, a.sales_agreement_number, a.account_id, a.opportunity_id, a.owner_employee_id,
  ${operatingCompanyIdOfKey("a")} AS operating_company_id, a.state::text,
  a.credited_salesperson_employee_id, a.location_id, a.customer_po, a.is_lease, a.fulfillment_intent::text, a.shipping_instructions, a.ship_via,
  a.special_instructions, a.shipping_minor, a.install_charge_minor, a.tax_minor, a.down_payment_minor, a.trade_in_minor, a.accepted_at
  FROM ${S}.sales_agreements a`;

async function agreementFrom(db: Queryable, tenantId: string, r: Record<string, any>): Promise<AgreementRow> {
  const lines = await db.query(
    `SELECT line_number, kind::text, ref, business_unit::text, quantity, unit_price_minor, condition::text, warranty, estimated_arrival_at
       FROM ${S}.sales_agreement_lines WHERE tenant_id = $1 AND sales_agreement_id = $2 ORDER BY line_number`,
    [tenantId, r.id],
  );
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    id: r.id, number: r.sales_agreement_number, accountId: r.account_id, opportunityId: r.opportunity_id, ownerEmployeeId: r.owner_employee_id,
    operatingCompanyId: r.operating_company_id, state: r.state, creditedSalespersonId: r.credited_salesperson_employee_id,
    locationId: r.location_id, customerPO: r.customer_po, isLease: r.is_lease, fulfillmentIntent: r.fulfillment_intent,
    shippingInstructions: r.shipping_instructions, shipVia: r.ship_via, specialInstructions: r.special_instructions,
    charges: { shippingMinor: n(r.shipping_minor), installChargeMinor: n(r.install_charge_minor), taxMinor: n(r.tax_minor),
      downPaymentMinor: n(r.down_payment_minor), tradeInMinor: n(r.trade_in_minor) },
    acceptedAtMillis: millis(r.accepted_at),
    lines: lines.rows.map((l) => {
      const unitPrice = l.unit_price_minor === null ? null : Number(l.unit_price_minor);
      return {
        lineId: `line-${l.line_number}`, kind: l.kind, ref: l.ref, businessUnitId: l.business_unit, quantity: l.quantity, unitPrice,
        condition: l.condition, warranty: l.warranty, estimatedArrivalMillis: millis(l.estimated_arrival_at),
        extendedMinor: unitPrice === null ? null : l.quantity * unitPrice,
      };
    }),
  };
}

export async function lockAgreement(db: Queryable, tenantId: string, id: string): Promise<AgreementRow | null> {
  const { rows } = await db.query(`${agreementSelect} WHERE a.tenant_id = $1 AND a.id = $2 FOR UPDATE OF a`, [tenantId, id]);
  return rows.length === 0 ? null : agreementFrom(db, tenantId, rows[0]);
}

export async function lockAgreementForOpportunity(db: Queryable, tenantId: string, opportunityId: string): Promise<AgreementRow | null> {
  const { rows } = await db.query(`${agreementSelect} WHERE a.tenant_id = $1 AND a.opportunity_id = $2 FOR UPDATE OF a`, [tenantId, opportunityId]);
  return rows.length === 0 ? null : agreementFrom(db, tenantId, rows[0]);
}

export async function replaceAgreementLines(db: Queryable, tenantId: string, id: string, lines: readonly Omit<AgreementLineRow, "lineId" | "extendedMinor">[]): Promise<void> {
  await db.query(`DELETE FROM ${S}.sales_agreement_lines WHERE tenant_id = $1 AND sales_agreement_id = $2`, [tenantId, id]);
  for (const [i, l] of lines.entries()) {
    await db.query(
      `INSERT INTO ${S}.sales_agreement_lines (tenant_id, sales_agreement_id, line_number, kind, ref, business_unit, quantity,
         unit_price_minor, condition, warranty, estimated_arrival_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tenantId, id, i + 1, l.kind, l.ref, l.businessUnitId, l.quantity, l.unitPrice, l.condition, l.warranty, toTimestamp(l.estimatedArrivalMillis)],
    );
  }
}

// ════════════════════ Sales Order ════════════════════

export interface OrderLineRow { kind: string; ref: string; businessUnitId: string; orderedQty: number; unitPrice: number | null }

export async function lockOrderForOpportunity(db: Queryable, tenantId: string, opportunityId: string): Promise<{ id: string } | null> {
  const { rows } = await db.query(`SELECT id FROM ${S}.sales_orders WHERE tenant_id = $1 AND opportunity_id = $2 FOR UPDATE`, [tenantId, opportunityId]);
  return rows[0] ?? null;
}

export async function lockOrderState(db: Queryable, tenantId: string, id: string): Promise<{ id: string; state: string | null } | null> {
  const { rows } = await db.query(`SELECT id, state::text FROM ${S}.sales_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  return rows[0] ?? null;
}

export async function insertSalesOrder(db: Queryable, tenantId: string, actorId: string, o: {
  id: string; number: string; accountId: string; opportunityId: string | null; salesAgreementId: string | null; ownerEmployeeId: string;
  operatingCompanyId: string; salesChannel: string; creditedSalespersonId: string; bookedAtMillis: number; locationId: string | null;
  customerPO: string | null; notes: string | null; lines: readonly OrderLineRow[];
}): Promise<void> {
  await db.query(
    `INSERT INTO ${S}.sales_orders (id, tenant_id, sales_order_number, account_id, opportunity_id, sales_agreement_id, owner_employee_id,
       operating_company_key, state, sales_channel, currency, credited_salesperson_employee_id, booked_at, location_id, customer_po, notes,
       created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CONFIRMED',$9,'USD',$10,$11,$12,$13,$14,$15,$15)`,
    [o.id, tenantId, o.number, o.accountId, o.opportunityId, o.salesAgreementId, o.ownerEmployeeId,
      await operatingCompanyKeyFor(db, tenantId, o.operatingCompanyId), o.salesChannel,
      o.creditedSalespersonId, new Date(o.bookedAtMillis), o.locationId, o.customerPO, o.notes, actorId],
  );
  for (const [i, l] of o.lines.entries()) {
    await db.query(
      `INSERT INTO ${S}.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, o.id, i + 1, l.kind, l.ref, l.businessUnitId, l.orderedQty, l.unitPrice],
    );
  }
}

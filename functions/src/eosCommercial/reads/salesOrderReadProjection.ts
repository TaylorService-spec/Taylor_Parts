// Governed PostgreSQL Sales Order read projections -- wave C3. Internal; nothing external invokes them yet.
//
// CORE COMMERCIAL FACTS ONLY. D2 execution stays deferred (Owner ruling D2, option a), so this projection carries no
// allocated / fulfilled / billed quantity, allocation or reservation state, service Work Order lineage, invoice
// write-back or fulfillment readiness: PostgreSQL holds no such authority and nothing here pretends it does.
// Lineage is derived from the Order's own foreign keys (opportunity_id, sales_agreement_id).
// Pricing follows the rule the Firestore reader already defines (salesOrderReadService.ts projectSalesOrder): a total
// exists only when EVERY line carries a committed price, because a partial sum is not the sale.
import { SALES_ORDER_STATES } from "../../salesOrder/salesOrderLifecycle";
import { fail } from "../commands/commercialCommandKernel";
import {
  COMMERCIAL_READ_CAPABILITIES, decodeCommercialCursor, isoOf, minorOf, optionalAccountId, pageOf, personOf, requireEnumFilter,
  requirePageSize, requireRecordId, runCommercialRead, type CommercialPersonReference, type CommercialReadActor, type CommercialReadDeps,
  type Queryable,
} from "./commercialReadKernel";
import type { CommercialLineageReference, CommercialPage } from "./opportunityReadProjection";

export interface SalesOrderLineProjection {
  readonly lineNumber: number;
  readonly kind: string;
  readonly ref: string;
  readonly businessUnit: string;
  readonly orderedQty: number;
  readonly unitPriceMinor: number | null;
  readonly extendedMinor: number | null;
}

export type SalesOrderPricingState = "PRICED" | "PARTIALLY_PRICED" | "UNPRICED" | "NO_LINES";

export interface SalesOrderPricingProjection {
  readonly pricingState: SalesOrderPricingState;
  readonly totalMinor: number | null;
  readonly unpricedLineCount: number;
}

export interface SalesOrderSummaryProjection extends SalesOrderPricingProjection {
  readonly id: string;
  readonly salesOrderNumber: string;
  readonly opportunityId: string | null;
  readonly salesAgreementId: string | null;
  readonly accountId: string;
  readonly accountName: string | null;
  readonly owner: CommercialPersonReference;
  readonly accountablePerson: CommercialPersonReference | null;
  readonly creditedSalesperson: CommercialPersonReference | null;
  readonly operatingCompanyId: string | null;
  readonly state: string;
  readonly salesChannel: string;
  readonly currency: string;
  readonly bookedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly SalesOrderLineProjection[];
}

export interface SalesOrderDetailProjection extends SalesOrderSummaryProjection {
  readonly location: { readonly locationId: string; readonly name: string | null } | null;
  readonly customerPO: string | null;
  readonly notes: string | null;
  readonly sourceOpportunity: CommercialLineageReference | null;
  readonly sourceAgreement: CommercialLineageReference | null;
}

/** Every governed Order create writes all four; C1 leaves them nullable only for identity-only rows. */
export const SALES_ORDER_IS_COMPLETE = "s.state IS NOT NULL AND s.sales_channel IS NOT NULL AND s.currency IS NOT NULL AND s.booked_at IS NOT NULL";

/** The Firestore reader's pricing rule, over PostgreSQL lines. */
export function salesOrderPricingOf(lines: readonly { extendedMinor: number | null }[]): SalesOrderPricingProjection {
  const unpricedLineCount = lines.filter((l) => l.extendedMinor === null).length;
  const pricingState: SalesOrderPricingState =
    lines.length === 0 ? "NO_LINES" : unpricedLineCount === 0 ? "PRICED" : unpricedLineCount === lines.length ? "UNPRICED" : "PARTIALLY_PRICED";
  return {
    pricingState,
    totalMinor: pricingState === "PRICED" ? lines.reduce((n, l) => n + (l.extendedMinor as number), 0) : null,
    unpricedLineCount,
  };
}

const SUMMARY_COLUMNS = `s.id, s.sales_order_number, s.opportunity_id, s.sales_agreement_id, s.account_id, acc.name AS account_name,
  s.operating_company_key, s.state::text AS state, s.sales_channel::text AS sales_channel, s.currency, s.booked_at, s.created_at, s.updated_at,
  s.owner_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = s.tenant_id AND e.id = s.owner_employee_id) AS owner_resolved,
  s.accountable_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = s.tenant_id AND e.id = s.accountable_employee_id) AS accountable_resolved,
  s.credited_salesperson_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = s.tenant_id AND e.id = s.credited_salesperson_employee_id) AS credited_resolved`;

type Row = Record<string, any> & { id: string };

async function linesByOrder(db: Queryable, tenantId: string, ids: readonly string[]): Promise<Map<string, SalesOrderLineProjection[]>> {
  const out = new Map<string, SalesOrderLineProjection[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `SELECT sales_order_id, line_number, kind::text AS kind, ref, business_unit::text AS business_unit, ordered_qty, unit_price_minor
       FROM eos_commercial.sales_order_lines
      WHERE tenant_id = $1 AND sales_order_id = ANY($2::text[]) ORDER BY sales_order_id, line_number`,
    [tenantId, ids],
  );
  for (const l of rows) {
    const unitPriceMinor = minorOf(l.unit_price_minor);
    out.get(l.sales_order_id)!.push({
      lineNumber: l.line_number, kind: l.kind, ref: l.ref, businessUnit: l.business_unit, orderedQty: l.ordered_qty, unitPriceMinor,
      extendedMinor: unitPriceMinor === null ? null : l.ordered_qty * unitPriceMinor,
    });
  }
  return out;
}

function summaryOf(r: Row, lines: readonly SalesOrderLineProjection[]): SalesOrderSummaryProjection {
  return {
    id: r.id, salesOrderNumber: r.sales_order_number, opportunityId: r.opportunity_id, salesAgreementId: r.sales_agreement_id,
    accountId: r.account_id, accountName: r.account_name ?? null,
    owner: personOf(r.owner_employee_id, r.owner_resolved)!,
    accountablePerson: personOf(r.accountable_employee_id, r.accountable_resolved),
    creditedSalesperson: personOf(r.credited_salesperson_employee_id, r.credited_resolved),
    operatingCompanyId: r.operating_company_key, state: r.state, salesChannel: r.sales_channel, currency: r.currency,
    bookedAt: isoOf(r.booked_at)!, createdAt: isoOf(r.created_at)!, updatedAt: isoOf(r.updated_at)!,
    ...salesOrderPricingOf(lines), lines,
  };
}

export function getSalesOrderDetail(deps: CommercialReadDeps, actor: CommercialReadActor, input: Record<string, unknown>): Promise<SalesOrderDetailProjection> {
  return runCommercialRead(deps, actor, [COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ], () => requireRecordId(input?.salesOrderId, "salesOrderId"),
    async (db, tenantId, salesOrderId) => {
      const { rows } = await db.query(
        `SELECT ${SUMMARY_COLUMNS}, (${SALES_ORDER_IS_COMPLETE}) AS complete,
                s.location_id, loc.name AS location_name, s.customer_po, s.notes,
                o.opportunity_number, o.stage::text AS opportunity_stage,
                a.sales_agreement_number AS agreement_number, a.state::text AS agreement_state
           FROM eos_commercial.sales_orders s
           LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = s.tenant_id AND acc.id = s.account_id
           LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = s.tenant_id AND loc.account_id = s.account_id AND loc.id = s.location_id
           LEFT JOIN eos_commercial.opportunities o ON o.tenant_id = s.tenant_id AND o.id = s.opportunity_id
           LEFT JOIN eos_commercial.sales_agreements a ON a.tenant_id = s.tenant_id AND a.id = s.sales_agreement_id
          WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, salesOrderId],
      );
      if (rows.length === 0) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
      const r = rows[0] as Row;
      if (!r.complete) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Order was not created through a governed command and carries no lifecycle");
      const lines = await linesByOrder(db, tenantId, [r.id]);
      return {
        ...summaryOf(r, lines.get(r.id)!),
        location: r.location_id === null ? null : { locationId: r.location_id, name: r.location_name ?? null },
        customerPO: r.customer_po, notes: r.notes,
        sourceOpportunity: r.opportunity_id === null || r.opportunity_number === null ? null
          : { id: r.opportunity_id, number: r.opportunity_number, state: r.opportunity_stage },
        sourceAgreement: r.sales_agreement_id === null || r.agreement_number === null ? null
          : { id: r.sales_agreement_id, number: r.agreement_number, state: r.agreement_state },
      };
    });
}

export interface SalesOrderListOptions {
  readonly limit: number;
  readonly accountId: string | null;
  readonly state: string[] | null;
  readonly cursor: { number: string; id: string } | null;
}

export function prepareSalesOrderList(input: Record<string, unknown> | undefined): SalesOrderListOptions {
  return {
    limit: requirePageSize(input?.limit),
    accountId: optionalAccountId(input?.accountId),
    state: requireEnumFilter(input?.state, "state", SALES_ORDER_STATES),
    cursor: decodeCommercialCursor("salesOrder", input?.cursor),
  };
}

export async function readSalesOrderPage(db: Queryable, tenantId: string, o: SalesOrderListOptions): Promise<CommercialPage<SalesOrderSummaryProjection>> {
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM eos_commercial.sales_orders s
       LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = s.tenant_id AND acc.id = s.account_id
      WHERE s.tenant_id = $1 AND ${SALES_ORDER_IS_COMPLETE}
        AND ($2::text IS NULL OR s.account_id = $2)
        AND ($3::text[] IS NULL OR s.state::text = ANY($3::text[]))
        AND ($4::text IS NULL OR (s.sales_order_number, s.id) < ($4::text, $5::text))
      ORDER BY s.sales_order_number DESC, s.id DESC
      LIMIT $6`,
    [tenantId, o.accountId, o.state, o.cursor?.number ?? null, o.cursor?.id ?? null, o.limit + 1],
  );
  const kept = (rows as Row[]).slice(0, o.limit);
  const lines = await linesByOrder(db, tenantId, kept.map((r) => r.id));
  return pageOf("salesOrder", rows as Row[], o.limit, (r) => r.sales_order_number, (r) => summaryOf(r, lines.get(r.id)!));
}

export function listSalesOrders(deps: CommercialReadDeps, actor: CommercialReadActor, input?: Record<string, unknown>): Promise<CommercialPage<SalesOrderSummaryProjection>> {
  return runCommercialRead(deps, actor, [COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ], () => prepareSalesOrderList(input),
    (db, tenantId, options) => readSalesOrderPage(db, tenantId, options));
}

// Governed PostgreSQL Opportunity read projections -- wave C3. Reached only through the C4 transport (commercialHttp.ts).
//
// Truthful C1 facts only. Deliberately NOT reproduced from the Firestore reader (opportunityReadService.ts):
//   * `name` -- projected there but never persisted by any writer, so it was always null;
//   * `createdAtMillis` / `updatedAtMillis` -- client-clock copies; the concurrency token is `editVersion`;
//   * `salesAgreementId` / `salesOrderId` backlink fields -- the lineage here is DERIVED from the children's foreign
//     keys (sales_agreements.opportunity_id, sales_orders.opportunity_id), never stored on the Opportunity;
//   * getOpportunityContext's `salesOrderNumber` lookup against a "salesOrders" collection that no writer uses.
// Identity-only spine rows (no lifecycle) are not business records: the detail refuses RECORD_INCOMPLETE and the
// list excludes them.
import { OPPORTUNITY_STAGES } from "../../opportunity/opportunityLifecycle";
import { fail } from "../commands/commercialCommandKernel";
import {
  COMMERCIAL_READ_CAPABILITIES, decodeCommercialCursor, isoOf, optionalAccountId, pageOf, personOf, requireEnumFilter, requirePageSize,
  requireRecordId, runCommercialRead, type CommercialPersonReference, type CommercialReadActor, type CommercialReadDeps, type Queryable,
} from "./commercialReadKernel";

export interface OpportunityLineProjection {
  readonly lineNumber: number;
  readonly kind: string;
  readonly ref: string;
  readonly qty: number;
}

export interface CommercialLineageReference {
  readonly id: string;
  readonly number: string;
  /** Null when the related row is itself an identity-only record with no lifecycle. */
  readonly state: string | null;
}

export interface OpportunitySummaryProjection {
  readonly id: string;
  readonly opportunityNumber: string;
  readonly accountId: string;
  /** eos_crm.accounts.name in this tenant; null when no PostgreSQL Account row answers. */
  readonly accountName: string | null;
  readonly owner: CommercialPersonReference;
  readonly accountablePerson: CommercialPersonReference | null;
  readonly creditedSalesperson: CommercialPersonReference | null;
  readonly operatingCompanyId: string | null;
  readonly salesChannel: string;
  readonly stage: string;
  readonly outcome: string | null;
  readonly need: string | null;
  readonly expectedValue: number | null;
  readonly expectedCloseAt: string | null;
  readonly nextAction: string | null;
  readonly closedAt: string | null;
  readonly editVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly OpportunityLineProjection[];
}

export interface OpportunityDetailProjection extends OpportunitySummaryProjection {
  readonly salesAgreement: CommercialLineageReference | null;
  readonly salesOrder: CommercialLineageReference | null;
}

/** The lifecycle columns C1 left nullable for historical identity-only rows. Every governed create writes both. */
export const OPPORTUNITY_IS_COMPLETE = "o.stage IS NOT NULL AND o.sales_channel IS NOT NULL";

const SUMMARY_COLUMNS = `o.id, o.opportunity_number, o.account_id, acc.name AS account_name, o.operating_company_key,
  o.sales_channel::text AS sales_channel, o.stage::text AS stage, o.outcome::text AS outcome, o.need,
  o.expected_value::float8 AS expected_value, o.expected_close_at, o.next_action, o.closed_at, o.edit_version, o.created_at, o.updated_at,
  o.owner_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = o.tenant_id AND e.id = o.owner_employee_id) AS owner_resolved,
  o.accountable_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = o.tenant_id AND e.id = o.accountable_employee_id) AS accountable_resolved,
  o.credited_salesperson_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = o.tenant_id AND e.id = o.credited_salesperson_employee_id) AS credited_resolved`;

type Row = Record<string, any> & { id: string };

async function linesByOpportunity(db: Queryable, tenantId: string, ids: readonly string[]): Promise<Map<string, OpportunityLineProjection[]>> {
  const out = new Map<string, OpportunityLineProjection[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `SELECT opportunity_id, line_number, kind::text AS kind, ref, qty FROM eos_commercial.opportunity_lines
      WHERE tenant_id = $1 AND opportunity_id = ANY($2::text[]) ORDER BY opportunity_id, line_number`,
    [tenantId, ids],
  );
  for (const l of rows) out.get(l.opportunity_id)!.push({ lineNumber: l.line_number, kind: l.kind, ref: l.ref, qty: l.qty });
  return out;
}

function summaryOf(r: Row, lines: readonly OpportunityLineProjection[]): OpportunitySummaryProjection {
  return {
    id: r.id, opportunityNumber: r.opportunity_number, accountId: r.account_id, accountName: r.account_name ?? null,
    owner: personOf(r.owner_employee_id, r.owner_resolved)!,
    accountablePerson: personOf(r.accountable_employee_id, r.accountable_resolved),
    creditedSalesperson: personOf(r.credited_salesperson_employee_id, r.credited_resolved),
    operatingCompanyId: r.operating_company_key, salesChannel: r.sales_channel, stage: r.stage, outcome: r.outcome, need: r.need,
    expectedValue: r.expected_value, expectedCloseAt: isoOf(r.expected_close_at), nextAction: r.next_action, closedAt: isoOf(r.closed_at),
    editVersion: Number(r.edit_version), createdAt: isoOf(r.created_at)!, updatedAt: isoOf(r.updated_at)!, lines,
  };
}

export function getOpportunityDetail(deps: CommercialReadDeps, actor: CommercialReadActor, input: Record<string, unknown>): Promise<OpportunityDetailProjection> {
  return runCommercialRead(deps, actor, [COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ], () => requireRecordId(input?.opportunityId, "opportunityId"),
    async (db, tenantId, opportunityId) => {
      const { rows } = await db.query(
        `SELECT ${SUMMARY_COLUMNS}, (${OPPORTUNITY_IS_COMPLETE}) AS complete,
                sa.id AS agreement_id, sa.sales_agreement_number AS agreement_number, sa.state::text AS agreement_state,
                so.id AS order_id, so.sales_order_number AS order_number, so.state::text AS order_state
           FROM eos_commercial.opportunities o
           LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = o.tenant_id AND acc.id = o.account_id
           LEFT JOIN eos_commercial.sales_agreements sa ON sa.tenant_id = o.tenant_id AND sa.opportunity_id = o.id
           LEFT JOIN eos_commercial.sales_orders so ON so.tenant_id = o.tenant_id AND so.opportunity_id = o.id
          WHERE o.tenant_id = $1 AND o.id = $2`,
        [tenantId, opportunityId],
      );
      if (rows.length === 0) return fail("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
      const r = rows[0] as Row;
      if (!r.complete) fail("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity was not created through a governed command and carries no lifecycle");
      const lines = await linesByOpportunity(db, tenantId, [r.id]);
      return {
        ...summaryOf(r, lines.get(r.id)!),
        salesAgreement: r.agreement_id === null ? null : { id: r.agreement_id, number: r.agreement_number, state: r.agreement_state },
        salesOrder: r.order_id === null ? null : { id: r.order_id, number: r.order_number, state: r.order_state },
      };
    });
}

export interface CommercialPage<Item> {
  readonly items: Item[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

export interface OpportunityListOptions {
  readonly limit: number;
  readonly accountId: string | null;
  readonly stage: string[] | null;
  readonly cursor: { number: string; id: string } | null;
}

export function prepareOpportunityList(input: Record<string, unknown> | undefined): OpportunityListOptions {
  return {
    limit: requirePageSize(input?.limit),
    accountId: optionalAccountId(input?.accountId),
    stage: requireEnumFilter(input?.stage, "stage", OPPORTUNITY_STAGES),
    cursor: decodeCommercialCursor("opportunity", input?.cursor),
  };
}

/** Complete Opportunities of this tenant, newest business number first, bounded; used by the list and the Account projection. */
export async function readOpportunityPage(db: Queryable, tenantId: string, o: OpportunityListOptions): Promise<CommercialPage<OpportunitySummaryProjection>> {
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM eos_commercial.opportunities o
       LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = o.tenant_id AND acc.id = o.account_id
      WHERE o.tenant_id = $1 AND ${OPPORTUNITY_IS_COMPLETE}
        AND ($2::text IS NULL OR o.account_id = $2)
        AND ($3::text[] IS NULL OR o.stage::text = ANY($3::text[]))
        AND ($4::text IS NULL OR (o.opportunity_number, o.id) < ($4::text, $5::text))
      ORDER BY o.opportunity_number DESC, o.id DESC
      LIMIT $6`,
    [tenantId, o.accountId, o.stage, o.cursor?.number ?? null, o.cursor?.id ?? null, o.limit + 1],
  );
  const kept = (rows as Row[]).slice(0, o.limit);
  const lines = await linesByOpportunity(db, tenantId, kept.map((r) => r.id));
  return pageOf("opportunity", rows as Row[], o.limit, (r) => r.opportunity_number, (r) => summaryOf(r, lines.get(r.id)!));
}

export function listOpportunities(deps: CommercialReadDeps, actor: CommercialReadActor, input?: Record<string, unknown>): Promise<CommercialPage<OpportunitySummaryProjection>> {
  return runCommercialRead(deps, actor, [COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ], () => prepareOpportunityList(input),
    (db, tenantId, options) => readOpportunityPage(db, tenantId, options));
}

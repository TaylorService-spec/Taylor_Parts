"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPPORTUNITY_IS_COMPLETE = void 0;
exports.getOpportunityDetail = getOpportunityDetail;
exports.prepareOpportunityList = prepareOpportunityList;
exports.readOpportunityPage = readOpportunityPage;
exports.listOpportunities = listOpportunities;
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
const opportunityLifecycle_1 = require("../../opportunity/opportunityLifecycle");
const commercialCommandKernel_1 = require("../commands/commercialCommandKernel");
const commercialReadKernel_1 = require("./commercialReadKernel");
/** The lifecycle columns C1 left nullable for historical identity-only rows. Every governed create writes both. */
exports.OPPORTUNITY_IS_COMPLETE = "o.stage IS NOT NULL AND o.sales_channel IS NOT NULL";
const SUMMARY_COLUMNS = `o.id, o.opportunity_number, o.account_id, acc.name AS account_name, o.operating_company_key,
  o.sales_channel::text AS sales_channel, o.stage::text AS stage, o.outcome::text AS outcome, o.need,
  o.expected_value::float8 AS expected_value, o.expected_close_at, o.next_action, o.closed_at, o.edit_version, o.created_at, o.updated_at,
  o.owner_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = o.tenant_id AND e.id = o.owner_employee_id) AS owner_resolved,
  o.accountable_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = o.tenant_id AND e.id = o.accountable_employee_id) AS accountable_resolved,
  o.credited_salesperson_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = o.tenant_id AND e.id = o.credited_salesperson_employee_id) AS credited_resolved`;
async function linesByOpportunity(db, tenantId, ids) {
    const out = new Map(ids.map((id) => [id, []]));
    if (ids.length === 0)
        return out;
    const { rows } = await db.query(`SELECT opportunity_id, line_number, kind::text AS kind, ref, qty FROM eos_commercial.opportunity_lines
      WHERE tenant_id = $1 AND opportunity_id = ANY($2::text[]) ORDER BY opportunity_id, line_number`, [tenantId, ids]);
    for (const l of rows)
        out.get(l.opportunity_id).push({ lineNumber: l.line_number, kind: l.kind, ref: l.ref, qty: l.qty });
    return out;
}
function summaryOf(r, lines) {
    return {
        id: r.id, opportunityNumber: r.opportunity_number, accountId: r.account_id, accountName: r.account_name ?? null,
        owner: (0, commercialReadKernel_1.personOf)(r.owner_employee_id, r.owner_resolved),
        accountablePerson: (0, commercialReadKernel_1.personOf)(r.accountable_employee_id, r.accountable_resolved),
        creditedSalesperson: (0, commercialReadKernel_1.personOf)(r.credited_salesperson_employee_id, r.credited_resolved),
        operatingCompanyId: r.operating_company_key, salesChannel: r.sales_channel, stage: r.stage, outcome: r.outcome, need: r.need,
        expectedValue: r.expected_value, expectedCloseAt: (0, commercialReadKernel_1.isoOf)(r.expected_close_at), nextAction: r.next_action, closedAt: (0, commercialReadKernel_1.isoOf)(r.closed_at),
        editVersion: Number(r.edit_version), createdAt: (0, commercialReadKernel_1.isoOf)(r.created_at), updatedAt: (0, commercialReadKernel_1.isoOf)(r.updated_at), lines,
    };
}
function getOpportunityDetail(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ], () => (0, commercialReadKernel_1.requireRecordId)(input?.opportunityId, "opportunityId"), async (db, tenantId, opportunityId) => {
        const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS}, (${exports.OPPORTUNITY_IS_COMPLETE}) AS complete,
                sa.id AS agreement_id, sa.sales_agreement_number AS agreement_number, sa.state::text AS agreement_state,
                so.id AS order_id, so.sales_order_number AS order_number, so.state::text AS order_state
           FROM eos_commercial.opportunities o
           LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = o.tenant_id AND acc.id = o.account_id
           LEFT JOIN eos_commercial.sales_agreements sa ON sa.tenant_id = o.tenant_id AND sa.opportunity_id = o.id
           LEFT JOIN eos_commercial.sales_orders so ON so.tenant_id = o.tenant_id AND so.opportunity_id = o.id
          WHERE o.tenant_id = $1 AND o.id = $2`, [tenantId, opportunityId]);
        if (rows.length === 0)
            return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Opportunity does not exist in this tenant");
        const r = rows[0];
        if (!r.complete)
            (0, commercialCommandKernel_1.fail)("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Opportunity was not created through a governed command and carries no lifecycle");
        const lines = await linesByOpportunity(db, tenantId, [r.id]);
        return {
            ...summaryOf(r, lines.get(r.id)),
            salesAgreement: r.agreement_id === null ? null : { id: r.agreement_id, number: r.agreement_number, state: r.agreement_state },
            salesOrder: r.order_id === null ? null : { id: r.order_id, number: r.order_number, state: r.order_state },
        };
    });
}
function prepareOpportunityList(input) {
    return {
        limit: (0, commercialReadKernel_1.requirePageSize)(input?.limit),
        accountId: (0, commercialReadKernel_1.optionalAccountId)(input?.accountId),
        stage: (0, commercialReadKernel_1.requireEnumFilter)(input?.stage, "stage", opportunityLifecycle_1.OPPORTUNITY_STAGES),
        cursor: (0, commercialReadKernel_1.decodeCommercialCursor)("opportunity", input?.cursor),
    };
}
/** Complete Opportunities of this tenant, newest business number first, bounded; used by the list and the Account projection. */
async function readOpportunityPage(db, tenantId, o) {
    const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS}
       FROM eos_commercial.opportunities o
       LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = o.tenant_id AND acc.id = o.account_id
      WHERE o.tenant_id = $1 AND ${exports.OPPORTUNITY_IS_COMPLETE}
        AND ($2::text IS NULL OR o.account_id = $2)
        AND ($3::text[] IS NULL OR o.stage::text = ANY($3::text[]))
        AND ($4::text IS NULL OR (o.opportunity_number, o.id) < ($4::text, $5::text))
      ORDER BY o.opportunity_number DESC, o.id DESC
      LIMIT $6`, [tenantId, o.accountId, o.stage, o.cursor?.number ?? null, o.cursor?.id ?? null, o.limit + 1]);
    const kept = rows.slice(0, o.limit);
    const lines = await linesByOpportunity(db, tenantId, kept.map((r) => r.id));
    return (0, commercialReadKernel_1.pageOf)("opportunity", rows, o.limit, (r) => r.opportunity_number, (r) => summaryOf(r, lines.get(r.id)));
}
function listOpportunities(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ], () => prepareOpportunityList(input), (db, tenantId, options) => readOpportunityPage(db, tenantId, options));
}
//# sourceMappingURL=opportunityReadProjection.js.map
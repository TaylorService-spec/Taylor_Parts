"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_ORDER_IS_COMPLETE = void 0;
exports.salesOrderPricingOf = salesOrderPricingOf;
exports.getSalesOrderDetail = getSalesOrderDetail;
exports.prepareSalesOrderList = prepareSalesOrderList;
exports.readSalesOrderPage = readSalesOrderPage;
exports.listSalesOrders = listSalesOrders;
// Governed PostgreSQL Sales Order read projections -- wave C3. Reached only through the C4 transport (commercialHttp.ts).
//
// CORE COMMERCIAL FACTS ONLY. D2 execution stays deferred (Owner ruling D2, option a), so this projection carries no
// allocated / fulfilled / billed quantity, allocation or reservation state, service Work Order lineage, invoice
// write-back or fulfillment readiness: PostgreSQL holds no such authority and nothing here pretends it does.
// Lineage is derived from the Order's own foreign keys (opportunity_id, sales_agreement_id).
// Pricing follows the rule the Firestore reader already defines (salesOrderReadService.ts projectSalesOrder): a total
// exists only when EVERY line carries a committed price, because a partial sum is not the sale.
const salesOrderLifecycle_1 = require("../../salesOrder/salesOrderLifecycle");
const commercialCommandKernel_1 = require("../commands/commercialCommandKernel");
const commercialReadKernel_1 = require("./commercialReadKernel");
/** Every governed Order create writes all four; C1 leaves them nullable only for identity-only rows. */
exports.SALES_ORDER_IS_COMPLETE = "s.state IS NOT NULL AND s.sales_channel IS NOT NULL AND s.currency IS NOT NULL AND s.booked_at IS NOT NULL";
/** The Firestore reader's pricing rule, over PostgreSQL lines. */
function salesOrderPricingOf(lines) {
    const unpricedLineCount = lines.filter((l) => l.extendedMinor === null).length;
    const pricingState = lines.length === 0 ? "NO_LINES" : unpricedLineCount === 0 ? "PRICED" : unpricedLineCount === lines.length ? "UNPRICED" : "PARTIALLY_PRICED";
    return {
        pricingState,
        totalMinor: pricingState === "PRICED" ? lines.reduce((n, l) => n + l.extendedMinor, 0) : null,
        unpricedLineCount,
    };
}
const SUMMARY_COLUMNS = `s.id, s.sales_order_number, s.opportunity_id, s.sales_agreement_id, s.account_id, acc.name AS account_name,
  s.operating_company_key, s.state::text AS state, s.sales_channel::text AS sales_channel, s.currency, s.booked_at, s.created_at, s.updated_at,
  s.owner_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = s.tenant_id AND e.id = s.owner_employee_id) AS owner_resolved,
  s.accountable_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = s.tenant_id AND e.id = s.accountable_employee_id) AS accountable_resolved,
  s.credited_salesperson_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = s.tenant_id AND e.id = s.credited_salesperson_employee_id) AS credited_resolved`;
async function linesByOrder(db, tenantId, ids) {
    const out = new Map(ids.map((id) => [id, []]));
    if (ids.length === 0)
        return out;
    const { rows } = await db.query(`SELECT sales_order_id, line_number, kind::text AS kind, ref, business_unit::text AS business_unit, ordered_qty, unit_price_minor
       FROM eos_commercial.sales_order_lines
      WHERE tenant_id = $1 AND sales_order_id = ANY($2::text[]) ORDER BY sales_order_id, line_number`, [tenantId, ids]);
    for (const l of rows) {
        const unitPriceMinor = (0, commercialReadKernel_1.minorOf)(l.unit_price_minor);
        out.get(l.sales_order_id).push({
            lineNumber: l.line_number, kind: l.kind, ref: l.ref, businessUnit: l.business_unit, orderedQty: l.ordered_qty, unitPriceMinor,
            extendedMinor: unitPriceMinor === null ? null : l.ordered_qty * unitPriceMinor,
        });
    }
    return out;
}
function summaryOf(r, lines) {
    return {
        id: r.id, salesOrderNumber: r.sales_order_number, opportunityId: r.opportunity_id, salesAgreementId: r.sales_agreement_id,
        accountId: r.account_id, accountName: r.account_name ?? null,
        owner: (0, commercialReadKernel_1.personOf)(r.owner_employee_id, r.owner_resolved),
        accountablePerson: (0, commercialReadKernel_1.personOf)(r.accountable_employee_id, r.accountable_resolved),
        creditedSalesperson: (0, commercialReadKernel_1.personOf)(r.credited_salesperson_employee_id, r.credited_resolved),
        operatingCompanyId: r.operating_company_key, state: r.state, salesChannel: r.sales_channel, currency: r.currency,
        bookedAt: (0, commercialReadKernel_1.isoOf)(r.booked_at), createdAt: (0, commercialReadKernel_1.isoOf)(r.created_at), updatedAt: (0, commercialReadKernel_1.isoOf)(r.updated_at),
        ...salesOrderPricingOf(lines), lines,
    };
}
function getSalesOrderDetail(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ], () => (0, commercialReadKernel_1.requireRecordId)(input?.salesOrderId, "salesOrderId"), async (db, tenantId, salesOrderId) => {
        const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS}, (${exports.SALES_ORDER_IS_COMPLETE}) AS complete,
                s.location_id, loc.name AS location_name, s.customer_po, s.notes,
                o.opportunity_number, o.stage::text AS opportunity_stage,
                a.sales_agreement_number AS agreement_number, a.state::text AS agreement_state
           FROM eos_commercial.sales_orders s
           LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = s.tenant_id AND acc.id = s.account_id
           LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = s.tenant_id AND loc.account_id = s.account_id AND loc.id = s.location_id
           LEFT JOIN eos_commercial.opportunities o ON o.tenant_id = s.tenant_id AND o.id = s.opportunity_id
           LEFT JOIN eos_commercial.sales_agreements a ON a.tenant_id = s.tenant_id AND a.id = s.sales_agreement_id
          WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, salesOrderId]);
        if (rows.length === 0)
            return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Order does not exist in this tenant");
        const r = rows[0];
        if (!r.complete)
            (0, commercialCommandKernel_1.fail)("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Order was not created through a governed command and carries no lifecycle");
        const lines = await linesByOrder(db, tenantId, [r.id]);
        return {
            ...summaryOf(r, lines.get(r.id)),
            location: r.location_id === null ? null : { locationId: r.location_id, name: r.location_name ?? null },
            customerPO: r.customer_po, notes: r.notes,
            sourceOpportunity: r.opportunity_id === null || r.opportunity_number === null ? null
                : { id: r.opportunity_id, number: r.opportunity_number, state: r.opportunity_stage },
            sourceAgreement: r.sales_agreement_id === null || r.agreement_number === null ? null
                : { id: r.sales_agreement_id, number: r.agreement_number, state: r.agreement_state },
        };
    });
}
function prepareSalesOrderList(input) {
    return {
        limit: (0, commercialReadKernel_1.requirePageSize)(input?.limit),
        accountId: (0, commercialReadKernel_1.optionalAccountId)(input?.accountId),
        state: (0, commercialReadKernel_1.requireEnumFilter)(input?.state, "state", salesOrderLifecycle_1.SALES_ORDER_STATES),
        cursor: (0, commercialReadKernel_1.decodeCommercialCursor)("salesOrder", input?.cursor),
    };
}
async function readSalesOrderPage(db, tenantId, o) {
    const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS}
       FROM eos_commercial.sales_orders s
       LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = s.tenant_id AND acc.id = s.account_id
      WHERE s.tenant_id = $1 AND ${exports.SALES_ORDER_IS_COMPLETE}
        AND ($2::text IS NULL OR s.account_id = $2)
        AND ($3::text[] IS NULL OR s.state::text = ANY($3::text[]))
        AND ($4::text IS NULL OR (s.sales_order_number, s.id) < ($4::text, $5::text))
      ORDER BY s.sales_order_number DESC, s.id DESC
      LIMIT $6`, [tenantId, o.accountId, o.state, o.cursor?.number ?? null, o.cursor?.id ?? null, o.limit + 1]);
    const kept = rows.slice(0, o.limit);
    const lines = await linesByOrder(db, tenantId, kept.map((r) => r.id));
    return (0, commercialReadKernel_1.pageOf)("salesOrder", rows, o.limit, (r) => r.sales_order_number, (r) => summaryOf(r, lines.get(r.id)));
}
function listSalesOrders(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ], () => prepareSalesOrderList(input), (db, tenantId, options) => readSalesOrderPage(db, tenantId, options));
}
//# sourceMappingURL=salesOrderReadProjection.js.map
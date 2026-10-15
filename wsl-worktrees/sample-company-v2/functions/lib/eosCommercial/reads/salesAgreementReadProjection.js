"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_AGREEMENT_IS_COMPLETE = void 0;
exports.getSalesAgreementDetail = getSalesAgreementDetail;
exports.prepareSalesAgreementList = prepareSalesAgreementList;
exports.readSalesAgreementPage = readSalesAgreementPage;
exports.listSalesAgreements = listSalesAgreements;
// Governed PostgreSQL Sales Agreement read projections -- wave C3. Reached only through the C4 transport (commercialHttp.ts).
//
// Totals are NOT stored (C1 keeps only the charge inputs): subtotal / total / balance are computed at read time by the
// existing governed arithmetic, computeAgreementTotals, from the stored lines and charges -- never a second stored
// answer. Acceptance is projected as PostgreSQL holds it: accepted_at and accepted_by (a governed EOS principal id,
// not a Firebase uid), which the C1 CHECK constraint keeps present exactly when state is ACCEPTED.
// Lineage is derived from foreign keys: the source Opportunity from sales_agreements.opportunity_id, the resulting
// Sales Order from sales_orders.sales_agreement_id -- never a stored backlink.
const salesAgreementLifecycle_1 = require("../../salesAgreement/salesAgreementLifecycle");
const salesAgreementCommands_1 = require("../../salesAgreement/salesAgreementCommands");
const commercialCommandKernel_1 = require("../commands/commercialCommandKernel");
const commercialReadKernel_1 = require("./commercialReadKernel");
/** Every governed Agreement create writes both; C1 leaves them nullable only for identity-only rows. */
exports.SALES_AGREEMENT_IS_COMPLETE = "a.state IS NOT NULL AND a.currency IS NOT NULL";
const SUMMARY_COLUMNS = `a.id, a.sales_agreement_number, a.opportunity_id, a.account_id, acc.name AS account_name, a.operating_company_key,
  a.state::text AS state, a.currency, a.accepted_at, a.accepted_by, a.created_at, a.updated_at,
  a.shipping_minor, a.install_charge_minor, a.tax_minor, a.down_payment_minor, a.trade_in_minor,
  a.owner_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = a.tenant_id AND e.id = a.owner_employee_id) AS owner_resolved,
  a.accountable_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = a.tenant_id AND e.id = a.accountable_employee_id) AS accountable_resolved,
  a.credited_salesperson_employee_id, EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = a.tenant_id AND e.id = a.credited_salesperson_employee_id) AS credited_resolved`;
async function linesByAgreement(db, tenantId, ids) {
    const out = new Map(ids.map((id) => [id, []]));
    if (ids.length === 0)
        return out;
    const { rows } = await db.query(`SELECT sales_agreement_id, line_number, kind::text AS kind, ref, business_unit::text AS business_unit, quantity, unit_price_minor,
            condition::text AS condition, warranty, estimated_arrival_at
       FROM eos_commercial.sales_agreement_lines
      WHERE tenant_id = $1 AND sales_agreement_id = ANY($2::text[]) ORDER BY sales_agreement_id, line_number`, [tenantId, ids]);
    for (const l of rows) {
        const unitPriceMinor = (0, commercialReadKernel_1.minorOf)(l.unit_price_minor);
        out.get(l.sales_agreement_id).push({
            lineNumber: l.line_number, kind: l.kind, ref: l.ref, businessUnit: l.business_unit, quantity: l.quantity, unitPriceMinor,
            extendedMinor: unitPriceMinor === null ? null : l.quantity * unitPriceMinor,
            condition: l.condition, warranty: l.warranty, estimatedArrivalAt: (0, commercialReadKernel_1.isoOf)(l.estimated_arrival_at),
        });
    }
    return out;
}
function summaryOf(r, lines) {
    const totals = (0, salesAgreementCommands_1.computeAgreementTotals)(lines.map((l) => ({ extendedMinor: l.extendedMinor })), {
        shippingMinor: (0, commercialReadKernel_1.minorOf)(r.shipping_minor) ?? undefined, installChargeMinor: (0, commercialReadKernel_1.minorOf)(r.install_charge_minor) ?? undefined,
        taxMinor: (0, commercialReadKernel_1.minorOf)(r.tax_minor) ?? undefined, downPaymentMinor: (0, commercialReadKernel_1.minorOf)(r.down_payment_minor) ?? undefined,
        tradeInMinor: (0, commercialReadKernel_1.minorOf)(r.trade_in_minor) ?? undefined,
    });
    return {
        id: r.id, salesAgreementNumber: r.sales_agreement_number, opportunityId: r.opportunity_id, accountId: r.account_id,
        accountName: r.account_name ?? null,
        owner: (0, commercialReadKernel_1.personOf)(r.owner_employee_id, r.owner_resolved),
        accountablePerson: (0, commercialReadKernel_1.personOf)(r.accountable_employee_id, r.accountable_resolved),
        creditedSalesperson: (0, commercialReadKernel_1.personOf)(r.credited_salesperson_employee_id, r.credited_resolved),
        operatingCompanyId: r.operating_company_key, state: r.state, currency: r.currency,
        acceptedAt: (0, commercialReadKernel_1.isoOf)(r.accepted_at), acceptedByPrincipalId: r.accepted_by,
        totals: totals, createdAt: (0, commercialReadKernel_1.isoOf)(r.created_at), updatedAt: (0, commercialReadKernel_1.isoOf)(r.updated_at), lines,
    };
}
function getSalesAgreementDetail(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ], () => (0, commercialReadKernel_1.requireRecordId)(input?.salesAgreementId, "salesAgreementId"), async (db, tenantId, salesAgreementId) => {
        const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS}, (${exports.SALES_AGREEMENT_IS_COMPLETE}) AS complete,
                a.location_id, loc.name AS location_name, a.customer_po, a.is_lease, a.fulfillment_intent::text AS fulfillment_intent,
                a.shipping_instructions, a.ship_via, a.special_instructions,
                o.opportunity_number, o.stage::text AS opportunity_stage,
                so.id AS order_id, so.sales_order_number AS order_number, so.state::text AS order_state
           FROM eos_commercial.sales_agreements a
           LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = a.tenant_id AND acc.id = a.account_id
           LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = a.tenant_id AND loc.account_id = a.account_id AND loc.id = a.location_id
           LEFT JOIN eos_commercial.opportunities o ON o.tenant_id = a.tenant_id AND o.id = a.opportunity_id
           LEFT JOIN eos_commercial.sales_orders so ON so.tenant_id = a.tenant_id AND so.sales_agreement_id = a.id
          WHERE a.tenant_id = $1 AND a.id = $2`, [tenantId, salesAgreementId]);
        if (rows.length === 0)
            return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", "the Sales Agreement does not exist in this tenant");
        const r = rows[0];
        if (!r.complete)
            (0, commercialCommandKernel_1.fail)("RECORD_INCOMPLETE", "PRECONDITION_FAILED", "the Sales Agreement was not created through a governed command and carries no lifecycle");
        const lines = await linesByAgreement(db, tenantId, [r.id]);
        return {
            ...summaryOf(r, lines.get(r.id)),
            location: r.location_id === null ? null : { locationId: r.location_id, name: r.location_name ?? null },
            customerPO: r.customer_po, isLease: r.is_lease, fulfillmentIntent: r.fulfillment_intent,
            shippingInstructions: r.shipping_instructions, shipVia: r.ship_via, specialInstructions: r.special_instructions,
            sourceOpportunity: r.opportunity_id === null || r.opportunity_number === null ? null
                : { id: r.opportunity_id, number: r.opportunity_number, state: r.opportunity_stage },
            salesOrder: r.order_id === null ? null : { id: r.order_id, number: r.order_number, state: r.order_state },
        };
    });
}
function prepareSalesAgreementList(input) {
    return {
        limit: (0, commercialReadKernel_1.requirePageSize)(input?.limit),
        accountId: (0, commercialReadKernel_1.optionalAccountId)(input?.accountId),
        state: (0, commercialReadKernel_1.requireEnumFilter)(input?.state, "state", salesAgreementLifecycle_1.SALES_AGREEMENT_STATES),
        cursor: (0, commercialReadKernel_1.decodeCommercialCursor)("salesAgreement", input?.cursor),
    };
}
async function readSalesAgreementPage(db, tenantId, o) {
    const { rows } = await db.query(`SELECT ${SUMMARY_COLUMNS}
       FROM eos_commercial.sales_agreements a
       LEFT JOIN eos_crm.accounts acc ON acc.tenant_id = a.tenant_id AND acc.id = a.account_id
      WHERE a.tenant_id = $1 AND ${exports.SALES_AGREEMENT_IS_COMPLETE}
        AND ($2::text IS NULL OR a.account_id = $2)
        AND ($3::text[] IS NULL OR a.state::text = ANY($3::text[]))
        AND ($4::text IS NULL OR (a.sales_agreement_number, a.id) < ($4::text, $5::text))
      ORDER BY a.sales_agreement_number DESC, a.id DESC
      LIMIT $6`, [tenantId, o.accountId, o.state, o.cursor?.number ?? null, o.cursor?.id ?? null, o.limit + 1]);
    const kept = rows.slice(0, o.limit);
    const lines = await linesByAgreement(db, tenantId, kept.map((r) => r.id));
    return (0, commercialReadKernel_1.pageOf)("salesAgreement", rows, o.limit, (r) => r.sales_agreement_number, (r) => summaryOf(r, lines.get(r.id)));
}
function listSalesAgreements(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ], () => prepareSalesAgreementList(input), (db, tenantId, options) => readSalesAgreementPage(db, tenantId, options));
}
//# sourceMappingURL=salesAgreementReadProjection.js.map
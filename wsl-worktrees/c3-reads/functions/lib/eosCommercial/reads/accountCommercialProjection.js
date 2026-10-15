"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountCommercialProjection = getAccountCommercialProjection;
// Governed PostgreSQL Account-scoped Commercial projection -- wave C3. Internal; nothing external invokes it yet.
//
// Replaces, for a future C4 transport, the Account workspace's separate Firestore reads (listOpportunitiesForAccount,
// listSalesOrdersForAccount) with one snapshot: the Account's complete Opportunities, Sales Agreements and Sales Orders
// in THIS tenant, each bounded and honest about truncation. It requires every family's EXISTING read capability,
// because it discloses every family; no Account-level capability is invented.
//
// The Account must exist in eos_crm for this tenant. That reads the target PostgreSQL relationship the Commercial
// schema already references; it does NOT declare CRM runtime cutover (D1) complete. Only the Account's name is
// emitted -- no commercial profile, terms or contacts.
const commercialCommandKernel_1 = require("../commands/commercialCommandKernel");
const commercialReadKernel_1 = require("./commercialReadKernel");
const opportunityReadProjection_1 = require("./opportunityReadProjection");
const salesAgreementReadProjection_1 = require("./salesAgreementReadProjection");
const salesOrderReadProjection_1 = require("./salesOrderReadProjection");
function getAccountCommercialProjection(deps, actor, input) {
    return (0, commercialReadKernel_1.runCommercialRead)(deps, actor, [commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ, commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ, commercialReadKernel_1.COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ], () => ({ accountId: (0, commercialReadKernel_1.requireRecordId)(input?.accountId, "accountId"), limit: (0, commercialReadKernel_1.requirePageSize)(input?.limit) }), async (db, tenantId, { accountId, limit }) => {
        const account = await db.query(`SELECT id, name FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
        if (account.rows.length === 0)
            return (0, commercialCommandKernel_1.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
        const scope = { limit, accountId, cursor: null };
        const opportunities = await (0, opportunityReadProjection_1.readOpportunityPage)(db, tenantId, { ...scope, stage: null });
        const salesAgreements = await (0, salesAgreementReadProjection_1.readSalesAgreementPage)(db, tenantId, { ...scope, state: null });
        const salesOrders = await (0, salesOrderReadProjection_1.readSalesOrderPage)(db, tenantId, { ...scope, state: null });
        return {
            account: { accountId: account.rows[0].id, name: account.rows[0].name },
            opportunities: { items: opportunities.items, truncated: opportunities.truncated },
            salesAgreements: { items: salesAgreements.items, truncated: salesAgreements.truncated },
            salesOrders: { items: salesOrders.items, truncated: salesOrders.truncated },
        };
    });
}
//# sourceMappingURL=accountCommercialProjection.js.map
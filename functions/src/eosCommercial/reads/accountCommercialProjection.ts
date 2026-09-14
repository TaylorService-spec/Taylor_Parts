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
import { fail } from "../commands/commercialCommandKernel";
import { COMMERCIAL_READ_CAPABILITIES, requirePageSize, requireRecordId, runCommercialRead, type CommercialReadActor, type CommercialReadDeps } from "./commercialReadKernel";
import { readOpportunityPage, type OpportunitySummaryProjection } from "./opportunityReadProjection";
import { readSalesAgreementPage, type SalesAgreementSummaryProjection } from "./salesAgreementReadProjection";
import { readSalesOrderPage, type SalesOrderSummaryProjection } from "./salesOrderReadProjection";

export interface AccountCommercialSection<Item> {
  readonly items: Item[];
  readonly truncated: boolean;
}

export interface AccountCommercialProjection {
  readonly account: { readonly accountId: string; readonly name: string };
  readonly opportunities: AccountCommercialSection<OpportunitySummaryProjection>;
  readonly salesAgreements: AccountCommercialSection<SalesAgreementSummaryProjection>;
  readonly salesOrders: AccountCommercialSection<SalesOrderSummaryProjection>;
}

export function getAccountCommercialProjection(
  deps: CommercialReadDeps,
  actor: CommercialReadActor,
  input: Record<string, unknown>,
): Promise<AccountCommercialProjection> {
  return runCommercialRead(
    deps,
    actor,
    [COMMERCIAL_READ_CAPABILITIES.OPPORTUNITY_READ, COMMERCIAL_READ_CAPABILITIES.SALES_AGREEMENT_READ, COMMERCIAL_READ_CAPABILITIES.SALES_ORDER_READ],
    () => ({ accountId: requireRecordId(input?.accountId, "accountId"), limit: requirePageSize(input?.limit) }),
    async (db, tenantId, { accountId, limit }) => {
      const account = await db.query<{ id: string; name: string }>(`SELECT id, name FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
      if (account.rows.length === 0) return fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
      const scope = { limit, accountId, cursor: null };
      const opportunities = await readOpportunityPage(db, tenantId, { ...scope, stage: null });
      const salesAgreements = await readSalesAgreementPage(db, tenantId, { ...scope, state: null });
      const salesOrders = await readSalesOrderPage(db, tenantId, { ...scope, state: null });
      return {
        account: { accountId: account.rows[0].id, name: account.rows[0].name },
        opportunities: { items: opportunities.items, truncated: opportunities.truncated },
        salesAgreements: { items: salesAgreements.items, truncated: salesAgreements.truncated },
        salesOrders: { items: salesOrders.items, truncated: salesOrders.truncated },
      };
    },
  );
}

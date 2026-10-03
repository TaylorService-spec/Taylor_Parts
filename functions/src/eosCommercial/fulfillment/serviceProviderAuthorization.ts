// FBR-F2 (DECISIONS #206): may a Work Order of ANOTHER operating company serve this Sales Order? Only under an ACTIVE seller
// authorization that names the Work Order's company and covers its type (INSTALL -> INSTALLATION; every other native type ->
// SERVICE). Read inside the caller's transaction. Anything else stays SALES_ORDER_COMPANY_MISMATCH.
import type { PoolClient } from "pg";

export const serviceScopeForWorkOrderType = (workOrderType: string): "INSTALLATION" | "SERVICE" => (workOrderType === "INSTALL" ? "INSTALLATION" : "SERVICE");

export async function serviceProviderAuthorized(db: Pick<PoolClient, "query">, tenantId: string, salesOrderId: string, workOrderCompanyKey: string,
  workOrderType: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM eos_commercial.sales_order_service_providers WHERE tenant_id = $1 AND sales_order_id = $2 AND service_operating_company_key = $3
        AND status = 'ACTIVE' AND $4 = ANY(scopes)`, [tenantId, salesOrderId, workOrderCompanyKey, serviceScopeForWorkOrderType(workOrderType)]);
  return rows.length > 0;
}

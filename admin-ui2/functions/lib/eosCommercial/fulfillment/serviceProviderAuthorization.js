"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceScopeForWorkOrderType = void 0;
exports.serviceProviderAuthorized = serviceProviderAuthorized;
const serviceScopeForWorkOrderType = (workOrderType) => (workOrderType === "INSTALL" ? "INSTALLATION" : "SERVICE");
exports.serviceScopeForWorkOrderType = serviceScopeForWorkOrderType;
async function serviceProviderAuthorized(db, tenantId, salesOrderId, workOrderCompanyKey, workOrderType) {
    const { rows } = await db.query(`SELECT 1 FROM eos_commercial.sales_order_service_providers WHERE tenant_id = $1 AND sales_order_id = $2 AND service_operating_company_key = $3
        AND status = 'ACTIVE' AND $4 = ANY(scopes)`, [tenantId, salesOrderId, workOrderCompanyKey, (0, exports.serviceScopeForWorkOrderType)(workOrderType)]);
    return rows.length > 0;
}
//# sourceMappingURL=serviceProviderAuthorization.js.map
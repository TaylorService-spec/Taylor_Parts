"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessDateOn = businessDateOn;
exports.businessTimeZoneOn = businessTimeZoneOn;
/** The business date (YYYY-MM-DD) of `instant` for one operating company -- resolved by eos_policy.operating_company_business_date. */
async function businessDateOn(db, tenantId, operatingCompanyId, instant) {
    const { rows } = await db.query(`SELECT to_char(eos_policy.operating_company_business_date($1, $2, $3::timestamptz), 'YYYY-MM-DD') AS d`, [tenantId, operatingCompanyId, instant]);
    return String(rows[0].d);
}
/** The company's governed business time zone (IANA). */
async function businessTimeZoneOn(db, tenantId, operatingCompanyId) {
    const { rows } = await db.query(`SELECT business_time_zone FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2`, [tenantId, operatingCompanyId]);
    return rows[0]?.business_time_zone ?? null;
}
//# sourceMappingURL=operatingCompanyBusinessTime.js.map
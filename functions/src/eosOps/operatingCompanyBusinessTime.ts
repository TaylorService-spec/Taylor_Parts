// OPERATING-COMPANY BUSINESS TIME (Controller G2, 2026-10-02; DECISIONS #203).
//
// A TECHNICAL TIMESTAMP is an instant (TIMESTAMPTZ, UTC on the wire) and is never rewritten. A BUSINESS DATE is the calendar
// day that instant falls on in the operating company's governed time zone (eos_policy.tenant_operating_companies
// .business_time_zone; Taylor and Ventana: America/Phoenix by configuration). This module is the ONE place domain code asks
// for a business date -- no time zone is hardcoded anywhere else, and no business date is cut from a UTC instant.
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

/** The business date (YYYY-MM-DD) of `instant` for one operating company -- resolved by eos_policy.operating_company_business_date. */
export async function businessDateOn(db: Queryable, tenantId: string, operatingCompanyId: string, instant: Date | string): Promise<string> {
  const { rows } = await db.query(
    `SELECT to_char(eos_policy.operating_company_business_date($1, $2, $3::timestamptz), 'YYYY-MM-DD') AS d`, [tenantId, operatingCompanyId, instant]);
  return String(rows[0].d);
}

/** The company's governed business time zone (IANA). */
export async function businessTimeZoneOn(db: Queryable, tenantId: string, operatingCompanyId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT business_time_zone FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2`, [tenantId, operatingCompanyId]);
  return rows[0]?.business_time_zone ?? null;
}

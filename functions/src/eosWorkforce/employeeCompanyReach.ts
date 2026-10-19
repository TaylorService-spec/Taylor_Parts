// WHICH OPERATING COMPANIES AN EMPLOYEE HAS COMPANY AUTHORITY IN -- for the Operational Scope writer and its picker (ISO inventory, 2026-10-19).
//
// A WAREHOUSE (or MOBILE) scope is not company authority: reads and commands already decide company authority (#235 / #237) before the warehouse
// scope, so a scope in another company's warehouse is INERT. This stops the Administration command CREATING one: a Taylor employee is not given a
// scope in another company's warehouse unless the Employee has company authority there.
//
// THE SAME AUTHORITY. An Employee with an active linked Principal is decided by resolveCompanyAuthority (home company, OPERATIONAL company-scoped
// Role assignments, explicit company-access grants). An Employee with no usable link has no Principal to resolve for -- company authority is the Principal's,
// and a grant counts only behind an access-eligible link (companyAuthority.ts rule 3b) -- so before it is linked it is its HOME company alone.
import type { PoolClient } from "pg";
import { resolveCompanyAuthority } from "../eosOps/companyAuthority";

type Db = Pick<PoolClient, "query">;

/** The operating-company KEYS the Employee has company authority in. */
export async function employeeCompanyKeys(db: Db, tenantId: string, employeeId: string): Promise<readonly string[]> {
  const link = await db.query<{ principal_id: string }>(
    `SELECT principal_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`, [tenantId, employeeId]);
  if (link.rows.length === 1) {
    const authority = await resolveCompanyAuthority(db, tenantId, link.rows[0].principal_id);
    if (authority.gap === null) return authority.companyKeys;
  }
  const { rows } = await db.query<{ key: string }>(
    `SELECT DISTINCT k.operating_company_key AS key
       FROM eos_policy.tenant_operating_company_keys k
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = k.tenant_id AND c.operating_company_id = k.operating_company_id AND c.status = 'ACTIVE'
      WHERE k.tenant_id = $1 AND k.status = 'ACTIVE'
        AND k.operating_company_id = (SELECT e.operating_company_id FROM eos_workforce.employees e WHERE e.tenant_id = $1 AND e.id = $2)
      ORDER BY 1`, [tenantId, employeeId]);
  return rows.map((r) => String(r.key));
}

/**
 * The operating-company keys of this tenant that are GOVERNED (bound to an ACTIVE company with an ACTIVE key). A warehouse whose key is not among
 * them belongs to no company anyone can hold authority over, so it is unreachable for everyone already; it is not refused here as "another company's".
 */
export async function governedCompanyKeys(db: Db, tenantId: string): Promise<ReadonlySet<string>> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT k.operating_company_key AS key FROM eos_policy.tenant_operating_company_keys k
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = k.tenant_id AND c.operating_company_id = k.operating_company_id AND c.status = 'ACTIVE'
      WHERE k.tenant_id = $1 AND k.status = 'ACTIVE'`, [tenantId]);
  return new Set(rows.map((r) => String(r.key)));
}

/** May a warehouse of this company key be offered / assigned to the Employee? Yes unless it is a governed company the Employee has no authority in. */
export function warehouseCompanyAllowed(companyKey: string, governed: ReadonlySet<string>, employeeKeys: readonly string[]): boolean {
  return !governed.has(companyKey) || employeeKeys.includes(companyKey);
}

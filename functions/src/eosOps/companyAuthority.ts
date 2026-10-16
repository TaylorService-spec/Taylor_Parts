// EOS CORE COMPANY AUTHORITY V1 -- which operating companies may this Principal see business data for?
// (Owner decision 2026-10-15, "EOS CORE COMPANY AUTHORITY V1"; DECISIONS #235.)
//
//   1. IDENTITY       an ENABLED Principal with an ACTIVE tenant membership and EXACTLY ONE active Employee link, to an
//                     Employee of this tenant whose employment status is access-eligible. Zero links, two links, a link
//                     to a missing or ineligible Employee: NO authority (identity ambiguity fails closed).
//   2. HOME COMPANY   that Employee's operating company (eos_workforce.employees.operating_company_id), when it is an
//                     ACTIVE operating company of this tenant.
//   3. EXPANSION      every company named by the Principal's ACTIVE, non-stale `operatingCompany`-scoped role
//                     assignments in this tenant (the same qualification rule as qualifyingGlobalRoles),
//                     when that company is ACTIVE for this tenant. An assignment confers REACH only, never a capability.
//   4. NOTHING ELSE   a global Role, Administrator standing, a Firebase claim or a client-selected company never implies
//                     any company. Empty = no company data.
//
// Read-only; grants nothing. Every caller still applies its own capability / measure / channel / warehouse / queue rules,
// and Finance keeps its stricter per-key company rule (eosFinance/financeCompanyAccess.ts) on top of this.
import type { PoolClient } from "pg";
import { ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES } from "../adminPolicy/employmentAccessEligibility";

type Db = Pick<PoolClient, "query">;

export type CompanyAuthorityGap = "PRINCIPAL_NOT_ACTIVE" | "EMPLOYEE_LINK_REQUIRED" | "EMPLOYEE_LINK_AMBIGUOUS" | "EMPLOYEE_NOT_ACCESS_ELIGIBLE";

export interface CompanyAuthority {
  /** The ACTIVE operating companies this Principal is authorized for, sorted. Empty = none. */
  readonly companies: readonly string[];
  /** The ACTIVE operating-company keys of those companies (record tables carry a key, not an id), sorted. */
  readonly companyKeys: readonly string[];
  /** Why there is no authority at all, when identity fails; null when identity resolved (companies may still be empty). */
  readonly gap: CompanyAuthorityGap | null;
}

const NONE = (gap: CompanyAuthorityGap): CompanyAuthority => Object.freeze({ companies: Object.freeze([]), companyKeys: Object.freeze([]), gap });

export async function resolveCompanyAuthority(db: Db, tenantId: string, principalId: string): Promise<CompanyAuthority> {
  const standing = await db.query(
    `SELECT 1 FROM eos_policy.principals p
       JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
      WHERE p.id = $2 AND p.status = 'active'`, [tenantId, principalId]);
  if (standing.rows.length === 0) return NONE("PRINCIPAL_NOT_ACTIVE");

  const links = await db.query<{ employee_id: string; employment_status: string | null; operating_company_id: string | null }>(
    `SELECT l.employee_id, e.employment_status::text AS employment_status, e.operating_company_id
       FROM eos_policy.employee_principal_links l
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`, [tenantId, principalId]);
  if (links.rows.length === 0) return NONE("EMPLOYEE_LINK_REQUIRED");
  if (links.rows.length > 1) return NONE("EMPLOYEE_LINK_AMBIGUOUS");
  const employee = links.rows[0];
  if (employee.employment_status === null || !ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES.includes(employee.employment_status)) {
    return NONE("EMPLOYEE_NOT_ACCESS_ELIGIBLE");
  }

  const { rows } = await db.query<{ id: string }>(
    `SELECT c.operating_company_id AS id
       FROM eos_policy.tenant_operating_companies c
      WHERE c.tenant_id = $1 AND c.status = 'ACTIVE'
        AND (c.operating_company_id = $3
             OR EXISTS (SELECT 1 FROM eos_policy.user_role_assignments a
                          JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
                          LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
                         WHERE a.tenant_id = c.tenant_id AND a.principal_id = $2 AND a.status = 'active'
                           AND a.scope_type = 'operatingCompany' AND a.scope_value = c.operating_company_id
                           AND a.access_version_at_grant <= coalesce(v.access_version, 0)))
      ORDER BY 1`, [tenantId, principalId, employee.operating_company_id]);
  const companies = rows.map((r) => String(r.id));
  const keys = companies.length === 0 ? [] : (await db.query<{ key: string }>(
    `SELECT DISTINCT operating_company_key AS key FROM eos_policy.tenant_operating_company_keys
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_id = ANY($2::text[]) ORDER BY 1`, [tenantId, companies])).rows.map((r) => String(r.key));
  return Object.freeze({ companies: Object.freeze(companies), companyKeys: Object.freeze(keys), gap: null });
}

/**
 * D6 (P0 rental security): the caller's authorized companies as picker options -- each ACTIVE company with its ACTIVE key(s).
 * Only what resolveCompanyAuthority already decided; nothing is widened, and a caller without authority gets an empty list.
 */
export async function readMyCompanyAuthority(db: Db, tenantId: string, principalId: string) {
  const authority = await resolveCompanyAuthority(db, tenantId, principalId);
  if (authority.companies.length === 0) return Object.freeze({ companies: Object.freeze([]), gap: authority.gap });
  const { rows } = await db.query<{ id: string; key: string }>(
    `SELECT operating_company_id AS id, operating_company_key AS key FROM eos_policy.tenant_operating_company_keys
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_id = ANY($2::text[]) ORDER BY 1, 2`, [tenantId, [...authority.companies]]);
  return Object.freeze({
    companies: Object.freeze(rows.map((r) => Object.freeze({ operatingCompanyId: String(r.id), operatingCompanyKey: String(r.key) }))),
    gap: authority.gap,
  });
}

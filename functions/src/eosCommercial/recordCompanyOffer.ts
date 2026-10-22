// CLC (DECISIONS #CLC): the SERVER decides whether a record page offers "Set operating company". The client renders what this returns and decides nothing.
//
// Offered ONLY when ALL of these hold, otherwise the field is absent from the detail projection:
//   * the record is company-less (its stored operating_company_key is NULL);
//   * the caller holds commercial.recordCompany.assign (held globally -- it is not a scope-evaluable key, so a scoped assignment cannot carry it);
//   * at least one ACTIVE, bound operating company is one the caller REACHES (the same Q-1a decision `assignRecordOperatingCompany` makes);
//   * for an Agreement with an Opportunity: the Opportunity already has a company, and it is the ONLY company offered (an Agreement's company is its
//     Opportunity's; a company-less Opportunity is corrected first and its Agreement follows). The Opportunity's company key is read here to decide
//     the offer and is never returned.
// The command re-decides everything; this read confers nothing.
import { COMMERCIAL_RECORD_COMPANY_ASSIGN_CAPABILITY } from "./commands/commercialCommandKernel";
import type { CommercialCompanyReach } from "./commercialCompanyAuthority";
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export interface OperatingCompanyAssignmentOffer {
  /** The companies the caller may assign, by governed company id. */
  readonly companies: readonly { readonly operatingCompanyId: string }[];
}

export async function readOperatingCompanyAssignmentOffer(
  db: Queryable, tenantId: string, actor: { readonly capabilities: ReadonlySet<string> }, company: CommercialCompanyReach,
  record: { readonly operatingCompanyKey: string | null; readonly parentOpportunityId?: string | null },
): Promise<OperatingCompanyAssignmentOffer | null> {
  if (record.operatingCompanyKey !== null) return null;
  if (!actor.capabilities.has(COMMERCIAL_RECORD_COMPANY_ASSIGN_CAPABILITY)) return null;
  let onlyKey: string | null = null;
  if (record.parentOpportunityId) {
    const parent = await db.query<{ operating_company_key: string | null }>(
      `SELECT operating_company_key FROM eos_commercial.opportunities WHERE tenant_id = $1 AND id = $2`, [tenantId, record.parentOpportunityId]);
    onlyKey = parent.rows[0]?.operating_company_key ?? null;
    if (onlyKey === null) return null;
  }
  const { rows } = await db.query<{ operating_company_id: string; operating_company_key: string }>(
    `SELECT b.operating_company_id, b.operating_company_key
       FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'
      ORDER BY b.operating_company_id`, [tenantId]);
  const companies = rows
    .filter((r) => (onlyKey === null || r.operating_company_key === onlyKey) && company.admitsNewCompany(r.operating_company_key))
    .map((r) => Object.freeze({ operatingCompanyId: r.operating_company_id }));
  return companies.length === 0 ? null : Object.freeze({ companies: Object.freeze(companies) });
}

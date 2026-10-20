// THE EXEMPTION FROM SECONDARY APPROVAL -- the PostgreSQL adapter (Owner policy override 2026-10-20, DECISIONS #SAE). The rule and the decision are in
// secondaryApprovalExemptionCore.ts; this reads the governed facts for a verified Principal and asks it. Every same-person check in EOS routes here:
//
//     // only when the caller WOULD refuse a same-person decision, and after capability / company / state were decided:
//     const ex = await resolveSecondaryApprovalExemption(db, tenantId, principalId, "finance.invoiceCorrection");
//     if (!ex.exempt) refuse(...);                                       // non-Owners: unchanged
//     const rec = exemptionRecord(ex, principalId, tenantId, site)       // { approvalBasis, scopeKey, grantSource }: recorded on the decision and its audit row
//
// Never take an "isOwner" flag or a role string from a request: the Principal comes from the verified token, the rest from the store. A read fault THROWS (the
// transaction fails, nothing is written); an unresolvable membership is "not exempt".
import type { PoolClient } from "pg";
import { qualifyingGlobalRoles } from "../eosOps/administrationReach";
import { PROTECTED_OWNER_ROLE_KEY } from "../adminPolicy/administrationAuthority";
import { decideSecondaryApprovalExemption, type SecondaryApprovalResolution, type SelfApprovalSite } from "./secondaryApprovalExemptionCore";

export * from "./secondaryApprovalExemptionCore";

type Db = Pick<PoolClient, "query">;

export async function resolveSecondaryApprovalExemption(db: Db, tenantId: string, principalId: string, site: SelfApprovalSite): Promise<SecondaryApprovalResolution> {
  // qualifyingGlobalRoles: ENABLED principal, ACTIVE membership, ACTIVE + GLOBAL + non-stale assignments, no unusable Employee link -- the rule principal resolution applies.
  const roles = await qualifyingGlobalRoles(db, tenantId, principalId, [PROTECTED_OWNER_ROLE_KEY]);
  if (roles.length === 0) return decideSecondaryApprovalExemption(tenantId, principalId, site, null);
  const { rows } = await db.query(
    `SELECT l.employee_id, e.employment_status::text AS employment_status
       FROM eos_policy.employee_principal_links l
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`, [tenantId, principalId]);
  return decideSecondaryApprovalExemption(tenantId, principalId, site, {
    principalEnabled: true, membershipActive: true, // established by qualifyingGlobalRoles (it joins both)
    heldRoles: roles,
    employeeLinks: rows.map((r) => ({ employeeId: String(r.employee_id), employmentStatus: r.employment_status ?? null })),
  });
}

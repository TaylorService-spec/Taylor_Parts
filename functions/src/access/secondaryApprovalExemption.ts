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
import { SELF_APPROVAL_EXEMPT_KEY_LIST, decideSecondaryApprovalExemption, scopeOfExemptKey, type SecondaryApprovalResolution, type SelfApprovalScope, type SelfApprovalSite } from "./secondaryApprovalExemptionCore";

export * from "./secondaryApprovalExemptionCore";

type Db = Pick<PoolClient, "query">;

/**
 * The delegated exemption grants IN FORCE for a Principal (Rule 2): a family key held by a Role through an ACTIVE, GLOBAL, non-stale assignment (the same qualification rule as the
 * Owner Role and the runtime resolver), OR by an unexpired direct grant -- for an ENABLED Principal with an ACTIVE membership. Rows only: standing and derivation never supply a
 * family key. A revoke deletes the row, so it takes effect on the next call.
 */
export async function delegatedExemptionGrants(db: Db, tenantId: string, principalId: string): Promise<readonly { scopeKey: SelfApprovalScope | "ALL"; source: string }[]> {
  const { rows } = await db.query(
    `SELECT c.key, 'role:' || r.key AS source
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
       JOIN eos_policy.principals p ON p.id = a.principal_id AND p.status = 'active'
       JOIN eos_policy.tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id AND m.status = 'active'
       LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
       JOIN eos_policy.role_capabilities rc ON rc.tenant_id = a.tenant_id AND rc.role_id = a.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND a.scope_type = 'global'
        AND a.access_version_at_grant <= coalesce(v.access_version, 0) AND c.key = ANY($3::text[])
     UNION ALL
     SELECT c.key, 'direct:' || pc.id AS source
       FROM eos_policy.principal_capabilities pc
       JOIN eos_policy.principals p ON p.id = pc.principal_id AND p.status = 'active'
       JOIN eos_policy.tenant_memberships m ON m.tenant_id = pc.tenant_id AND m.principal_id = pc.principal_id AND m.status = 'active'
       JOIN eos_policy.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND pc.principal_id = $2 AND (pc.expires_at IS NULL OR pc.expires_at > now()) AND c.key = ANY($3::text[])`,
    [tenantId, principalId, [...SELF_APPROVAL_EXEMPT_KEY_LIST]]);
  return rows.flatMap((r) => { const scopeKey = scopeOfExemptKey(r.key); return scopeKey === null ? [] : [{ scopeKey, source: String(r.source) }]; });
}

export async function resolveSecondaryApprovalExemption(db: Db, tenantId: string, principalId: string, site: SelfApprovalSite): Promise<SecondaryApprovalResolution> {
  // qualifyingGlobalRoles: ENABLED principal, ACTIVE membership, ACTIVE + GLOBAL + non-stale assignments, no unusable Employee link -- the rule principal resolution applies.
  const roles = await qualifyingGlobalRoles(db, tenantId, principalId, [PROTECTED_OWNER_ROLE_KEY]);
  // The protected Owner is resolved first (Rule 1); only a Principal who is NOT one is asked for a delegated grant (Rule 2).
  const delegated = roles.length === 0 ? await delegatedExemptionGrants(db, tenantId, principalId) : [];
  if (roles.length === 0 && delegated.length === 0) return decideSecondaryApprovalExemption(tenantId, principalId, site, null);
  const { rows } = await db.query(
    `SELECT l.employee_id, e.employment_status::text AS employment_status
       FROM eos_policy.employee_principal_links l
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`, [tenantId, principalId]);
  return decideSecondaryApprovalExemption(tenantId, principalId, site, {
    principalEnabled: true, membershipActive: true, // established by the joins above (both queries join the Principal and its membership)
    heldRoles: roles,
    employeeLinks: rows.map((r) => ({ employeeId: String(r.employee_id), employmentStatus: r.employment_status ?? null })),
    delegated,
  });
}

// THE PROTECTED OWNER'S EXEMPTION, as Administration reads it (Owner policy override 2026-10-20, DECISIONS #SAE).
//
// Administration decides over a PolicyRepository (in-memory or PostgreSQL), not a connection, so it asks the ONE pure decision
// (access/secondaryApprovalExemptionCore) with facts read through the repository: the Principal, its tenant membership, its qualifying GLOBAL Role assignments
// (the resolver's own rule: ACTIVE, not stale against the access version, global) and its Employee link. The protected Owner is waived SELF_ADMINISTRATION and
// PRIVILEGE_ESCALATION and nothing else: the membership of the protected Owner Role changes only through its existing governed path, a tenant never has zero
// protected Owners, the capability that authorizes the command, the preview digest, the reason and the audit all still apply. The Administration site is not
// delegable (scope map: null).
import { employeeAccessIneligibility } from "./employmentAccessEligibility";
import type { PolicyReader } from "./policyRepository";
import { decideSecondaryApprovalExemption, type SecondaryApprovalResolution, type SelfApprovalSite } from "../access/secondaryApprovalExemptionCore";

export async function resolveOwnerAdministrationExemption(repo: PolicyReader, tenantId: string, principalId: string,
  site: SelfApprovalSite = "admin.selfAdministration"): Promise<SecondaryApprovalResolution> {
  const [membership, principal, assignments, versionRow, roles, fact] = await Promise.all([
    repo.getMembership(tenantId, principalId), repo.getPrincipal(principalId), repo.listAssignmentsForPrincipal(tenantId, principalId),
    repo.getAccessVersion(tenantId, principalId), repo.listRoles(tenantId), repo.getLinkedEmployeeAccessFact(tenantId, principalId),
  ]);
  const currentVersion = typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0;
  const qualifying = new Set(assignments
    .filter((a) => a && a.status === "active" && typeof a.accessVersionAtGrant === "number" && a.accessVersionAtGrant <= currentVersion
      && (a.scopeType === undefined || a.scopeType === null || a.scopeType === "" || a.scopeType === "global"))
    .map((a) => a.roleId));
  // The same eligibility rule principal resolution applies (an ambiguous or unresolvable link is no Employee).
  const links = fact && employeeAccessIneligibility(fact) === null ? [{ employeeId: fact.employeeId, employmentStatus: fact.employmentStatus }] : [];
  return decideSecondaryApprovalExemption(tenantId, principalId, site, {
    principalEnabled: principal?.status === "active",
    membershipActive: membership?.status === "active",
    heldRoles: roles.filter((r) => qualifying.has(r.id)),
    employeeLinks: links,
  });
}

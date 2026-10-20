// WHO MAY GRANT OR REVOKE A DELEGATED SELF-APPROVAL EXEMPTION (SAE Rule 2; DECISIONS #SAE-2; Owner direction SAE3 + controller decision Q1, 2026-10-20).
//
// For the approval.selfApproval.exempt* capability family ONLY, the grant / revoke commands (to a Role, or directly to a Principal) are gated on the VERIFIED PROTECTED OWNER --
// not on admin.securityPolicy.write. Everyone else, the Administrator included, is refused before anything is read about the request, so a refusal leaves no trace. Every other
// key keeps today's gate unchanged.
//
// The Owner is verified through the SAME pure decision the approval seam uses (access/secondaryApprovalExemptionCore): an enabled Principal with an active membership holding an
// active, global, non-stale assignment of THE protected Owner Role (key AND stored flag) and exactly one active access-eligible Employee link; any gap is "not the Owner". Nothing here
// is an exemption from SELF_ADMINISTRATION or PRIVILEGE_ESCALATION (Owner ruling D1): granting to a Role the Owner holds, or to the Owner themselves, is still refused by the command.
//
// A delegated grant confers ONLY the second-person exemption within its scope (Owner ruling D3). It confers no administration right and no onward-delegation right: the family can be
// granted only by the Owner, and assigning a Role that CARRIES a family key is the Owner's act too (requireOwnerToAssignExemptionCarryingRole), so the Administrator cannot hand it out
// through staffing either.
import { AdministrationDeniedError } from "./administrationAuthority";
import { requireSecurityAdministrationCapability } from "./administrationCapabilityGate";
import { employeeAccessIneligibility } from "./employmentAccessEligibility";
import type { PolicyReader } from "./policyRepository";
import { resolveObjectAction } from "./objectSecurityAuthority";
import type { SecurityAdministrationAction } from "./administrationAuthority";
import type { AdminActor } from "./policyCommands";
import { decideSecondaryApprovalExemption, isSelfApprovalExemptKey } from "../access/secondaryApprovalExemptionCore";

/** Refusal of an exemption grant / revoke / staffing by anyone but the verified protected Owner. Maps to FORBIDDEN. */
export class ExemptionAdministrationDeniedError extends AdministrationDeniedError {
  constructor() {
    super("editRoleDefinition");
    this.message = "not authorized: only the governed protected Owner grants or revokes a self-approval exemption";
  }
}

/** Is this Principal, right now, the tenant's verified protected Owner (with an active Employee link)? Reads the governed tables through the repository. */
export async function isVerifiedProtectedOwner(repo: PolicyReader, tenantId: string, principalId: string): Promise<boolean> {
  const [membership, principal, assignments, versionRow, roles, fact] = await Promise.all([
    repo.getMembership(tenantId, principalId), repo.getPrincipal(principalId), repo.listAssignmentsForPrincipal(tenantId, principalId),
    repo.getAccessVersion(tenantId, principalId), repo.listRoles(tenantId), repo.getLinkedEmployeeAccessFact(tenantId, principalId),
  ]);
  const currentVersion = typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0;
  const qualifying = new Set(assignments
    .filter((a) => a && a.status === "active" && typeof a.accessVersionAtGrant === "number" && a.accessVersionAtGrant <= currentVersion
      && (a.scopeType === undefined || a.scopeType === null || a.scopeType === "" || a.scopeType === "global"))
    .map((a) => a.roleId));
  const links = fact && employeeAccessIneligibility(fact) === null ? [{ employeeId: fact.employeeId, employmentStatus: fact.employmentStatus }] : [];
  // Any declared site resolves the Owner identically; no delegated facts are passed, so only Rule 1 (the Owner) can answer.
  const r = decideSecondaryApprovalExemption(tenantId, principalId, "finance.invoiceCorrection", {
    principalEnabled: principal?.status === "active", membershipActive: membership?.status === "active",
    heldRoles: roles.filter((x) => qualifying.has(x.id)), employeeLinks: links,
  });
  return r.exempt && r.basis === "PROTECTED_OWNER";
}

/** Does (objectKey, actionKey) name a key of the exemption family? A name that does not resolve is "no": today's gate and today's error then apply unchanged. */
export async function namesExemptionKey(repo: PolicyReader, objectKey: unknown, actionKey: unknown): Promise<boolean> {
  if (typeof objectKey !== "string" || typeof actionKey !== "string") return false;
  try {
    return isSelfApprovalExemptKey(resolveObjectAction(await repo.listCapabilities(), objectKey, actionKey).key);
  } catch {
    return false;
  }
}

export async function requireVerifiedProtectedOwner(repo: PolicyReader, actor: AdminActor): Promise<void> {
  if (!(await isVerifiedProtectedOwner(repo, actor.tenantId, actor.uid))) throw new ExemptionAdministrationDeniedError();
}

/**
 * THE GATE of every command that grants or revokes a capability on a Role or a Principal: the exemption family needs the verified protected Owner; every other key needs what it
 * always needed (`gate`). Decided before the request is otherwise read.
 */
export async function requireGrantAuthority(repo: PolicyReader, actor: AdminActor, gate: SecurityAdministrationAction, objectKey: unknown, actionKey: unknown): Promise<void> {
  if (await namesExemptionKey(repo, objectKey, actionKey)) return requireVerifiedProtectedOwner(repo, actor);
  return requireSecurityAdministrationCapability(repo, actor, gate);
}

/** Does this Role carry any key of the exemption family? */
export async function roleCarriesExemptionKey(repo: PolicyReader, tenantId: string, roleId: string): Promise<boolean> {
  const [catalog, grants] = await Promise.all([repo.listCapabilities(), repo.listRoleCapabilities(tenantId, [roleId])]);
  const family = new Set(catalog.filter((c) => isSelfApprovalExemptKey(c.key)).map((c) => c.id));
  return grants.some((g) => g.roleId === roleId && family.has(g.capabilityId));
}

/** Staffing a Role that carries an exemption key confers the exemption: the Owner's act, like the grant itself. Revoking an assignment only reduces authority and stays as it was. */
export async function requireOwnerToAssignExemptionCarryingRole(repo: PolicyReader, actor: AdminActor, roleId: string): Promise<void> {
  if (await roleCarriesExemptionKey(repo, actor.tenantId, roleId)) await requireVerifiedProtectedOwner(repo, actor);
}

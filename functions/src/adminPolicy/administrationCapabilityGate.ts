// The capability gate for security-administration mutations, and the anti-lockout guard.
//
// WHERE THE CAPABILITIES COME FROM. The actor's EFFECTIVE capability set, resolved from PostgreSQL
// through the governed store and nothing else:
//
//   actor.capabilities            when the trusted API already resolved it for this request, or
//   actor.heldRoleKeys            the QUALIFYING Role keys resolvePrincipalContext computed (never a
//     -> role_capabilities        request field) -> the Role grants in this tenant
//   + principal_capabilities      direct grants to the actor Principal
//
// There is no branch in which a Role NAME authorizes anything: a Role key is only a way to find the
// grants that Role holds. A tenant whose `admin` Role holds no admin.* grant cannot administer
// security through it -- which is why tenantBootstrap.ts grants the governing capabilities with the
// first administrator.
import {
  AdministrationCapabilityDeniedError,
  hasSecurityAdministrationCapability,
  type SecurityAdministrationAction,
} from "./administrationAuthority";
import type { PolicyReader } from "./policyRepository";
import type { TenantId } from "./types";

export interface CapabilityBearingActor {
  readonly tenantId: TenantId;
  readonly uid: string;
  readonly heldRoleKeys: readonly string[];
  readonly capabilities?: ReadonlySet<string>;
}

/** Capability keys granted, in this tenant, to these Roles (by key) and to this Principal directly. */
export async function capabilityKeysFor(
  repo: PolicyReader,
  tenantId: TenantId,
  roleKeys: readonly string[],
  principalId: string | null,
): Promise<ReadonlySet<string>> {
  const roles = await repo.listRoles(tenantId);
  const wanted = new Set(roleKeys);
  const roleIds = roles.filter((r) => wanted.has(r.key)).map((r) => r.id);
  // NEVER call listRoleCapabilities with an empty list: the port reads that as EVERY Role.
  const [catalog, roleGrants, direct] = await Promise.all([
    repo.listCapabilities(),
    roleIds.length > 0 ? repo.listRoleCapabilities(tenantId, roleIds) : Promise.resolve([]),
    principalId ? repo.listPrincipalCapabilities(tenantId, principalId) : Promise.resolve([]),
  ]);
  const keyById = new Map(catalog.map((c) => [c.id, c.key]));
  const keys = new Set<string>();
  for (const g of [...roleGrants, ...direct]) {
    const key = keyById.get(g.capabilityId);
    if (key) keys.add(key);
  }
  return keys;
}

/** The actor's effective capability set, resolved as the header describes. */
export async function actorCapabilities(repo: PolicyReader, actor: CapabilityBearingActor): Promise<ReadonlySet<string>> {
  if (actor.capabilities instanceof Set) return actor.capabilities;
  const roleKeys = Array.isArray(actor.heldRoleKeys) ? actor.heldRoleKeys : [];
  return capabilityKeysFor(repo, actor.tenantId, roleKeys, actor.uid);
}

/** Refuse unless the actor holds the capability this security-administration action requires. */
export async function requireSecurityAdministrationCapability(
  repo: PolicyReader,
  actor: CapabilityBearingActor,
  action: SecurityAdministrationAction,
): Promise<void> {
  const held = await actorCapabilities(repo, actor);
  if (!hasSecurityAdministrationCapability(held, action)) throw new AdministrationCapabilityDeniedError(action);
}

/**
 * How many ACTIVE principals would still hold `capabilityKey` if the given change were applied.
 *
 * A principal holds it through an ACTIVE assignment to a Role that holds it, or a direct grant.
 * `without` removes one Role grant, one direct grant, or one assignment from the count.
 */
export async function holdersAfter(
  repo: PolicyReader,
  tenantId: TenantId,
  capabilityKey: string,
  without: { readonly roleId?: string; readonly principalId?: string; readonly assignmentId?: string },
): Promise<number> {
  const catalog = await repo.listCapabilities();
  const capability = catalog.find((c) => c.key === capabilityKey);
  if (!capability) return 0;
  const roleGrants = (await repo.listRoleCapabilities(tenantId))
    .filter((g) => g.capabilityId === capability.id && g.roleId !== without.roleId);
  const holdingRoles = new Set(roleGrants.map((g) => g.roleId));
  const directHolders = new Set((await repo.listPrincipalCapabilities(tenantId))
    .filter((g) => g.capabilityId === capability.id && g.principalId !== without.principalId)
    .map((g) => g.principalId));
  let count = 0;
  for (const principalId of await repo.listTenantPrincipalIds(tenantId)) {
    const membership = await repo.getMembership(tenantId, principalId);
    if (!membership || membership.status !== "active") continue;
    if (directHolders.has(principalId)) { count += 1; continue; }
    const assignments = await repo.listAssignmentsForPrincipal(tenantId, principalId);
    if (assignments.some((a) => a.status === "active" && a.id !== without.assignmentId && holdingRoles.has(a.roleId))) {
      count += 1;
    }
  }
  return count;
}

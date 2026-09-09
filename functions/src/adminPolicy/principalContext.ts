// Who the caller is, in which tenant, holding which Roles — resolved server-side, from PostgreSQL.
//
// ════════════════════ THE ONE SENTENCE THIS FILE EXISTS FOR ════════════════════
//
//   Firebase authenticates. EOS authorizes.
//
// The identity provider hands the server a verified SUBJECT and nothing else that matters. Every
// other question -- which tenant, which Roles, which authority -- is answered here, from the policy
// database, and from nowhere else.
//
// ════════════════════ WHAT MAY NOT BE READ ════════════════════
//
// Not a Firebase custom claim. Not `users/{uid}.role`. Not `employees.securityRole`. Not a
// compatibility Role string. Not a request body. The transitional identity lookup that maps a
// Firebase UID to an EOS principal is exactly one thing -- a subject lookup -- and it confers no
// authority by itself: a principal with no ACTIVE membership and no assignments resolves to a
// context that can do nothing.
//
// ════════════════════ TENANT IS NOT A REQUEST PARAMETER ════════════════════
//
// A caller may STATE which tenant it means, and the server checks that statement against the
// principal's memberships. It never adopts it. The three outcomes are:
//
//   stated, and a member       -> that tenant
//   stated, and NOT a member   -> refused. Not "fall back to their own tenant", which would make a
//                                 spoofed id look like it worked
//   not stated, one membership -> that tenant
//   not stated, several        -> refused as ambiguous, because guessing is how one tenant's
//                                 administrator edits another tenant's policy
//
// A client that sends a tenantId therefore cannot manufacture authority with it, and cannot switch
// tenants with it either.
import { loadPrincipalPolicy } from "./effectiveObjectAccess";
import type { PolicyReader } from "./policyRepository";
import type { PrincipalRecord, TenantId, TenantRecord } from "./types";

/** The identity provider in use. Recorded per principal so replacing it is a data change. */
export const FIREBASE_IDENTITY_PROVIDER = "firebase";

/** Why a caller has no usable context. Each is a refusal, never a downgrade to reduced access. */
export type PrincipalContextRefusal =
  | "UNKNOWN_PRINCIPAL"
  | "PRINCIPAL_DISABLED"
  | "NO_TENANT_MEMBERSHIP"
  | "TENANT_NOT_A_MEMBERSHIP"
  | "AMBIGUOUS_TENANT"
  | "TENANT_NOT_ACTIVE";

export class PrincipalContextError extends Error {
  constructor(readonly refusal: PrincipalContextRefusal, message?: string) {
    super(message ?? refusal);
  }
}

/**
 * The resolved caller.
 *
 * `uid` is the EOS principal id, NOT the Firebase UID — that is what makes the authorization model
 * survive replacing the identity provider. It is the value written into assignments, access
 * versions and audit events.
 */
export interface PrincipalContext {
  readonly principal: PrincipalRecord;
  readonly tenant: TenantRecord;
  readonly tenantId: TenantId;
  /** The EOS principal id. Every downstream record identifies the actor by this. */
  readonly uid: string;
  /** Role KEYS from QUALIFYING assignments — active, and not from the future. */
  readonly heldRoleKeys: readonly string[];
  readonly accessVersion: number;
  /** True when an assignment was excluded as stale. Reported, never silently swallowed. */
  readonly hadStaleAssignment: boolean;
}

export interface ResolveContextInput {
  readonly identityProvider?: string;
  readonly externalSubject: string;
  /**
   * The tenant the caller SAYS it means. Checked against membership, never adopted. Optional, and
   * only needed by a principal who belongs to more than one tenant.
   */
  readonly requestedTenantId?: string | null;
}

/**
 * Resolve an authenticated subject into the context every trusted operation runs under.
 *
 * Reads only the policy database. Throws `PrincipalContextError` rather than returning a partially
 * usable context: an operation that ran with "no tenant" or "no Roles" would be an operation
 * running with authority nobody granted.
 */
export async function resolvePrincipalContext(
  reader: PolicyReader,
  input: ResolveContextInput,
): Promise<PrincipalContext> {
  const identityProvider = input.identityProvider ?? FIREBASE_IDENTITY_PROVIDER;
  const subject = typeof input.externalSubject === "string" ? input.externalSubject.trim() : "";
  if (subject.length === 0) throw new PrincipalContextError("UNKNOWN_PRINCIPAL", "no authenticated subject");

  const principal = await reader.getPrincipalBySubject(identityProvider, subject);
  if (!principal) throw new PrincipalContextError("UNKNOWN_PRINCIPAL");
  // A disabled principal is refused outright rather than resolved to zero Roles. The two look the
  // same to an attacker and very different to an operator reading a log.
  if (principal.status !== "active") throw new PrincipalContextError("PRINCIPAL_DISABLED");

  const memberships = (await reader.listMembershipsForPrincipal(principal.id)).filter(
    (m) => m.status === "active",
  );
  if (memberships.length === 0) throw new PrincipalContextError("NO_TENANT_MEMBERSHIP");

  const requested = typeof input.requestedTenantId === "string" ? input.requestedTenantId.trim() : "";
  let tenantId: TenantId;
  if (requested.length > 0) {
    const match = memberships.find((m) => m.tenantId === requested);
    // REFUSED, not narrowed. Falling back to the principal's own tenant here would make a spoofed
    // id indistinguishable from a correct one in every log and every response.
    if (!match) throw new PrincipalContextError("TENANT_NOT_A_MEMBERSHIP");
    tenantId = match.tenantId;
  } else if (memberships.length === 1) {
    tenantId = memberships[0].tenantId;
  } else {
    throw new PrincipalContextError("AMBIGUOUS_TENANT", "this principal belongs to several tenants; state one");
  }

  const tenant = await reader.getTenant(tenantId);
  if (!tenant) throw new PrincipalContextError("NO_TENANT_MEMBERSHIP");
  // A suspended tenant confers nothing on anybody, administrator included.
  if (tenant.status !== "active") throw new PrincipalContextError("TENANT_NOT_ACTIVE");

  // QUALIFYING assignments only — the same rule the resolver uses, resolved in the same place, so
  // administration authority and object access can never disagree about which Roles are held.
  const policy = await loadPrincipalPolicy(reader, tenantId, principal.id);
  const roles = await reader.listRoles(tenantId);
  const keyById = new Map(roles.map((r) => [r.id, r.key]));
  const heldRoleKeys = [...new Set(
    policy.qualifyingRoleIds.map((id) => keyById.get(id)).filter((k): k is string => typeof k === "string"),
  )].sort();

  const versionRow = await reader.getAccessVersion(tenantId, principal.id);

  return Object.freeze({
    principal,
    tenant,
    tenantId,
    uid: principal.id,
    heldRoleKeys: Object.freeze(heldRoleKeys),
    accessVersion: typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0,
    hadStaleAssignment: policy.hadStaleAssignment,
  });
}

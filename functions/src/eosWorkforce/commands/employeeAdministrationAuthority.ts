// THE ADMINISTERING ACTOR FOR THE GOVERNED EMPLOYEE ADMINISTRATION COMMANDS -- resolved from
// PostgreSQL, never asserted by a caller.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// Until this lane there was NO governed PostgreSQL Employee WRITER at all: the only two things that
// `INSERT INTO eos_workforce.employees` were the synthetic nonprod workforce seed and
// seedSampleCompany.js, both direct-insert fixture seeds, and provisionEmployeeAccess.js writes
// Firestore. A fixture seed constructs its own capability set, or none, because nothing is standing
// in front of it. A governed command has a gate, and a gate is only real if the capability set
// reaching it was READ rather than supplied -- the reason seedPersonaAuthorityDimensionsCli.js's
// header gives, in its own words: "a fabricated one would make the command's own capability gate
// decorative, which is the one thing a seed must never do to a guard it is standing in front of."
//
// So the Employee administration commands (commands/employeeCreationCommand.ts,
// commands/employeePrincipalLinkCommands.ts) take an actor that ONE of exactly two resolutions
// produced, and there is no third:
//
//   HTTP        workforceHttp.ts -> resolveOperationalContext (verified subject -> EOS Principal,
//               ACTIVE membership, qualifying Roles, eos_policy.role_capabilities). The transport
//               refuses a body that carries tenantId, principalId, capabilities, heldRoleKeys or
//               roles before it looks at the token.
//   OPERATOR    `resolveEmployeeAdministrationActor` below, from a NAMED --adminPrincipalId. The
//               Roles come from the Principal's ACTIVE assignments and the capabilities from
//               `capabilitiesForRoleKeys` -- the same join the transport uses.
//
// ════════════════════ NO ARGV-SUPPLIED AUTHORITY ════════════════════
//
// `assertNoSuppliedAuthority` refuses, by name, every field that would STATE authority rather than
// NAME a target: heldRoleKeys, roles, capabilities, entitlements, grants, permissions, securityRole.
// This is the AUTHORITY_ARGUMENT_REFUSED precedent the governed Principal identity RE-BIND operator
// tool established, moved to where the resolution happens so the operator wrapper and any future
// caller inherit it rather than re-implement it. A refused flag is refused BEFORE a database is opened.
//
// ════════════════════ DIRECT PRINCIPAL GRANTS COUNT (standing Owner ruling) ════════════════════
//
// `resolveOperationalContext` resolves capabilities from ROLES ONLY, and capabilityAuthority.ts says
// why in so many words: folding `eos_policy.principal_capabilities` into that set would widen
// effective access for all thirteen gate sites under cover of a refactor, so
// `principalCapabilityGrants` is kept separate for "a future direct-grant activation [that] is a
// deliberate composition".
//
// THIS IS THAT DELIBERATE COMPOSITION, and it is scoped to these commands and nothing else.
// `withDirectCapabilityGrants` is applied by the Employee administration commands alone; no other
// read, command or transport behaviour changes. It can only ever ADD the specific capability keys an
// administrator already granted to that Principal through the governed Administration path, in the
// actor's own tenant, and it adds them with the PRINCIPAL grantor kept, so a conditioned direct
// grant would be evaluated as a conditioned grant rather than silently promoted to an unconditional
// one.
//
// LAZY, in the Owner's order. The Role set is the first boundary and it is consulted first. The
// direct-grant read happens ONLY when the Role set does not already carry the required capability --
// a caller the Roles admit costs zero extra reads, and a caller nothing admits costs exactly one.
//
// ════════════════════ WHAT THIS FILE NEVER DOES ════════════════════
//
// It creates nothing: no Principal, no membership, no Role, no assignment, no capability, no grant,
// no Employee and no link. Every statement here is a SELECT. It never reads Firebase, never accepts
// a uid, token or custom claim as authority, and never narrows a refusal into an empty capability
// set -- an unknown, disabled or non-member Principal is REFUSED.
import type { Pool } from "pg";
import {
  capabilitiesForRoleKeys, principalCapabilityGrants, type PrincipalCapabilityGrantRow,
} from "../../eosOps/capabilityAuthority";
import { resolveDirectEntitlements, resolveRoleEntitlements } from "../../eosOps/entitledActionAuthority";
import {
  entitlementsFrom, hasResolvedEntitlements, type EntitlementResolver, type EntitlementSet,
} from "../../eosOps/conditionalEntitlement";
import { EmployeeCommandError, ID_SHAPE, type EmployeeCommandActor } from "./employeeCommandKernel";

/**
 * Field and flag names that would SUPPLY authority instead of naming a target.
 *
 * `principalId` is deliberately ABSENT: the Employee administration commands name a TARGET Principal
 * for the Employee<->Principal link, and the transport already refuses `principalId` in a body, which
 * is why those commands spell their target `linkedPrincipalId` / `newPrincipalId` /
 * `expectedCurrentPrincipalId` and never `principalId`.
 */
export const SUPPLIED_AUTHORITY_FIELDS: readonly string[] = Object.freeze([
  "capabilities", "capability", "entitlements", "entitlement", "grant", "grants", "heldRoleKeys",
  "heldRoles", "permission", "permissions", "role", "roleKeys", "roles", "securityRole", "securityRoles",
]);

/**
 * Refuse a caller that states authority. Runs before any connection is opened, so the refusal costs
 * no read and cannot be confused with a database answer.
 */
export function assertNoSuppliedAuthority(named: readonly string[]): void {
  const supplied = SUPPLIED_AUTHORITY_FIELDS.filter((f) => named.includes(f));
  if (supplied.length > 0) {
    throw new EmployeeCommandError("AUTHORITY_ARGUMENT_REFUSED", "FORBIDDEN",
      `${supplied.join(", ")} would SUPPLY authority. The administering Principal's Roles are READ FROM `
      + "PostgreSQL from its active assignments and its capabilities resolved from eos_policy.role_capabilities "
      + "and eos_policy.principal_capabilities; no Role, capability, entitlement or grant is ever accepted as "
      + "an argument, because an asserted capability set makes the governed command's own gate decorative.");
  }
}

const isResolvedActor = (actor: unknown): actor is EmployeeCommandActor => {
  const a = actor as EmployeeCommandActor | null;
  return !!a && ID_SHAPE(a.tenantId) && ID_SHAPE(a.principalId) && a.capabilities instanceof Set
    && hasResolvedEntitlements(a);
};

/** One memoized resolution per actor, and a rejection is memoized too: an outage never becomes an allow. */
function memoize(resolve: () => Promise<EntitlementSet>): EntitlementResolver {
  let pending: Promise<EntitlementSet> | undefined;
  return () => (pending ??= resolve());
}

/**
 * The SAME actor, with this Principal's DIRECT capability grants counted.
 *
 * Returns the actor unchanged when the Role-resolved set already carries `requiredCapability` (the
 * lazy order), when the actor is not a resolved actor at all (the command kernel refuses it, and
 * refusing there keeps one refusal in one place), or when the Principal holds no direct grant.
 *
 * `capabilityKeysOf(await actor.entitlements())` still EQUALS `actor.capabilities` on the way out:
 * both sides take the union, so the two resolvers cannot drift apart.
 */
export async function withDirectCapabilityGrants(
  pool: Pool, actor: EmployeeCommandActor, requiredCapability: string,
): Promise<EmployeeCommandActor> {
  if (!isResolvedActor(actor) || actor.capabilities.has(requiredCapability)) return actor;
  let direct: readonly PrincipalCapabilityGrantRow[];
  try {
    direct = await principalCapabilityGrants(pool, actor.tenantId, actor.principalId);
  } catch {
    // FAIL CLOSED. An unreadable grant store is not "no direct grants": it is an authority that
    // could not be consulted, and the command must refuse rather than decide without it.
    throw new EmployeeCommandError("DIRECT_GRANT_AUTHORITY_UNAVAILABLE", "FAILED",
      "the direct capability grants of the administering Principal could not be read");
  }
  if (direct.length === 0) return actor;
  const capabilities: ReadonlySet<string> = new Set([...actor.capabilities, ...direct.map((g) => g.capabilityKey)]);
  const roleEntitlements = actor.entitlements;
  return Object.freeze({
    tenantId: actor.tenantId,
    principalId: actor.principalId,
    capabilities,
    // The Role entitlements this request already resolved, plus the direct grants with the PRINCIPAL
    // grantor kept. Provenance survives, so a conditioned direct grant stays conditioned.
    entitlements: memoize(async () => Object.freeze([
      ...(await roleEntitlements()),
      ...entitlementsFrom(direct.map((g) => ({ grantor: { kind: "PRINCIPAL" as const, principalId: g.principalId }, capabilityKey: g.capabilityKey }))),
    ])),
  });
}

export interface EmployeeAdministrationActor extends EmployeeCommandActor {
  /** The ACTIVE Role keys the resolution read, for the operator report. Never an input. */
  readonly heldRoleKeys: readonly string[];
  /** The DIRECT capability keys the resolution read, for the operator report. Never an input. */
  readonly directCapabilityKeys: readonly string[];
}

/**
 * Resolve a NAMED administering Principal to an actor, entirely from PostgreSQL.
 *
 * The operator entry point's authority, and the only resolution besides the transport's. It refuses
 * -- never narrows -- an unknown Principal, a disabled Principal, or a Principal with no ACTIVE
 * membership in the named tenant. A Principal holding zero Roles and zero direct grants resolves
 * successfully with an EMPTY capability set: "authenticated but authorized for nothing", which the
 * command's own gate then refuses with CAPABILITY_REQUIRED. That refusal is the gate working, and it
 * is never fixed by handing the caller a set.
 */
export async function resolveEmployeeAdministrationActor(
  pool: Pool, request: { readonly tenantId: string; readonly principalId: string },
): Promise<EmployeeAdministrationActor> {
  assertNoSuppliedAuthority(Object.keys(request ?? {}));
  const { tenantId, principalId } = request ?? ({} as { tenantId?: string; principalId?: string });
  if (!ID_SHAPE(tenantId) || !ID_SHAPE(principalId)) {
    throw new EmployeeCommandError("ADMINISTRATOR_REQUIRED", "FORBIDDEN",
      "a tenant id and an administering Principal id are required; neither is inferred");
  }
  const member = await pool.query(
    `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
    [tenantId, principalId],
  );
  if (member.rows.length === 0) {
    throw new EmployeeCommandError("ADMINISTRATOR_NOT_ACTIVE_MEMBER", "FORBIDDEN",
      "the administering Principal must be an ACTIVE Principal with an ACTIVE membership in this tenant");
  }
  // ACTIVE assignments only, mapped assignment -> Role key through the tenant's own Role catalog.
  const heldRoleKeys = (await pool.query<{ key: string }>(
    `SELECT DISTINCT r.key AS key FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
      WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND r.tenant_id = $1
      ORDER BY r.key`,
    [tenantId, principalId],
  )).rows.map((r) => r.key);
  // BOTH grant relations, because the Owner's standing ruling is that a direct Principal grant
  // counts. The union is taken once, here, so the flat set and the entitlement list agree.
  const [roleCapabilities, direct] = await Promise.all([
    capabilitiesForRoleKeys(pool, tenantId, heldRoleKeys),
    principalCapabilityGrants(pool, tenantId, principalId),
  ]);
  const directCapabilityKeys = Object.freeze(direct.map((g) => g.capabilityKey));
  const capabilities: ReadonlySet<string> = new Set([...roleCapabilities, ...directCapabilityKeys]);
  return Object.freeze({
    tenantId,
    principalId,
    capabilities,
    entitlements: memoize(async () => {
      const [roles, principals] = await Promise.all([
        resolveRoleEntitlements(pool, tenantId, heldRoleKeys),
        resolveDirectEntitlements(pool, tenantId, principalId),
      ]);
      return Object.freeze([...roles, ...principals]);
    }),
    heldRoleKeys: Object.freeze(heldRoleKeys),
    directCapabilityKeys,
  });
}

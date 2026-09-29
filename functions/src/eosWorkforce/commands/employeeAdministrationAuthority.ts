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
// Since lane DX (direct exceptions, complete support) `resolveOperationalContext` itself counts unexpired
// `eos_policy.principal_capabilities` rows through `resolveOperationalCapabilities` -- the ONE resolution every gate
// uses -- with a Role grant's semantics: conditions narrow a direct grant (conditioned-only keys are
// `conditionallyHeld`, never flat) and a direct grant has no scope. The operator resolution below calls the same
// function (it reads principalCapabilityGrants through it), so the transport and the operator cannot disagree.
//
// `withDirectCapabilityGrants` remains for an actor built outside that resolution (it is a no-op for a transport
// actor that already holds the key). It can only ADD unconditioned direct keys; a conditioned direct grant is added
// as an entitlement with its PRINCIPAL-cell condition, never as a flat key, and a key the resolution already placed
// in `conditionallyHeld` is never promoted.
//
// ════════════════════ WHAT THIS FILE NEVER DOES ════════════════════
//
// It creates nothing: no Principal, no membership, no Role, no assignment, no capability, no grant,
// no Employee and no link. Every statement here is a SELECT. It never reads Firebase, never accepts
// a uid, token or custom claim as authority, and never narrows a refusal into an empty capability
// set -- an unknown, disabled or non-member Principal is REFUSED.
import type { Pool } from "pg";
import { PostgresPolicyRepository } from "../../adminPolicy/postgresPolicyRepository";
import { employeeAccessIneligibility } from "../../adminPolicy/employmentAccessEligibility";
import { resolveOperationalCapabilities } from "../../eosOps/capabilityAuthority";
import { postgresGrantConditionProvider, resolveDirectEntitlements } from "../../eosOps/entitledActionAuthority";
import {
  hasResolvedEntitlements, type EntitlementResolver, type EntitlementSet,
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
  // SINCE LANE DX the transport's resolution (capabilityAuthority.resolveOperationalCapabilities) already counts
  // direct exceptions, WITH their conditions. A key it placed in `conditionallyHeld` is conditioned: it must never
  // be promoted into the flat set here, so the actor is returned unchanged and the command refuses it flat.
  const conditionallyHeld = (actor as { conditionallyHeld?: ReadonlySet<string> }).conditionallyHeld;
  if (conditionallyHeld instanceof Set && conditionallyHeld.has(requiredCapability)) return actor;
  let direct: EntitlementSet;
  try {
    // The Principal's unexpired direct grants WITH the PRINCIPAL-cell conditions from PostgreSQL: a conditioned
    // direct grant is an entitlement with its condition, never a flat key.
    const conditions = await postgresGrantConditionProvider(pool)(actor.tenantId);
    direct = await resolveDirectEntitlements(pool, actor.tenantId, actor.principalId, conditions);
  } catch {
    // FAIL CLOSED. An unreadable grant store is not "no direct grants": it is an authority that
    // could not be consulted, and the command must refuse rather than decide without it.
    throw new EmployeeCommandError("DIRECT_GRANT_AUTHORITY_UNAVAILABLE", "FAILED",
      "the direct capability grants of the administering Principal could not be read");
  }
  if (direct.length === 0) return actor;
  const unconditioned = direct.filter((e) => e.condition === null).map((e) => e.capabilityKey);
  const capabilities: ReadonlySet<string> = new Set([...actor.capabilities, ...unconditioned]);
  const roleEntitlements = actor.entitlements;
  return Object.freeze({
    tenantId: actor.tenantId,
    principalId: actor.principalId,
    capabilities,
    // The entitlements this request already resolved, plus the direct grants with the PRINCIPAL grantor and their
    // condition kept -- de-duplicated, because the transport's resolver may already carry them.
    entitlements: memoize(async () => {
      const resolved = await roleEntitlements();
      const seen = new Set(resolved.map((e) => `${e.grantor.kind}:${(e.grantor as { principalId?: string; roleKey?: string }).principalId ?? (e.grantor as { roleKey?: string }).roleKey}|${e.capabilityKey}`));
      return Object.freeze([...resolved, ...direct.filter((e) => !seen.has(`PRINCIPAL:${(e.grantor as { principalId: string }).principalId}|${e.capabilityKey}`))]);
    }),
  });
}

export interface EmployeeAdministrationActor extends EmployeeCommandActor {
  /** Keys reachable only through conditioned grants (Role or direct). Never flat; the entitled seam decides them. */
  readonly conditionallyHeld: ReadonlySet<string>;
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
  // EMPLOYMENT ACCESS ELIGIBILITY (DQ-007): the same rule, the same relations, as principal resolution -- an
  // administering Principal linked to a non-eligible Employee administers nothing, whatever Roles remain assigned.
  const ineligible = employeeAccessIneligibility(await new PostgresPolicyRepository(pool).getLinkedEmployeeAccessFact(tenantId, principalId));
  if (ineligible) {
    throw new EmployeeCommandError("ADMINISTRATOR_NOT_ACCESS_ELIGIBLE", "FORBIDDEN", `the administering Principal is refused: ${ineligible}`);
  }
  // ACTIVE, GLOBAL, NON-STALE assignments only (Pass 9 S3) -- the runtime's rule (loadPrincipalPolicy
  // .qualifyingRoleIds). A SCOPED assignment is decided only against a record's business context, which an operator
  // command has none of, so it contributes nothing here; counting it would make "Role @ Company X" tenant-wide.
  const heldRoleKeys = (await pool.query<{ key: string }>(
    `SELECT DISTINCT r.key AS key FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
       LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
      WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND r.tenant_id = $1
        AND a.scope_type = 'global' AND a.access_version_at_grant <= coalesce(v.access_version, 0)
      ORDER BY r.key`,
    [tenantId, principalId],
  )).rows.map((r) => r.key);
  // BOTH grant relations, because the Owner's standing ruling is that a direct Principal grant counts -- resolved
  // by THE runtime capability resolution (lane DX), with conditions from PostgreSQL, so a conditioned grant of
  // either kind is never flat here and an expired direct exception confers nothing.
  const resolved = await resolveOperationalCapabilities(pool, tenantId, principalId, heldRoleKeys,
    postgresGrantConditionProvider(pool));
  const directCapabilityKeys = Object.freeze(resolved.directGrants.map((g) => g.capabilityKey));
  return Object.freeze({
    tenantId,
    principalId,
    capabilities: resolved.capabilities,
    conditionallyHeld: resolved.conditionallyHeld,
    entitlements: resolved.entitlements,
    heldRoleKeys: Object.freeze(heldRoleKeys),
    directCapabilityKeys,
  });
}

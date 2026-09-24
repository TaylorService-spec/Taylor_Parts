// Operational capability resolution — the authorization primitive every eos_ops command sits on.
//
// ════════════════════ THE PATH, AND ONLY THIS PATH ════════════════════
//
//   authenticated external subject
//        -> eos_policy.principals            (resolvePrincipalContext, unchanged)
//        -> ACTIVE tenant membership          (resolvePrincipalContext, unchanged)
//        -> QUALIFYING Role assignments       (resolvePrincipalContext.heldRoleKeys, unchanged)
//        -> Role capability grants            (THIS FILE: eos_policy.role_capabilities)
//        -> one held capability key
//
// This reuses `resolvePrincipalContext` exactly as the Administration API does -- the same tenant
// resolution, the same "a stated tenantId is checked, never adopted" rule, the same refusal shape
// for a disabled principal or a principal with no membership. Nothing about identity or tenancy is
// reinvented here; only the LAST hop -- Role -> capability -- is new, because the Administration API
// answers "may this Role CRED this Object", not "does this Role hold this operational capability".
//
// ════════════════════ WHY THIS FILE DOES NOT LIVE UNDER src/adminPolicy ════════════════════
//
// `src/adminPolicy`'s own Firebase regression guard (test/adminPolicyNoFirebase.test.mjs) also
// pins the DAL to exactly two files permitted to import `pg` or read `process.env`. Adding a third
// reader there would mean widening that allowlist for a table this module reads but does not own --
// `eos_policy.role_capabilities` is still `adminPolicy`'s schema and `adminPolicy`'s migration owns
// it. This file is a SEPARATE, read-only consumer of that schema, the same way a second application
// can read one Postgres database without becoming part of the first application's module boundary.
// It reuses the SAME pool (`getPolicyDatabasePool`) rather than opening a second connection --
// "one database connection" is a deployment rule, not a rule about which directory may query it.
//
// No SQL beyond this file: a domain command asks `resolveOperationalCapabilities` for a Set and
// never queries `role_capabilities` itself.
import type { Pool } from "pg";
export type { Pool } from "pg";
import { getPolicyDatabasePool } from "../adminPolicy/policyDatabase";
import { resolvePrincipalContext } from "../adminPolicy/principalContext";
import type { PrincipalContext, ResolveContextInput } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";

const SCHEMA = "eos_policy";

export type OperationalCapabilityKey =
  | "inventory.cycleCount.create"
  | "inventory.cycleCount.submit"
  | "inventory.cycleCount.cancel"
  | "inventory.cycleCount.reconcile"
  | "inventory.cycleCount.close";

export interface ResolvedOperationalContext {
  readonly principalContext: PrincipalContext;
  /** Capability KEYS held via active Role assignments, in the resolved tenant only. */
  readonly capabilities: ReadonlySet<string>;
}

/**
 * Resolve an authenticated subject to its tenant, Roles and operational capabilities.
 *
 * Refuses (via `resolvePrincipalContext`'s own errors) exactly as the Administration API does --
 * no reduced-access fallback, ever. A principal holding zero qualifying Roles resolves successfully
 * with an EMPTY capability set, which is what "authenticated but not authorized for anything
 * operational" looks like; it is the caller's job to then refuse the specific operation, not this
 * function's job to throw for it.
 */
export async function resolveOperationalContext(
  reader: PolicyReader,
  pool: Pool,
  input: ResolveContextInput,
): Promise<ResolvedOperationalContext> {
  const principalContext = await resolvePrincipalContext(reader, input);
  const capabilities = await capabilitiesForRoleKeys(pool, principalContext.tenantId, principalContext.heldRoleKeys);
  return Object.freeze({ principalContext, capabilities });
}

/**
 * The role_capabilities join, resolved by Role KEY (what `resolvePrincipalContext` already computed)
 * rather than by Role id -- so this file needs no second identity lookup and cannot disagree with
 * the Administration API about which Roles are held.
 */
export async function capabilitiesForRoleKeys(
  pool: Pool,
  tenantId: string,
  roleKeys: readonly string[],
): Promise<ReadonlySet<string>> {
  if (roleKeys.length === 0) return new Set();
  const { rows } = await pool.query<{ key: string }>(
    `SELECT DISTINCT c.key AS key
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])`,
    [tenantId, roleKeys],
  );
  return new Set(rows.map((r) => r.key));
}

/** Convenience for a command that needs the pool this module already knows how to build. */
export function operationalCapabilityPool(): Pool {
  return getPolicyDatabasePool();
}

/**
 * Every capability key the catalog currently declares. Exists so callers outside this module --
 * the P1A inventory-authority capability parity harness (adminPolicy/migration/
 * inventoryCapabilityParityHarness.ts) in particular -- never need their own SQL or their own
 * `pg` import to answer "is this capability key known" -- exactly the same "no SQL beyond this
 * file" rule the module header already states for `role_capabilities`.
 */
export async function listCapabilityKeys(pool: Pool): Promise<ReadonlySet<string>> {
  const { rows } = await pool.query<{ key: string }>(`SELECT key FROM ${SCHEMA}.capabilities`);
  return new Set(rows.map((r) => r.key));
}

// ════════════════════ PROVENANCE-PRESERVING RESOLUTION ════════════════════
//
// `capabilitiesForRoleKeys` returns `SELECT DISTINCT c.key` as a flat `Set<string>`, which is the
// right answer to "what may this Principal do" and structurally unable to answer "and WHO granted
// it". That second fact is what a per-GRANT condition needs: a condition that cannot name its
// grantor is a condition on every holder of the key. See eosOps/conditionalEntitlement.ts.
//
// These readers are ADDITIVE. `capabilitiesForRoleKeys` is untouched, still the authority every
// existing caller uses, and `capabilityKeysOf(roleCapabilityGrants(...))` is EQUAL to it for the
// same Roles -- proved by test, because a second resolver that disagreed with the first would be a
// second policy.

/** One (Role -> capability) grant row, with the granting Role KEY kept. */
export interface RoleCapabilityGrantRow {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

/**
 * The same join `capabilitiesForRoleKeys` performs, WITHOUT the DISTINCT-on-key that discards the
 * Role. Same table, same tenant guard, same resolution by Role key; only the projection differs.
 */
export async function roleCapabilityGrants(
  pool: Pool,
  tenantId: string,
  roleKeys: readonly string[],
): Promise<readonly RoleCapabilityGrantRow[]> {
  if (roleKeys.length === 0) return Object.freeze([]);
  const { rows } = await pool.query<{ role_key: string; capability_key: string }>(
    `SELECT DISTINCT r.key AS role_key, c.key AS capability_key
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])
      ORDER BY r.key, c.key`,
    [tenantId, roleKeys],
  );
  return Object.freeze(rows.map((r) => Object.freeze({ roleKey: r.role_key, capabilityKey: r.capability_key })));
}

/** One (Principal -> capability) DIRECT grant row. */
export interface PrincipalCapabilityGrantRow {
  readonly principalId: string;
  readonly capabilityKey: string;
}

/**
 * Direct grants for one Principal (AB3).
 *
 * DELIBERATELY SEPARATE from `roleCapabilityGrants`, and NOT folded into
 * `resolveOperationalContext`: the operational runtime resolves capabilities from Roles ONLY today,
 * and quietly adding direct grants to that set here would WIDEN effective access under the cover of
 * a refactor. A caller that wants direct grants asks for them explicitly.
 */
export async function principalCapabilityGrants(
  pool: Pool,
  tenantId: string,
  principalId: string,
): Promise<readonly PrincipalCapabilityGrantRow[]> {
  const { rows } = await pool.query<{ principal_id: string; capability_key: string }>(
    `SELECT DISTINCT pc.principal_id AS principal_id, c.key AS capability_key
       FROM ${SCHEMA}.principal_capabilities pc
       JOIN ${SCHEMA}.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND pc.principal_id = $2
      ORDER BY c.key`,
    [tenantId, principalId],
  );
  return Object.freeze(rows.map((r) => Object.freeze({ principalId: r.principal_id, capabilityKey: r.capability_key })));
}

/** The relation that holds per-grant conditions. NOT YET MIGRATED -- see PROPOSED_GRANT_CONDITION_SCHEMA. */
export const GRANT_CONDITION_RELATION = `${SCHEMA}.capability_grant_conditions`;

/** One stored per-grant condition row, as the relation holds it. */
export interface GrantConditionRelationRow {
  readonly grantScope: "ROLE" | "PRINCIPAL";
  readonly grantorKey: string;
  readonly capabilityKey: string;
  readonly condition: unknown;
}

/**
 * Read the ACTIVE per-grant conditions for one tenant.
 *
 * INERT UNTIL THE RELATION EXISTS. No migration creates it this Wave (Lane AA owns the slot), so
 * against a currently-migrated database this throws `relation does not exist` -- which the entitled
 * decision path turns into CONTEXT_AUTHORITY_UNAVAILABLE, never into "then there are no
 * conditions". Reading a missing condition store as "unconditioned" would convert every conditioned
 * grant into an unconditional one, so it fails closed instead.
 */
export async function grantConditionRows(
  pool: Pool,
  tenantId: string,
): Promise<readonly GrantConditionRelationRow[]> {
  const { rows } = await pool.query<{ grant_scope: "ROLE" | "PRINCIPAL"; grantor_key: string; capability_key: string; condition: unknown }>(
    `SELECT grant_scope, grantor_key, capability_key, condition
       FROM ${GRANT_CONDITION_RELATION}
      WHERE tenant_id = $1 AND status = 'ACTIVE'
      ORDER BY grant_scope, grantor_key, capability_key`,
    [tenantId],
  );
  return Object.freeze(rows.map((r) => Object.freeze({
    grantScope: r.grant_scope, grantorKey: r.grantor_key, capabilityKey: r.capability_key, condition: r.condition,
  })));
}

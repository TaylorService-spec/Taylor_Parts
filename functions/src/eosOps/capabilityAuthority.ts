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

// Operational capability resolution — the authorization primitive every eos_ops command sits on.
//
// ════════════════════ THE PATH, AND ONLY THIS PATH ════════════════════
//
//   authenticated external subject
//        -> eos_policy.principals            (resolvePrincipalContext, unchanged)
//        -> ACTIVE tenant membership          (resolvePrincipalContext, unchanged)
//        -> QUALIFYING Role assignments       (resolvePrincipalContext.heldRoleKeys, unchanged)
//        -> Role capability grants            (THIS FILE: eos_policy.role_capabilities)
//         + DIRECT EXCEPTIONS (unexpired)     (THIS FILE: eos_policy.principal_capabilities, lane DX)
//        -> grant conditions (ROLE | PRINCIPAL cells) narrow either kind; conditioned-only keys are never flat
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
import { resolvePrincipalContext, resolvePrincipalContextById } from "../adminPolicy/principalContext";
import type { PrincipalContext, ResolveContextInput } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import {
  scopedHoldingsFrom,
  type InertScopedCapability,
  type ScopedHolding,
} from "../adminPolicy/assignmentScopeRuntime";
import {
  entitlementsFrom,
  grantCellKey,
  type GrantCondition,
  SHIPPED_GRANT_CONDITIONS,
  type CapabilityGrant,
  type EntitlementResolver,
  type EntitlementSet,
  type GrantConditionCatalog,
} from "./conditionalEntitlement";
import {
  GRANT_CONDITION_RELATION_NAME,
  GRANT_CONDITION_RELATION_SHAPE,
} from "./grantConditionPolicy";

const SCHEMA = "eos_policy";

export type OperationalCapabilityKey =
  | "inventory.cycleCount.create"
  | "inventory.cycleCount.submit"
  | "inventory.cycleCount.cancel"
  | "inventory.cycleCount.reconcile"
  | "inventory.cycleCount.close";

/**
 * WHERE THE CONDITIONS COME FROM — server composition, resolved LAZILY.
 *
 * A PROVIDER rather than a catalog, for the same reason `entitlements` is a provider: the deployed
 * composition must be able to name PostgreSQL as the condition source without paying for a read on
 * every request, including the eleven of thirteen gate sites that never consult the answer.
 *
 * It is a function of the RESOLVED tenant, never of anything the caller sent. Which provider is
 * composed is a deployment decision (`deps.grantConditionSource`), never a request field.
 */
export type GrantConditionProvider =
  (tenantId: string) => GrantConditionCatalog | Promise<GrantConditionCatalog>;

/** The deployed provider: the SHIPPED catalog, which is empty, frozen, and costs ZERO queries. */
export const SHIPPED_GRANT_CONDITION_PROVIDER: GrantConditionProvider = () => SHIPPED_GRANT_CONDITIONS;

/**
 * What ONE request actually spent on conditional entitlement. Deterministic integers, no clock.
 *
 * `requests` counts how many times a gate site ASKED this request for its entitlements;
 * `resolutions` counts how many times the grant and condition stores were actually READ. With
 * request-scoped memoization `resolutions` is 0 (nobody asked) or 1 (somebody asked, once or many
 * times) and is never larger, whatever a kernel's capability loop does.
 */
export interface EntitlementLookupCounters {
  readonly requests: number;
  readonly resolutions: number;
}

interface MutableLookupCounters { requests: number; resolutions: number }

export interface ResolvedOperationalContext {
  readonly principalContext: PrincipalContext;
  /**
   * Capability KEYS held via active Role assignments UNCONDITIONALLY, in the resolved tenant only --
   * the set every flat gate reads. A key reachable only through a conditioned grant is NOT here.
   */
  readonly capabilities: ReadonlySet<string>;
  /**
   * Keys held ONLY through conditioned grants. Never a flat-gate answer: only the entitled seam
   * (authorizeEntitledAction, via the actor's `conditionallyHeld`) may evaluate them, per record.
   */
  readonly conditionallyHeld: ReadonlySet<string>;
  /**
   * SCOPE-QUALIFIED HOLDINGS (lane SC): capabilities held ONLY through a qualifying NON-GLOBAL assignment, each with
   * its scope type, value, source Role and grant condition. NEVER in `capabilities` and never in `conditionallyHeld`:
   * only the entitled seam decides them, and only when the decision supplies the record's business context for that
   * scope type (authorizeEntitledAction `businessContext`). Empty for every principal without a scoped assignment --
   * which costs ZERO extra reads.
   */
  readonly scopedHeld: readonly ScopedHolding<GrantCondition>[];
  /** Capabilities of scoped assignments the runtime cannot decide at that scope. Reported; grant nothing. */
  readonly inertScoped: readonly InertScopedCapability[];
  /**
   * DIRECT EXCEPTIONS (lane DX): this Principal's UNEXPIRED `principal_capabilities` rows, read on the request path.
   * They are a capability SOURCE with exactly the semantics of a Role grant: an unconditioned one is in `capabilities`,
   * one narrowed by an ACTIVE PRINCIPAL-scoped condition is in `conditionallyHeld` only, and each is an entitlement
   * with the PRINCIPAL grantor kept. A direct grant carries NO scope (the relation has no scope column), so it never
   * produces a scoped holding. Reported here for the explanation; no gate reads this field to decide.
   */
  readonly directGrants: readonly PrincipalCapabilityGrantRow[];
  /**
   * THE SAME GRANTS, WITH THE GRANTOR AND ITS CONDITION KEPT -- behind a REQUIRED, REQUEST-SCOPED,
   * MEMOIZING resolver.
   *
   * Every one of the EOS transports composes `resolveOperationalContext`, so this is the single
   * place provenance can enter the runtime without thirteen separate changes -- and, for the same
   * reason, the single place a per-request cost lands on all of them. Eleven of the thirteen gate
   * sites read `capabilities.has(key)` and never look at this at all, so resolving it eagerly spent
   * one indexed read of `role_capabilities` per request to answer a question nobody asked.
   *
   * DEFERRING THE WORK IS NOT DEFERRING THE OBLIGATION. This is a required field holding a required
   * PROVIDER, not an optional value: a caller cannot omit it, cannot substitute a stale array for
   * it, and cannot hand in one that answers "unconditioned" when the store is unreadable -- the
   * provider propagates the failure and `authorizeEntitledAction` refuses
   * CONTEXT_AUTHORITY_UNAVAILABLE. `capabilityKeysOf(await entitlements())` still EQUALS
   * `capabilities` above.
   *
   * MEMOIZED FOR THIS REQUEST AND NOTHING LONGER. The promise lives on this frozen context object
   * and dies with it. There is no TTL, no global cache, no invalidation: a second request resolves
   * again, from the store, as it must.
   */
  readonly entitlements: EntitlementResolver;
  /** What this request spent. See EntitlementLookupCounters. */
  readonly lookups: EntitlementLookupCounters;
}

/**
 * The request-scoped, memoizing entitlement resolver.
 *
 * ONE resolution per request, however many gate sites ask and however many capabilities a kernel
 * checks in its loop. A REJECTION is memoized too, deliberately: the store was unreadable for this
 * request, and a retry inside the same request must not be able to turn that outage into a
 * successful "no conditions found".
 */
function requestScopedEntitlementResolver(
  pool: Pool,
  tenantId: string,
  heldRoleKeys: readonly string[],
  direct: readonly PrincipalCapabilityGrantRow[],
  conditions: GrantConditionProvider,
  counters: MutableLookupCounters,
): EntitlementResolver {
  let pending: Promise<EntitlementSet> | undefined;
  return () => {
    counters.requests += 1;
    if (pending) return pending;
    counters.resolutions += 1;
    pending = (async () => {
      // The provenance read and the condition catalog, together, and only now. `capabilitiesForRoleKeys`
      // already answered "what may this Principal do"; this answers "and WHO granted it, under what".
      // The direct grants were read ONCE, on the request path, and are reused here -- so the flat set and the
      // entitlement list are built from the same rows and cannot disagree about a direct exception.
      const [grantRows, catalog] = await Promise.all([
        roleCapabilityGrants(pool, tenantId, heldRoleKeys),
        Promise.resolve(conditions(tenantId)),
      ]);
      return entitlementsFrom([...roleGrantsOf(grantRows), ...directGrantsOf(direct)], catalog);
    })();
    return pending;
  };
}

const roleGrantsOf = (rows: readonly RoleCapabilityGrantRow[]): CapabilityGrant[] =>
  rows.map((r) => ({ grantor: { kind: "ROLE", roleKey: r.roleKey }, capabilityKey: r.capabilityKey }));
const directGrantsOf = (rows: readonly PrincipalCapabilityGrantRow[]): CapabilityGrant[] =>
  rows.map((r) => ({ grantor: { kind: "PRINCIPAL", principalId: r.principalId }, capabilityKey: r.capabilityKey }));

/** What the ONE capability resolution produces for a Principal, before any scoped assignment is considered. */
export interface OperationalCapabilityResolution {
  /** Keys held UNCONDITIONALLY through a qualifying global Role grant OR an unexpired direct grant. */
  readonly capabilities: ReadonlySet<string>;
  /** Keys reachable ONLY through conditioned grants (Role or direct). Decided per record, never flat. */
  readonly conditionallyHeld: ReadonlySet<string>;
  /** The unexpired direct grants read for this resolution. */
  readonly directGrants: readonly PrincipalCapabilityGrantRow[];
  /** The condition catalog this resolution applied (for a caller that must build scoped holdings from it). */
  readonly catalog: GrantConditionCatalog;
  readonly entitlements: EntitlementResolver;
  readonly lookups: EntitlementLookupCounters;
}

/**
 * THE capability resolution -- Roles AND direct exceptions, one set of semantics. Every runtime entry point
 * (`resolveOperationalContext`, `resolveOperationalContextForPrincipal`) and the operator actor resolution
 * (employeeAdministrationAuthority) call this, so a direct grant is decided the same way on every gate:
 *
 *   capability sources   role_capabilities of the QUALIFYING GLOBAL Roles  +  UNEXPIRED principal_capabilities
 *   conditions           ONE catalog (ROLE and PRINCIPAL cells) from the composed provider
 *   flat set             a key with at least one UNCONDITIONED grant, of either kind
 *   conditionallyHeld    a key reached only through conditioned grants, of either kind -- never flat
 *   entitlements         every grant, with its grantor (ROLE or PRINCIPAL) and its condition
 *
 * An expired direct grant is not read at all (the SQL filters on `now()`), so it confers nothing on any gate. An
 * unreadable grant or condition store throws: "could not read" is never "holds nothing extra" nor "unconditioned".
 */
export async function resolveOperationalCapabilities(
  pool: Pool,
  tenantId: string,
  principalId: string,
  heldRoleKeys: readonly string[],
  conditions: GrantConditionProvider,
): Promise<OperationalCapabilityResolution> {
  if (typeof conditions !== "function") {
    throw new Error("resolveOperationalCapabilities: the condition source must be a GrantConditionProvider");
  }
  const [granted, catalog] = await Promise.all([
    grantedCapabilityKeys(pool, tenantId, heldRoleKeys, principalId),
    Promise.resolve(conditions(tenantId)),
  ]);
  const direct: readonly PrincipalCapabilityGrantRow[] = Object.freeze(granted.direct.map((capabilityKey) =>
    Object.freeze({ principalId, capabilityKey })));
  const held = new Set<string>([...granted.viaRoles, ...granted.direct]);
  // A CONDITIONED-ONLY CAPABILITY IS NEVER IN THE FLAT SET (Pass 8 D1, PLATFORM_SAFETY) -- for a direct grant
  // exactly as for a Role grant. The provenance read happens only when a condition names one of this
  // Principal's grantors (a held Role, or the Principal itself), so an unconditioned tenant pays nothing extra.
  const principalPrefix = `PRINCIPAL:${principalId}|`;
  const touches = [...catalog.keys()].some((k) =>
    k.startsWith(principalPrefix) || heldRoleKeys.some((r) => k.startsWith(`ROLE:${r}|`)));
  let capabilities: ReadonlySet<string> = held;
  let conditionallyHeld: ReadonlySet<string> = new Set<string>();
  if (touches) {
    const roleRows = heldRoleKeys.length > 0 ? await roleCapabilityGrants(pool, tenantId, heldRoleKeys) : [];
    const unconditional = new Set(entitlementsFrom([...roleGrantsOf(roleRows), ...directGrantsOf(direct)], catalog)
      .filter((e) => e.condition === null).map((e) => e.capabilityKey));
    capabilities = new Set([...held].filter((k) => unconditional.has(k)));
    conditionallyHeld = new Set([...held].filter((k) => !unconditional.has(k)));
  }
  const counters: MutableLookupCounters = { requests: 0, resolutions: 0 };
  const entitlements = requestScopedEntitlementResolver(pool, tenantId, heldRoleKeys, direct, () => catalog, counters);
  return Object.freeze({ capabilities, conditionallyHeld, directGrants: direct, catalog, entitlements, lookups: counters });
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
  conditions: GrantConditionProvider = SHIPPED_GRANT_CONDITION_PROVIDER,
): Promise<ResolvedOperationalContext> {
  // FAIL CLOSED ON A MISCOMPOSED SERVER. The fourth argument used to be a catalog; a deployment that
  // still passes one would silently produce a resolver that throws on first use. It refuses here,
  // loudly, at composition time, rather than one request later.
  if (typeof conditions !== "function") {
    throw new Error("resolveOperationalContext: the condition source must be a GrantConditionProvider");
  }
  const principalContext = await resolvePrincipalContext(reader, input);
  return operationalContextFor(pool, principalContext, conditions);
}

/**
 * The SAME operational context for a Principal named by id -- for Administration's effective-access
 * explanation only (never authentication). Principal resolution is `resolvePrincipalContextById`, which
 * shares its whole tail with `resolvePrincipalContext`; everything after it is this module's own code.
 */
export async function resolveOperationalContextForPrincipal(
  reader: PolicyReader,
  pool: Pool,
  principalId: string,
  requestedTenantId: string | null,
  conditions: GrantConditionProvider,
): Promise<ResolvedOperationalContext> {
  if (typeof conditions !== "function") {
    throw new Error("resolveOperationalContextForPrincipal: the condition source must be a GrantConditionProvider");
  }
  const principalContext = await resolvePrincipalContextById(reader, principalId, requestedTenantId);
  return operationalContextFor(pool, principalContext, conditions);
}

/** Principal context -> capabilities + the request-scoped entitlement resolver. Shared by both entry points. */
async function operationalContextFor(
  pool: Pool,
  principalContext: PrincipalContext,
  conditions: GrantConditionProvider,
): Promise<ResolvedOperationalContext> {
  // ONE RESOLUTION, TWO GRANT SOURCES (lane DX). Qualifying GLOBAL Role grants and unexpired DIRECT exceptions are
  // both capability sources, decided by `resolveOperationalCapabilities` with one set of rules: an unconditioned
  // grant of either kind is flat; a key reached only through conditioned grants of either kind is
  // `conditionallyHeld`, which only the entitled seam (authorizeEntitledAction) may evaluate, per record.
  const resolved = await resolveOperationalCapabilities(
    pool, principalContext.tenantId, principalContext.uid, principalContext.heldRoleKeys, conditions);
  const catalog = resolved.catalog;
  // SCOPED ASSIGNMENTS (lane SC). Resolved only when the principal HAS one, so a global-only principal pays nothing
  // and every existing decision is untouched. Only a runtime-supported scope type with an exact value can produce a
  // holding, and only for a capability a gate site decides at that scope; everything else is reported inert.
  // A direct grant has no scope and never appears here.
  const scoped = principalContext.scopedAssignments ?? [];
  let scopedHeld: readonly ScopedHolding<GrantCondition>[] = Object.freeze([]);
  let inertScoped: readonly InertScopedCapability[] = Object.freeze([]);
  if (scoped.length > 0) {
    const scopedRoleKeys = [...new Set(scoped.map((a) => a.roleKey))];
    const rows = await roleCapabilityGrants(pool, principalContext.tenantId, scopedRoleKeys);
    const result = scopedHoldingsFrom<GrantCondition>(scoped, rows,
      (roleKey, capabilityKey) => catalog.get(grantCellKey({ kind: "ROLE", roleKey }, capabilityKey)) ?? null);
    scopedHeld = result.held;
    inertScoped = result.inert;
  }
  return Object.freeze({
    principalContext,
    capabilities: resolved.capabilities,
    conditionallyHeld: resolved.conditionallyHeld,
    scopedHeld,
    inertScoped,
    directGrants: resolved.directGrants,
    entitlements: resolved.entitlements,
    lookups: resolved.lookups,
  });
}

/**
 * THE FLAT SET FOR A GATE THAT CANNOT EVALUATE CONDITIONS -- fail closed, never wider.
 *
 * The Commercial and CRM kernels decide on `capabilities.has(key)` alone; they have no record
 * context to answer a per-grant condition with. Handing them the full flat set would let a
 * CONDITIONED grant (e.g. "only records assigned to me") act as an UNCONDITIONAL one there -- a
 * widening an administrator never made. So such a transport receives the flat set MINUS every key
 * this principal reaches ONLY through conditioned entitlements. A key reached by at least one
 * unconditional grant is kept.
 *
 * ZERO-CONDITION PARITY. With no ACTIVE condition row for the tenant (the state of every tenant
 * until an administrator sets one) the catalog is empty and the set is returned UNCHANGED, after
 * exactly one indexed read of the condition relation -- byte-identical to the previous behaviour.
 * An unreadable condition store throws: "could not read the conditions" is never "there are none".
 */
export async function capabilitiesWithoutUnevaluatedConditions(
  pool: Pool,
  principalContext: PrincipalContext,
  capabilities: ReadonlySet<string>,
  conditions: GrantConditionProvider,
): Promise<ReadonlySet<string>> {
  const catalog = await conditions(principalContext.tenantId);
  if (catalog.size === 0) return capabilities;
  // BOTH grant sources (lane DX): a key held through an UNCONDITIONED direct exception is kept, exactly as one held
  // through an unconditioned Role grant is; a key reached only through conditioned grants of either kind is withheld.
  const [roleRows, direct] = await Promise.all([
    roleCapabilityGrants(pool, principalContext.tenantId, principalContext.heldRoleKeys),
    principalCapabilityGrants(pool, principalContext.tenantId, principalContext.uid),
  ]);
  const unconditional = new Set(entitlementsFrom([...roleGrantsOf(roleRows), ...directGrantsOf(direct)], catalog)
    .filter((e) => e.condition === null).map((e) => e.capabilityKey));
  return new Set([...capabilities].filter((key) => unconditional.has(key)));
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

/**
 * The flat-set read, BOTH grant sources in ONE statement (lane DX): the Role join `capabilitiesForRoleKeys` performs,
 * UNION ALL the Principal's UNEXPIRED direct grants (`principalCapabilityGrants`' filter). One round trip, so counting
 * direct exceptions costs a request nothing extra; each row says which source it came from.
 */
async function grantedCapabilityKeys(
  pool: Pool,
  tenantId: string,
  roleKeys: readonly string[],
  principalId: string,
): Promise<{ readonly viaRoles: readonly string[]; readonly direct: readonly string[] }> {
  const { rows } = await pool.query<{ key: string; source: "ROLE" | "PRINCIPAL" }>(
    `SELECT DISTINCT c.key AS key, 'ROLE' AS source
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])
     UNION ALL
     SELECT DISTINCT c.key AS key, 'PRINCIPAL' AS source
       FROM ${SCHEMA}.principal_capabilities pc
       JOIN ${SCHEMA}.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND pc.principal_id = $3
        AND ((to_jsonb(pc) ->> 'expires_at') IS NULL OR (to_jsonb(pc) ->> 'expires_at')::timestamptz > now())`,
    [tenantId, [...roleKeys], principalId],
  );
  // Only a row the statement tagged PRINCIPAL is a direct exception; every other row is the Role join's.
  return {
    viaRoles: rows.filter((r) => r.source !== "PRINCIPAL").map((r) => r.key),
    direct: rows.filter((r) => r.source === "PRINCIPAL").map((r) => r.key).sort(),
  };
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
 * Direct grants for one Principal (AB3) -- UNEXPIRED rows only, decided against the database clock.
 *
 * A capability SOURCE of `resolveOperationalCapabilities` since lane DX (Owner: "complete support for direct
 * exceptions"): every runtime gate sees a direct grant through that one resolution, with a Role grant's semantics
 * (conditions narrow it; it has no scope). It stays a separate reader so the Role join above keeps answering the
 * Role question alone, which the baseline and the Role-only equality proofs pin.
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
        AND ((to_jsonb(pc) ->> 'expires_at') IS NULL OR (to_jsonb(pc) ->> 'expires_at')::timestamptz > now())
      ORDER BY c.key`,
    [tenantId, principalId],
  );
  return Object.freeze(rows.map((r) => Object.freeze({ principalId: r.principal_id, capabilityKey: r.capability_key })));
}

/**
 * The relation that holds per-grant conditions. LIVE: migration 1762214400000, applied 2026-09-24.
 * The name is declared once, in grantConditionPolicy.ts, and re-stated here only so the SQL below
 * reads as SQL.
 */
export const GRANT_CONDITION_RELATION = GRANT_CONDITION_RELATION_NAME;

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
 * THE RELATION IS LIVE and holds zero rows, so today this returns an EMPTY list for every tenant --
 * which is not the same fact as the relation being absent, and the difference is load-bearing. A
 * database that does not carry the relation makes this throw `relation does not exist`, which the
 * entitled decision path turns into CONTEXT_AUTHORITY_UNAVAILABLE, never into "then there are no
 * conditions". Reading a missing condition store as "unconditioned" would convert every conditioned
 * grant into an unconditional one, so it fails closed instead.
 *
 * RETIRED rows are not conditions and are not loaded; retiring a condition is how a condition is
 * lifted, and it leaves the row readable as history.
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

// ==================== THE CONDITION RELATION, AS DEPLOYED ====================

/** One column of the live relation, as `information_schema.columns` reports it. */
export interface RelationColumnFact {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly columnDefault: string | null;
}

/** What a database actually carries for `eos_policy.capability_grant_conditions`. */
export interface GrantConditionRelationFacts {
  readonly present: boolean;
  readonly columns: readonly RelationColumnFact[];
  /** `pg_get_constraintdef`, verbatim, sorted. */
  readonly constraints: readonly string[];
  /** Index names, sorted. */
  readonly indexes: readonly string[];
  /** The columns of `capability_grant_conditions_by_capability`, in index order. */
  readonly namedIndexColumns: readonly string[];
}

/**
 * Read the live shape of the condition relation. READ ONLY: three catalog queries and nothing else.
 *
 * This is the half of "the repository understands the deployed schema" that a CREATE TABLE string
 * can never be. `GRANT_CONDITION_RELATION_SHAPE` declares what is expected;
 * `grantConditionRelationDrift` compares the two and names every difference, so drift in EITHER
 * direction -- a column added in the database, a column removed from the declaration -- is a
 * failure rather than a surprise.
 */
export async function describeGrantConditionRelation(
  pool: Pick<Pool, "query">,
  schema: string = GRANT_CONDITION_RELATION_SHAPE.schema,
  table: string = GRANT_CONDITION_RELATION_SHAPE.table,
): Promise<GrantConditionRelationFacts> {
  const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`, [schema, table]);
  if (columns.rows.length === 0) {
    return Object.freeze({ present: false, columns: Object.freeze([]), constraints: Object.freeze([]),
      indexes: Object.freeze([]), namedIndexColumns: Object.freeze([]) });
  }
  const constraints = await pool.query<{ def: string }>(
    `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = $1 AND rel.relname = $2`, [schema, table]);
  const indexes = await pool.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
    [schema, table]);
  const named = indexes.rows.find((r) => r.indexname === GRANT_CONDITION_RELATION_SHAPE.namedIndex.name);
  const namedColumns = named
    ? (named.indexdef.match(/\(([^)]*)\)\s*$/)?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  return Object.freeze({
    present: true,
    columns: Object.freeze(columns.rows.map((r) => Object.freeze({
      name: r.column_name, dataType: r.data_type,
      nullable: r.is_nullable === "YES", columnDefault: r.column_default,
    }))),
    constraints: Object.freeze(constraints.rows.map((r) => r.def).sort()),
    indexes: Object.freeze(indexes.rows.map((r) => r.indexname)),
    namedIndexColumns: Object.freeze(namedColumns),
  });
}

/**
 * Every way the live relation differs from the declared shape. EMPTY means parity.
 *
 * Both directions are reported. A database carrying an undeclared column is drift the repository
 * must learn about; a declaration naming a column the database does not have is drift that would
 * make a reader write to nothing.
 */
export function grantConditionRelationDrift(facts: GrantConditionRelationFacts): readonly string[] {
  if (!facts.present) return Object.freeze([`${GRANT_CONDITION_RELATION} is absent`]);
  const drift: string[] = [];
  const expected = GRANT_CONDITION_RELATION_SHAPE;
  const actualByName = new Map(facts.columns.map((c) => [c.name, c]));
  for (const want of expected.columns) {
    const got = actualByName.get(want.name);
    if (!got) { drift.push(`column ${want.name} is missing`); continue; }
    if (got.dataType !== want.dataType) drift.push(`column ${want.name} is ${got.dataType}, expected ${want.dataType}`);
    if (got.nullable !== want.nullable) drift.push(`column ${want.name} nullability is ${got.nullable}, expected ${want.nullable}`);
    if ((got.columnDefault ?? null) !== want.columnDefault) {
      drift.push(`column ${want.name} default is ${String(got.columnDefault)}, expected ${String(want.columnDefault)}`);
    }
  }
  const declared = new Set(expected.columns.map((c) => c.name));
  for (const got of facts.columns) if (!declared.has(got.name)) drift.push(`column ${got.name} is undeclared`);
  for (const want of expected.constraints) {
    if (!facts.constraints.includes(want)) drift.push(`constraint missing: ${want}`);
  }
  for (const got of facts.constraints) {
    if (!(expected.constraints as readonly string[]).includes(got)) drift.push(`constraint undeclared: ${got}`);
  }
  if (!facts.indexes.includes(expected.namedIndex.name)) drift.push(`index missing: ${expected.namedIndex.name}`);
  else if (facts.namedIndexColumns.join(",") !== expected.namedIndex.columns.join(",")) {
    drift.push(`index ${expected.namedIndex.name} covers (${facts.namedIndexColumns.join(", ")}), expected (${expected.namedIndex.columns.join(", ")})`);
  }
  return Object.freeze(drift);
}

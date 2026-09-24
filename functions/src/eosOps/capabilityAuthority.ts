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
import {
  entitlementsFrom,
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
  /** Capability KEYS held via active Role assignments, in the resolved tenant only. UNCHANGED. */
  readonly capabilities: ReadonlySet<string>;
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
      const [grantRows, catalog] = await Promise.all([
        roleCapabilityGrants(pool, tenantId, heldRoleKeys),
        Promise.resolve(conditions(tenantId)),
      ]);
      const grants: CapabilityGrant[] = grantRows.map((r) => ({
        grantor: { kind: "ROLE", roleKey: r.roleKey }, capabilityKey: r.capabilityKey,
      }));
      return entitlementsFrom(grants, catalog);
    })();
    return pending;
  };
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
  // TWO RESOLVERS, DELIBERATELY. `capabilitiesForRoleKeys` is untouched and stays the authority for
  // "what may this Principal do"; `roleCapabilityGrants` answers "and WHO granted it" over the same
  // rows. They are proved equal by test rather than derived from one another, because a single
  // resolver silently changing shape is how a policy answer drifts without anyone noticing.
  //
  // ONLY THE FIRST IS EAGER. The flat set is what every one of the thirteen gate sites reads, so it
  // is resolved on the request path as it always was. The provenance read and the condition catalog
  // are deferred behind the required resolver below, because eleven of those gate sites never look
  // at them -- and a request that does not ask a question should not pay for its answer.
  const capabilities = await capabilitiesForRoleKeys(
    pool, principalContext.tenantId, principalContext.heldRoleKeys);
  const counters: MutableLookupCounters = { requests: 0, resolutions: 0 };
  const entitlements = requestScopedEntitlementResolver(
    pool, principalContext.tenantId, principalContext.heldRoleKeys, conditions, counters);
  return Object.freeze({ principalContext, capabilities, entitlements, lookups: counters });
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

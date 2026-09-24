// P1A-3 — the operator-run capability GRANT migration tool.
//
// Reconciles the DECLARED role -> capability grant fact -- code, not Firestore data -- into
// `eos_policy.role_capabilities`, for the 8 inventory-authority writers' new capability keys
// migration 006 catalogs and for any other governed key set a caller names.
//
// TWO DECLARATION SOURCES, READ SEPARATELY (see `deriveGovernedRoleGrants`):
//   LEGACY     a Role's own `permissions` array (compatibilityRoles.ts / governedBusinessRoles.ts),
//              which holds Firebase permission ids and carries admin -> owner inheritance.
//   CANONICAL  adminPolicy/canonicalRoleCapabilityCatalog.ts, which declares holders for eos_policy
//              capability keys that have no Firebase permission id, flat and without inheritance.
// A missing declared grant is reconciled. An UNDECLARED live grant is REPORTED (`extraGrants`),
// never revoked.
//
// NONPROD ONLY. DEFAULT = DRY RUN: nothing under `apply: false` (the default) writes anything --
// it only computes and reports what an apply run would do. `apply: true` is the only path that
// writes, and it is idempotent: a capability already granted is reported ALREADY_GRANTED, never
// re-inserted, and a second `apply` run over the same tenant proposes and applies zero additions.
//
// This module receives an already-open `Pool` and does no Firestore read of any kind -- the
// "legacy source" it reconciles from is the in-repo Role catalog, not Firestore, so there is
// nothing here for functions/test/eosOpsNoFirebase.test.mjs's guard to catch and nothing to
// allowlist.
import type { Pool } from "pg";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles";
import {
  assertCanonicalKeysAreNotLegacyPermissionIds,
  assertNoCanonicalKeyInLegacyGrants,
  deriveCanonicalCapabilityGrants,
  isCanonicalCapabilityKey,
} from "../../adminPolicy/canonicalRoleCapabilityCatalog";
import type { Role } from "../../types/access";
import { newCapabilityKeys } from "./inventoryWriterCapabilityCensus";

const SCHEMA = "eos_policy";

export class UnknownCanonicalRoleError extends Error {
  readonly roleKeys: readonly string[];
  constructor(roleKeys: readonly string[]) {
    super(`unknown canonical Role: ${roleKeys.join(", ")}; the Role catalog does not define it`);
    this.roleKeys = roleKeys;
  }
}

export interface LegacyRoleGrant {
  readonly roleKey: string;
  readonly capabilityKey: string;
}

/**
 * Every (Role key, capability key) pair the legacy catalog declares, restricted to the capability
 * keys this migration cares about. Read directly from the SAME Role objects every legacy
 * `authorize(...)` call resolves against (`access/resolveEffectivePermission.ts`'s `roles`
 * argument) -- never re-typed, so there is one source of truth for "which Role holds this" and it
 * cannot drift from what the running system actually grants.
 *
 * `roleKeys`, when supplied, limits the Roles considered -- limiting capability keys alone does not
 * limit which Roles receive them. Omitted = every canonical Role (unchanged behaviour). A requested
 * key the catalog does not define is refused, never silently ignored.
 */
export function deriveLegacyRoleGrants(
  capabilityKeys: readonly string[] = newCapabilityKeys(),
  roleKeys?: readonly string[],
): readonly LegacyRoleGrant[] {
  const keySet = new Set(capabilityKeys);
  const catalog: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  let roles = Object.values(catalog);
  if (roleKeys !== undefined) {
    const unknown = [...new Set(roleKeys)].filter((key) => !Object.prototype.hasOwnProperty.call(catalog, key)).sort();
    if (unknown.length > 0) throw new UnknownCanonicalRoleError(unknown);
    const requested = new Set(roleKeys);
    roles = roles.filter((role) => requested.has(role.id));
  }
  const grants: LegacyRoleGrant[] = [];
  for (const role of roles) {
    for (const permissionId of role.permissions ?? []) {
      if (keySet.has(permissionId)) grants.push({ roleKey: role.id, capabilityKey: permissionId });
    }
  }
  grants.sort((a, b) => (a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey)));
  return Object.freeze(grants);
}

/**
 * THE TWO DECLARATION SOURCES, KEPT APART ON PURPOSE.
 *
 * A capability key is governed by EXACTLY ONE of them:
 *
 *   LEGACY  a Firebase permission id registered in access/permissionCatalog.ts. Its holders are
 *           whichever Roles list it in their own `permissions` array -- which, for `admin`, is the
 *           whole catalog, and therefore also `owner`, which spreads admin
 *           (governedBusinessRoles.ts:83). That inheritance is correct for Firebase permission ids
 *           and is left exactly as it is.
 *
 *   CANONICAL  an eos_policy capability key with no Firebase equivalent. Its holders are declared
 *           explicitly in adminPolicy/canonicalRoleCapabilityCatalog.ts, flat, with NO inheritance:
 *           `owner` holds such a key only where `owner` is written out.
 *
 * FAIL CLOSED ON EVERY WAY THE TWO COULD BLUR:
 *   - a canonical key that is ALSO a registered Firebase permission id -> refused, because the
 *     Role catalog would then declare holders for it too and the two sources would disagree.
 *   - a canonical key found inside ANY Role's legacy `permissions` array -> refused, because that
 *     is precisely how admin's whole-catalog composition would manufacture an `owner` grant the
 *     canonical declaration never made. This is the check that keeps a five-row ruling five rows.
 *
 * A requested key that neither source governs derives nothing. It is not an error -- it is how an
 * undeclared live grant surfaces, as an EXTRA_GRANT row below, rather than being silently blessed.
 */
export function deriveGovernedRoleGrants(
  capabilityKeys: readonly string[] = newCapabilityKeys(),
  roleKeys?: readonly string[],
): readonly LegacyRoleGrant[] {
  assertCanonicalKeysAreNotLegacyPermissionIds();

  const canonicalRequested = capabilityKeys.filter(isCanonicalCapabilityKey);
  assertNoCanonicalKeyInLegacyGrants(deriveLegacyRoleGrants(canonicalRequested, roleKeys));

  const legacy = deriveLegacyRoleGrants(capabilityKeys.filter((k) => !isCanonicalCapabilityKey(k)), roleKeys);
  const canonical = deriveCanonicalCapabilityGrants(canonicalRequested, roleKeys);
  const grants = [...legacy, ...canonical];
  grants.sort((a, b) => (a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey)));
  return Object.freeze(grants);
}

export type ReconcileRowStatus =
  | "PROPOSED"
  | "APPLIED"
  | "ALREADY_GRANTED"
  | "UNRESOLVED_ROLE"
  | "UNKNOWN_CAPABILITY"
  | "EXTRA_GRANT";

export interface ReconcileRow {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly status: ReconcileRowStatus;
}

export interface ReconcileReport {
  readonly tenantId: string;
  readonly apply: boolean;
  readonly generatedAt: string;
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly proposedAdditions: number;
  readonly appliedAdditions: number;
  readonly rows: readonly ReconcileRow[];
  /** UNRESOLVED_ROLE + UNKNOWN_CAPABILITY rows -- an apply run never fails on these, it reports them. */
  readonly unresolved: readonly ReconcileRow[];
  /**
   * EXTRA_GRANT rows: a (Role, capability) pair that EXISTS in eos_policy.role_capabilities, within
   * the capability keys (and Roles) this run asked about, which NEITHER declaration source declares.
   *
   * REPORTED, NEVER REVOKED. An apply run does not delete these and does not fail on them. The tool
   * is additive by design -- deciding that a live grant is wrong is an Owner decision, not a
   * reconcile side effect. Deliberately kept OUT of `rows`, which remains exactly what it was: the
   * per-declaration outcome of this run.
   */
  readonly extraGrants: readonly ReconcileRow[];
}

export interface ReconcileOptions {
  readonly tenantId: string;
  /** DEFAULT = false (dry run). Only `true` writes to PostgreSQL. */
  readonly apply?: boolean;
  /** Recorded as granted_by / created_by / updated_by on any row this run applies. */
  readonly actor: string;
  /**
   * The capability keys to reconcile. DEFAULT = the inventory writer keys (newCapabilityKeys()). The SAME Role-catalog
   * derivation serves any other governed key set -- e.g. eosWorkforce/migration/employeeCapabilityGrants.ts -- so a
   * grant is always "what the Role catalog declares", never a hand-typed Role list.
   */
  readonly capabilityKeys?: readonly string[];
  /**
   * The canonical Role keys to reconcile. DEFAULT = every Role in the catalog. When supplied, ONLY those Roles
   * are considered, so a caller scoped to a set of Roles (e.g. scripts/seedSampleCompany.js) cannot grant to any
   * other. An entry the catalog does not define is refused.
   */
  readonly roleKeys?: readonly string[];
}

class UnknownTenantError extends Error {
  constructor(tenantId: string) {
    super(`unknown tenant: ${tenantId}`);
  }
}

/**
 * READ-ONLY by default. Refuses an unknown tenant outright (never silently no-ops against it).
 * Cross-tenant mappings are structurally impossible, not merely refused: every Role and every
 * role_capabilities row this function reads or writes is filtered `tenant_id = $1`, so a Role
 * belonging to a different tenant is indistinguishable from a Role that does not exist at all.
 */
export async function reconcileInventoryCapabilityGrants(pool: Pool, options: ReconcileOptions): Promise<ReconcileReport> {
  const apply = options.apply === true;
  const tenantId = options.tenantId;

  const tenantRow = await pool.query<{ id: string }>(`SELECT id FROM ${SCHEMA}.tenants WHERE id = $1`, [tenantId]);
  if (tenantRow.rowCount === 0) throw new UnknownTenantError(tenantId);

  const requestedKeys = options.capabilityKeys ?? newCapabilityKeys();
  const legacyGrants = deriveGovernedRoleGrants(requestedKeys, options.roleKeys);

  const capRows = await pool.query<{ id: string; key: string }>(`SELECT id, key FROM ${SCHEMA}.capabilities`);
  const capabilityIdByKey = new Map(capRows.rows.map((r) => [r.key, r.id]));
  const capabilityKeyById = new Map(capRows.rows.map((r) => [r.id, r.key]));

  const roleRows = await pool.query<{ id: string; key: string }>(
    `SELECT id, key FROM ${SCHEMA}.roles WHERE tenant_id = $1`,
    [tenantId],
  );
  const roleIdByKey = new Map(roleRows.rows.map((r) => [r.key, r.id]));
  const roleKeyById = new Map(roleRows.rows.map((r) => [r.id, r.key]));

  const existingRows = await pool.query<{ role_id: string; capability_id: string }>(
    `SELECT role_id, capability_id FROM ${SCHEMA}.role_capabilities WHERE tenant_id = $1`,
    [tenantId],
  );
  const existingPairs = new Set(existingRows.rows.map((r) => `${r.role_id}|${r.capability_id}`));
  const beforeCount = existingPairs.size;

  // EXTRA sweep -- computed from the state BEFORE this run, over exactly the keys (and Roles) asked
  // about, so an apply run's own insertions can never show up as unexplained.
  const declaredPairs = new Set(legacyGrants.map((g) => `${g.roleKey}|${g.capabilityKey}`));
  const inScopeKeys = new Set(requestedKeys);
  const inScopeRoles = options.roleKeys === undefined ? undefined : new Set(options.roleKeys);
  const extraGrants: ReconcileRow[] = [];
  for (const row of existingRows.rows) {
    const capabilityKey = capabilityKeyById.get(row.capability_id);
    const roleKey = roleKeyById.get(row.role_id);
    if (capabilityKey === undefined || roleKey === undefined) continue;
    if (!inScopeKeys.has(capabilityKey)) continue;
    if (inScopeRoles !== undefined && !inScopeRoles.has(roleKey)) continue;
    if (declaredPairs.has(`${roleKey}|${capabilityKey}`)) continue;
    extraGrants.push({ roleKey, capabilityKey, status: "EXTRA_GRANT" });
  }
  extraGrants.sort((a, b) => (a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey)));

  const rows: ReconcileRow[] = [];
  let proposedAdditions = 0;
  let appliedAdditions = 0;

  for (const grant of legacyGrants) {
    const capabilityId = capabilityIdByKey.get(grant.capabilityKey);
    if (!capabilityId) {
      rows.push({ roleKey: grant.roleKey, capabilityKey: grant.capabilityKey, status: "UNKNOWN_CAPABILITY" });
      continue;
    }
    const roleId = roleIdByKey.get(grant.roleKey);
    if (!roleId) {
      rows.push({ roleKey: grant.roleKey, capabilityKey: grant.capabilityKey, status: "UNRESOLVED_ROLE" });
      continue;
    }
    if (existingPairs.has(`${roleId}|${capabilityId}`)) {
      rows.push({ roleKey: grant.roleKey, capabilityKey: grant.capabilityKey, status: "ALREADY_GRANTED" });
      continue;
    }

    proposedAdditions += 1;
    if (!apply) {
      rows.push({ roleKey: grant.roleKey, capabilityKey: grant.capabilityKey, status: "PROPOSED" });
      continue;
    }

    const id = `rolecap_${roleId}_${capabilityId}`;
    await pool.query(
      `INSERT INTO ${SCHEMA}.role_capabilities
         (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5, $5)
       ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
      [id, tenantId, roleId, capabilityId, options.actor],
    );
    appliedAdditions += 1;
    existingPairs.add(`${roleId}|${capabilityId}`);
    rows.push({ roleKey: grant.roleKey, capabilityKey: grant.capabilityKey, status: "APPLIED" });
  }

  const afterCountRow = await pool.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM ${SCHEMA}.role_capabilities WHERE tenant_id = $1`,
    [tenantId],
  );

  return Object.freeze({
    tenantId,
    apply,
    generatedAt: new Date().toISOString(),
    beforeCount,
    afterCount: apply ? Number(afterCountRow.rows[0]?.n ?? beforeCount) : beforeCount,
    proposedAdditions,
    appliedAdditions,
    rows: Object.freeze(rows),
    unresolved: Object.freeze(rows.filter((r) => r.status === "UNRESOLVED_ROLE" || r.status === "UNKNOWN_CAPABILITY")),
    extraGrants: Object.freeze(extraGrants),
  });
}

/** A short human summary, for an operator running this by hand. */
export function describeReconcileReport(report: ReconcileReport): string {
  return [
    `tenant ${report.tenantId} @ ${report.generatedAt} -- ${report.apply ? "APPLY" : "DRY RUN"}`,
    `  before                  ${report.beforeCount}`,
    `  after                   ${report.afterCount}`,
    `  proposed additions      ${report.proposedAdditions}`,
    `  applied additions       ${report.appliedAdditions}`,
    `  unresolved mismatches   ${report.unresolved.length}`,
    ...report.unresolved.map((r) => `    - ${r.status}: role=${r.roleKey} capability=${r.capabilityKey}`),
    `  extra grants (reported) ${report.extraGrants.length}`,
    ...report.extraGrants.map((r) => `    - ${r.status}: role=${r.roleKey} capability=${r.capabilityKey} -- live, declared by no source; never revoked here`),
  ].join("\n");
}

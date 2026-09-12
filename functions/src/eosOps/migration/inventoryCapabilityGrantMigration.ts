// P1A-3 — the operator-run capability GRANT migration tool.
//
// Reconciles the LEGACY role -> capability grant fact (a Role's own declared `permissions` array,
// in compatibilityRoles.ts / governedBusinessRoles.ts -- code, not Firestore data) into
// `eos_policy.role_capabilities`, for the 8 inventory-authority writers' new capability keys
// migration 006 catalogs.
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
import type { Role } from "../../types/access";
import { newCapabilityKeys } from "./inventoryWriterCapabilityCensus";

const SCHEMA = "eos_policy";

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
 */
export function deriveLegacyRoleGrants(capabilityKeys: readonly string[] = newCapabilityKeys()): readonly LegacyRoleGrant[] {
  const keySet = new Set(capabilityKeys);
  const catalog: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const grants: LegacyRoleGrant[] = [];
  for (const role of Object.values(catalog)) {
    for (const permissionId of role.permissions ?? []) {
      if (keySet.has(permissionId)) grants.push({ roleKey: role.id, capabilityKey: permissionId });
    }
  }
  grants.sort((a, b) => (a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey)));
  return Object.freeze(grants);
}

export type ReconcileRowStatus = "PROPOSED" | "APPLIED" | "ALREADY_GRANTED" | "UNRESOLVED_ROLE" | "UNKNOWN_CAPABILITY";

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
}

export interface ReconcileOptions {
  readonly tenantId: string;
  /** DEFAULT = false (dry run). Only `true` writes to PostgreSQL. */
  readonly apply?: boolean;
  /** Recorded as granted_by / created_by / updated_by on any row this run applies. */
  readonly actor: string;
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

  const legacyGrants = deriveLegacyRoleGrants();

  const capRows = await pool.query<{ id: string; key: string }>(`SELECT id, key FROM ${SCHEMA}.capabilities`);
  const capabilityIdByKey = new Map(capRows.rows.map((r) => [r.key, r.id]));

  const roleRows = await pool.query<{ id: string; key: string }>(
    `SELECT id, key FROM ${SCHEMA}.roles WHERE tenant_id = $1`,
    [tenantId],
  );
  const roleIdByKey = new Map(roleRows.rows.map((r) => [r.key, r.id]));

  const existingRows = await pool.query<{ role_id: string; capability_id: string }>(
    `SELECT role_id, capability_id FROM ${SCHEMA}.role_capabilities WHERE tenant_id = $1`,
    [tenantId],
  );
  const existingPairs = new Set(existingRows.rows.map((r) => `${r.role_id}|${r.capability_id}`));
  const beforeCount = existingPairs.size;

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
  ].join("\n");
}

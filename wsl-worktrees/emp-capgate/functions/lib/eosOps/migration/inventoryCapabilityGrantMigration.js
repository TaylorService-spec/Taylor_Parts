"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnknownCanonicalRoleError = void 0;
exports.deriveLegacyRoleGrants = deriveLegacyRoleGrants;
exports.reconcileInventoryCapabilityGrants = reconcileInventoryCapabilityGrants;
exports.describeReconcileReport = describeReconcileReport;
const compatibilityRoles_1 = require("../../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../../access/governedBusinessRoles");
const inventoryWriterCapabilityCensus_1 = require("./inventoryWriterCapabilityCensus");
const SCHEMA = "eos_policy";
class UnknownCanonicalRoleError extends Error {
    roleKeys;
    constructor(roleKeys) {
        super(`unknown canonical Role: ${roleKeys.join(", ")}; the Role catalog does not define it`);
        this.roleKeys = roleKeys;
    }
}
exports.UnknownCanonicalRoleError = UnknownCanonicalRoleError;
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
function deriveLegacyRoleGrants(capabilityKeys = (0, inventoryWriterCapabilityCensus_1.newCapabilityKeys)(), roleKeys) {
    const keySet = new Set(capabilityKeys);
    const catalog = { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
    let roles = Object.values(catalog);
    if (roleKeys !== undefined) {
        const unknown = [...new Set(roleKeys)].filter((key) => !Object.prototype.hasOwnProperty.call(catalog, key)).sort();
        if (unknown.length > 0)
            throw new UnknownCanonicalRoleError(unknown);
        const requested = new Set(roleKeys);
        roles = roles.filter((role) => requested.has(role.id));
    }
    const grants = [];
    for (const role of roles) {
        for (const permissionId of role.permissions ?? []) {
            if (keySet.has(permissionId))
                grants.push({ roleKey: role.id, capabilityKey: permissionId });
        }
    }
    grants.sort((a, b) => (a.roleKey === b.roleKey ? a.capabilityKey.localeCompare(b.capabilityKey) : a.roleKey.localeCompare(b.roleKey)));
    return Object.freeze(grants);
}
class UnknownTenantError extends Error {
    constructor(tenantId) {
        super(`unknown tenant: ${tenantId}`);
    }
}
/**
 * READ-ONLY by default. Refuses an unknown tenant outright (never silently no-ops against it).
 * Cross-tenant mappings are structurally impossible, not merely refused: every Role and every
 * role_capabilities row this function reads or writes is filtered `tenant_id = $1`, so a Role
 * belonging to a different tenant is indistinguishable from a Role that does not exist at all.
 */
async function reconcileInventoryCapabilityGrants(pool, options) {
    const apply = options.apply === true;
    const tenantId = options.tenantId;
    const tenantRow = await pool.query(`SELECT id FROM ${SCHEMA}.tenants WHERE id = $1`, [tenantId]);
    if (tenantRow.rowCount === 0)
        throw new UnknownTenantError(tenantId);
    const legacyGrants = deriveLegacyRoleGrants(options.capabilityKeys ?? (0, inventoryWriterCapabilityCensus_1.newCapabilityKeys)(), options.roleKeys);
    const capRows = await pool.query(`SELECT id, key FROM ${SCHEMA}.capabilities`);
    const capabilityIdByKey = new Map(capRows.rows.map((r) => [r.key, r.id]));
    const roleRows = await pool.query(`SELECT id, key FROM ${SCHEMA}.roles WHERE tenant_id = $1`, [tenantId]);
    const roleIdByKey = new Map(roleRows.rows.map((r) => [r.key, r.id]));
    const existingRows = await pool.query(`SELECT role_id, capability_id FROM ${SCHEMA}.role_capabilities WHERE tenant_id = $1`, [tenantId]);
    const existingPairs = new Set(existingRows.rows.map((r) => `${r.role_id}|${r.capability_id}`));
    const beforeCount = existingPairs.size;
    const rows = [];
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
        await pool.query(`INSERT INTO ${SCHEMA}.role_capabilities
         (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5, $5)
       ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [id, tenantId, roleId, capabilityId, options.actor]);
        appliedAdditions += 1;
        existingPairs.add(`${roleId}|${capabilityId}`);
        rows.push({ roleKey: grant.roleKey, capabilityKey: grant.capabilityKey, status: "APPLIED" });
    }
    const afterCountRow = await pool.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.role_capabilities WHERE tenant_id = $1`, [tenantId]);
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
function describeReconcileReport(report) {
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
//# sourceMappingURL=inventoryCapabilityGrantMigration.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOperationalContext = resolveOperationalContext;
exports.capabilitiesForRoleKeys = capabilitiesForRoleKeys;
exports.operationalCapabilityPool = operationalCapabilityPool;
exports.listCapabilityKeys = listCapabilityKeys;
const policyDatabase_1 = require("../adminPolicy/policyDatabase");
const principalContext_1 = require("../adminPolicy/principalContext");
const SCHEMA = "eos_policy";
/**
 * Resolve an authenticated subject to its tenant, Roles and operational capabilities.
 *
 * Refuses (via `resolvePrincipalContext`'s own errors) exactly as the Administration API does --
 * no reduced-access fallback, ever. A principal holding zero qualifying Roles resolves successfully
 * with an EMPTY capability set, which is what "authenticated but not authorized for anything
 * operational" looks like; it is the caller's job to then refuse the specific operation, not this
 * function's job to throw for it.
 */
async function resolveOperationalContext(reader, pool, input) {
    const principalContext = await (0, principalContext_1.resolvePrincipalContext)(reader, input);
    const capabilities = await capabilitiesForRoleKeys(pool, principalContext.tenantId, principalContext.heldRoleKeys);
    return Object.freeze({ principalContext, capabilities });
}
/**
 * The role_capabilities join, resolved by Role KEY (what `resolvePrincipalContext` already computed)
 * rather than by Role id -- so this file needs no second identity lookup and cannot disagree with
 * the Administration API about which Roles are held.
 */
async function capabilitiesForRoleKeys(pool, tenantId, roleKeys) {
    if (roleKeys.length === 0)
        return new Set();
    const { rows } = await pool.query(`SELECT DISTINCT c.key AS key
       FROM ${SCHEMA}.role_capabilities rc
       JOIN ${SCHEMA}.capabilities c ON c.id = rc.capability_id
       JOIN ${SCHEMA}.roles r        ON r.id = rc.role_id
      WHERE rc.tenant_id = $1
        AND r.tenant_id  = $1
        AND r.key = ANY($2::text[])`, [tenantId, roleKeys]);
    return new Set(rows.map((r) => r.key));
}
/** Convenience for a command that needs the pool this module already knows how to build. */
function operationalCapabilityPool() {
    return (0, policyDatabase_1.getPolicyDatabasePool)();
}
/**
 * Every capability key the catalog currently declares. Exists so callers outside this module --
 * the P1A inventory-authority capability parity harness (adminPolicy/migration/
 * inventoryCapabilityParityHarness.ts) in particular -- never need their own SQL or their own
 * `pg` import to answer "is this capability key known" -- exactly the same "no SQL beyond this
 * file" rule the module header already states for `role_capabilities`.
 */
async function listCapabilityKeys(pool) {
    const { rows } = await pool.query(`SELECT key FROM ${SCHEMA}.capabilities`);
    return new Set(rows.map((r) => r.key));
}
//# sourceMappingURL=capabilityAuthority.js.map
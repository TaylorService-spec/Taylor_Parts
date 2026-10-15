"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.capabilityKeysFor = capabilityKeysFor;
exports.actorCapabilities = actorCapabilities;
exports.requireSecurityAdministrationCapability = requireSecurityAdministrationCapability;
// The capability gate for security-administration mutations, and the anti-lockout guard.
//
// WHERE THE CAPABILITIES COME FROM. The actor's EFFECTIVE capability set, resolved from PostgreSQL
// through the governed store and nothing else:
//
//   actor.capabilities            when the trusted API already resolved it for this request, or
//   actor.heldRoleKeys            the QUALIFYING Role keys resolvePrincipalContext computed (never a
//     -> role_capabilities        request field) -> the Role grants in this tenant
//   + principal_capabilities      direct grants to the actor Principal
//
// There is no branch in which a Role NAME authorizes anything: a Role key is only a way to find the
// grants that Role holds. A tenant whose `admin` Role holds no admin.* grant cannot administer
// security through it -- which is why tenantBootstrap.ts grants the governing capabilities with the
// first administrator.
const administrationAuthority_1 = require("./administrationAuthority");
/** Capability keys granted, in this tenant, to these Roles (by key) and to this Principal directly. */
async function capabilityKeysFor(repo, tenantId, roleKeys, principalId, options = {}) {
    const roles = await repo.listRoles(tenantId);
    const wanted = new Set(roleKeys);
    const roleIds = roles.filter((r) => wanted.has(r.key)).map((r) => r.id);
    // NEVER call listRoleCapabilities with an empty list: the port reads that as EVERY Role.
    const [catalog, roleGrants, direct, conditions] = await Promise.all([
        repo.listCapabilities(),
        roleIds.length > 0 ? repo.listRoleCapabilities(tenantId, roleIds) : Promise.resolve([]),
        principalId ? repo.listPrincipalCapabilities(tenantId, principalId) : Promise.resolve([]),
        repo.listGrantConditions(tenantId),
    ]);
    const keyById = new Map(catalog.map((c) => [c.id, c.key]));
    const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
    // FAIL CLOSED: a Role grant narrowed by an ACTIVE condition is NOT in a flat capability set -- this
    // gate cannot evaluate a condition, so a conditioned grant must not act as an unconditional one.
    const active = options.includeConditioned === true ? [] : conditions.filter((c) => c.status === undefined || c.status === "ACTIVE");
    const conditioned = new Set(active.filter((c) => c.grantScope === "ROLE").map((c) => `${c.grantorKey}|${c.capabilityKey}`));
    const conditionedDirect = new Set(active.filter((c) => c.grantScope === "PRINCIPAL").map((c) => `${c.grantorKey}|${c.capabilityKey}`));
    const keys = new Set();
    for (const g of roleGrants) {
        const key = keyById.get(g.capabilityId);
        if (key && !conditioned.has(`${roleKeyById.get(g.roleId)}|${key}`))
            keys.add(key);
    }
    for (const g of direct) {
        const key = keyById.get(g.capabilityId);
        if (key && !conditionedDirect.has(`${g.principalId}|${key}`))
            keys.add(key);
    }
    return keys;
}
/** The actor's effective capability set, resolved as the header describes. */
async function actorCapabilities(repo, actor) {
    if (actor.capabilities instanceof Set)
        return actor.capabilities;
    const roleKeys = Array.isArray(actor.heldRoleKeys) ? actor.heldRoleKeys : [];
    return capabilityKeysFor(repo, actor.tenantId, roleKeys, actor.uid);
}
/** Refuse unless the actor holds the capability this security-administration action requires. */
async function requireSecurityAdministrationCapability(repo, actor, action) {
    const held = await actorCapabilities(repo, actor);
    if (!(0, administrationAuthority_1.hasSecurityAdministrationCapability)(held, action))
        throw new administrationAuthority_1.AdministrationCapabilityDeniedError(action);
}
//# sourceMappingURL=administrationCapabilityGate.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleCatalogReconcileError = exports.ROLE_CATALOG_RECONCILE_ACTION = void 0;
exports.reconcileTenantRoleCatalog = reconcileTenantRoleCatalog;
// ROLE-KEY COMPLETENESS for an EXISTING tenant -- an additive, audited, idempotent reconcile of the declared Role
// catalog into ONE named tenant's eos_policy.roles.
//
// ════════════════════ WHY IT EXISTS ════════════════════
//
// The policy seed (policySeed.ts) runs when a tenant is bootstrapped. Catalog Role keys added to
// COMPATIBILITY_ROLES / GOVERNED_BUSINESS_ROLES AFTER that run never reach the tenant, so a Security Role
// assignment naming one of them has no `roles.key` to point at (the census reports these as
// catalogRoleKeysMissingInTenant). Re-running the whole seed is not the answer: it would also create missing
// Objects, Fields and Workflows, which is a much wider act than "the tenant lacks a Role key".
//
// ════════════════════ WHAT IT DOES, EXACTLY AS THE SEED DOES ════════════════════
//
// For each catalog key the tenant lacks, it writes what seedTenantPolicy writes for a Role IT creates, and nothing
// else, using the seed's own exported helpers so the two cannot drift:
//
//   the Role row          seedRoleInput(key, definition) -- same name, description, SYSTEM origin, protected flag
//   its baseline CRED     deriveObjectCred over seedObjects(), stored only when hasAnyGrant (the seed's rule for
//                         Roles it creates: "ONLY FOR ROLES AND OBJECTS THIS RUN CREATED")
//
// The seed creates no Field overrides for a Role, so neither does this. The seed binds Roles to workflow actions
// only while CREATING a workflow; an existing tenant's workflows are left alone and the unbound pairs are REPORTED.
//
// ════════════════════ WHAT IT NEVER DOES ════════════════════
//
//   never alters or deletes an existing Role, and never re-derives an existing Role's permissions
//   never grants a capability (role_capabilities) and never creates an assignment, membership or Principal
//   never creates a tenant, an Object or a Field: if a seed Object a planned grant needs is absent, the run is
//     REFUSED_SEED_OBJECTS_MISSING and writes nothing
//   DRY RUN BY DEFAULT; `apply` writes in ONE transaction with ONE audit event. A run with nothing to add opens no
//     transaction and writes no audit event (a change that changes nothing is not a mutation).
const workflowSeeds_1 = require("../workflowSeeds");
const policySeed_1 = require("./policySeed");
exports.ROLE_CATALOG_RECONCILE_ACTION = "reconcileTenantRoleCatalog";
class RoleCatalogReconcileError extends Error {
}
exports.RoleCatalogReconcileError = RoleCatalogReconcileError;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
async function reconcileTenantRoleCatalog(repo, tenantKey, options) {
    if (typeof tenantKey !== "string" || tenantKey.length === 0)
        throw new RoleCatalogReconcileError("a tenant key is required");
    if (typeof options?.actorUid !== "string" || options.actorUid.length === 0)
        throw new RoleCatalogReconcileError("an actor is required");
    const tenant = await repo.getTenantByKey(tenantKey);
    if (!tenant)
        throw new RoleCatalogReconcileError(`no tenant with key ${tenantKey}; the reconcile never creates one`);
    (0, policySeed_1.assertSupportedSeedSnapshot)();
    const definitions = options.roleDefinitions ?? (0, policySeed_1.seedRoleDefinitions)();
    const catalogKeys = Object.keys(definitions).sort(byText);
    const existingRoles = await repo.listRoles(tenant.id);
    const existingKeys = new Set(existingRoles.map((r) => r.key));
    const missingRoleKeys = catalogKeys.filter((k) => !existingKeys.has(k));
    const extraTenantRoleKeys = [...existingKeys].filter((k) => !Object.prototype.hasOwnProperty.call(definitions, k)).sort(byText);
    const objects = (0, policySeed_1.seedObjects)();
    const objectIdByKey = new Map((await repo.listObjects(tenant.id)).map((o) => [o.key, o.id]));
    const plannedRoles = missingRoleKeys.map((key) => {
        const definition = definitions[key];
        const held = new Set(definition.permissions ?? []);
        const objectPermissions = [];
        for (const object of objects) {
            const cred = (0, policySeed_1.deriveObjectCred)(held, object.capabilitiesByVerb, object.supportsDelete);
            if (!(0, policySeed_1.hasAnyGrant)(cred))
                continue;
            objectPermissions.push({ objectKey: object.key, cred });
        }
        return { input: (0, policySeed_1.seedRoleInput)(key, definition), objectPermissions };
    });
    const missingSeedObjectKeys = [...new Set(plannedRoles.flatMap((r) => r.objectPermissions.map((p) => p.objectKey)))]
        .filter((k) => !objectIdByKey.has(k))
        .sort(byText);
    const missing = new Set(missingRoleKeys);
    const workflowRoleBindingsNotCreated = workflowSeeds_1.SEED_WORKFLOWS.flatMap((w) => w.actions.flatMap((a) => a.roleKeys.filter((k) => missing.has(k)).map((roleKey) => ({ workflowKey: w.key, actionKey: a.key, roleKey })))).sort((x, y) => byText(`${x.workflowKey}|${x.actionKey}|${x.roleKey}`, `${y.workflowKey}|${y.actionKey}|${y.roleKey}`));
    const plannedObjectPermissions = plannedRoles.reduce((n, r) => n + r.objectPermissions.length, 0);
    const apply = options.apply === true;
    const refused = missingSeedObjectKeys.length > 0;
    const base = {
        tenant: { key: tenant.key, id: tenant.id },
        seedVersion: policySeed_1.SEED_VERSION,
        mode: apply ? "apply" : "dry-run",
        catalogRoleKeys: catalogKeys.length,
        tenantRoleKeysBefore: existingKeys.size,
        missingRoleKeys,
        extraTenantRoleKeys,
        plannedRoles: plannedRoles.map((r) => ({ key: r.input.key, name: r.input.name, protected: r.input.protected, objectPermissions: r.objectPermissions.length })),
        plannedObjectPermissions,
        missingSeedObjectKeys,
        workflowRoleBindingsNotCreated,
    };
    if (refused)
        return { ...base, outcome: "REFUSED_SEED_OBJECTS_MISSING", created: { roles: 0, objectPermissions: 0 } };
    if (missingRoleKeys.length === 0)
        return { ...base, outcome: "NOTHING_TO_RECONCILE", created: { roles: 0, objectPermissions: 0 } };
    if (!apply)
        return { ...base, outcome: "DRY_RUN", created: { roles: 0, objectPermissions: 0 } };
    const created = await repo.transact({ tenantId: tenant.id, uid: options.actorUid }, async (tx) => {
        let roles = 0;
        let objectPermissions = 0;
        for (const planned of plannedRoles) {
            const role = await tx.createRole(planned.input);
            roles += 1;
            for (const permission of planned.objectPermissions) {
                await tx.setObjectPermission(role.id, objectIdByKey.get(permission.objectKey), permission.cred);
                objectPermissions += 1;
            }
        }
        await tx.appendAudit({
            action: exports.ROLE_CATALOG_RECONCILE_ACTION,
            actorUid: options.actorUid,
            targetKind: "tenant",
            targetId: tenant.id,
            occurredAt: new Date().toISOString(),
            reason: `role catalog completeness, seed v${policySeed_1.SEED_VERSION}`,
            before: { tenantRoleKeys: existingKeys.size },
            after: { seedVersion: policySeed_1.SEED_VERSION, createdRoleKeys: missingRoleKeys, objectPermissions, workflowRoleBindingsNotCreated: workflowRoleBindingsNotCreated.length },
        });
        return { roles, objectPermissions };
    });
    return { ...base, outcome: "APPLIED", created };
}
//# sourceMappingURL=roleCatalogReconcile.js.map
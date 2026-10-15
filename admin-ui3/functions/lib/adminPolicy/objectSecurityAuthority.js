"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectSecurityError = void 0;
exports.resolveObjectAction = resolveObjectAction;
exports.actionsForObject = actionsForObject;
exports.effectiveCapabilities = effectiveCapabilities;
exports.objectActionsForPrincipal = objectActionsForPrincipal;
exports.objectSecurityMatrix = objectSecurityMatrix;
exports.roleSecurityView = roleSecurityView;
class ObjectSecurityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ObjectSecurityError";
    }
}
exports.ObjectSecurityError = ObjectSecurityError;
const refuse = (code, message) => {
    throw new ObjectSecurityError(code, message);
};
/**
 * Resolve (objectKey, actionKey) to the ONE capability that governs it.
 *
 * This is the whole reason Administration's write contract is an Object and an action rather than a
 * raw capability key: an administrator grants "Work Order -> Dispatch", and the server decides that
 * this means `workOrder.lifecycle.dispatch`. Exposing the key as the primary contract would let a
 * caller name a capability that governs something else entirely, and would make the key -- an
 * implementation identifier -- part of the administrative interface.
 *
 * Refuses an unknown Object and an unknown action SEPARATELY, because "Work Order has no Frobnicate"
 * and "there is no such Object" are different mistakes and an administrator can act on the first.
 */
function resolveObjectAction(capabilities, objectKey, actionKey) {
    const key = typeof objectKey === "string" ? objectKey.trim() : "";
    const action = typeof actionKey === "string" ? actionKey.trim() : "";
    if (!key)
        refuse("OBJECT_KEY_REQUIRED", "an objectKey is required");
    if (!action)
        refuse("ACTION_KEY_REQUIRED", "an actionKey is required");
    const onObject = capabilities.filter((c) => c.objectKey === key);
    if (onObject.length === 0) {
        refuse("UNKNOWN_OBJECT", `no governed Object "${key}" declares any action`);
    }
    const match = onObject.filter((c) => c.actionKey === action);
    if (match.length === 0) {
        refuse("UNKNOWN_ACTION", `Object "${key}" has no governed action "${action}"`);
    }
    // The database holds a UNIQUE index on (object_key, action_key). If two rows ever arrive here the
    // index is gone, and picking one would silently grant an action nobody asked for.
    if (match.length > 1) {
        refuse("AMBIGUOUS_ACTION", `Object "${key}" declares "${action}" more than once`);
    }
    return match[0];
}
/** Every action one Object governs, in a stable order: CRUD first, then business, then admin. */
const KIND_ORDER = {
    CREATE: 0, READ: 1, EDIT: 2, DELETE: 3, BUSINESS_ACTION: 4, ADMIN_ACTION: 5,
};
function actionsForObject(capabilities, objectKey) {
    return [...capabilities.filter((c) => c.objectKey === objectKey)].sort((a, b) => (KIND_ORDER[a.actionKind] ?? 9) - (KIND_ORDER[b.actionKind] ?? 9)
        || a.actionKey.localeCompare(b.actionKey));
}
/**
 * The union of role-derived and direct capabilities, de-duplicated, with provenance kept.
 *
 * A PLAIN UNION, because this platform has no object-level deny to be consistent with: the CRED
 * resolver's ALL_DENY is a fail-closed default, not a stored denial, and object CRED already unions
 * additively across a principal's Roles. Inventing precedence would give direct grants semantics
 * nothing else in the schema has.
 *
 * Provenance is kept rather than collapsed because revoking a Role and revoking a direct grant are
 * different acts, and an administrator looking at "why does this person have Dispatch" needs to be
 * told which one to remove -- or that removing either still leaves the other.
 */
function effectiveCapabilities(input) {
    const byId = new Map(input.capabilities.map((c) => [c.id, c]));
    const fromRole = new Set(input.roleDerivedCapabilityIds);
    const direct = new Set(input.directCapabilityIds);
    const out = [];
    for (const id of new Set([...fromRole, ...direct])) {
        const cap = byId.get(id);
        // A grant naming a capability the catalog does not define is dropped, never guessed at. The
        // foreign key makes this unreachable through the database; it is reachable through a stale
        // in-memory catalog, and inventing a key here would be worse than showing nothing.
        if (!cap)
            continue;
        out.push(Object.freeze({
            capabilityKey: cap.key,
            objectKey: cap.objectKey,
            actionKey: cap.actionKey,
            actionKind: cap.actionKind,
            displayLabel: cap.displayLabel,
            source: fromRole.has(id) && direct.has(id) ? "ROLE_AND_DIRECT" : direct.has(id) ? "DIRECT" : "ROLE",
        }));
    }
    out.sort((a, b) => a.objectKey.localeCompare(b.objectKey) || a.actionKey.localeCompare(b.actionKey));
    return Object.freeze(out);
}
/** Principal -> Object -> the actions they may perform. The Administration Users page's answer. */
function objectActionsForPrincipal(effective) {
    const byObject = new Map();
    for (const c of effective) {
        if (!byObject.has(c.objectKey))
            byObject.set(c.objectKey, []);
        byObject.get(c.objectKey).push(c.actionKey);
    }
    return Object.freeze(Object.fromEntries([...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Object.freeze(v.sort())])));
}
/**
 * OBJECT VIEW. One Object, every action it governs, and who holds each -- Roles AND Principals.
 *
 * An action with no grantee renders as an empty row rather than being omitted: "nobody holds
 * Dispatch" and "Dispatch does not exist" are different facts, and the first is the one an
 * administrator has to be able to see in order to fix it. The three Work Order lifecycle actions
 * are exactly this case today.
 */
function objectSecurityMatrix(capabilities, objectKey, roleGrants, principalGrants) {
    return actionsForObject(capabilities, objectKey).map((cap) => Object.freeze({
        actionKey: cap.actionKey,
        capabilityKey: cap.key,
        actionKind: cap.actionKind,
        displayLabel: cap.displayLabel,
        roleKeys: Object.freeze(roleGrants.filter((g) => g.capabilityId === cap.id).map((g) => g.roleKey).sort()),
        principalIds: Object.freeze(principalGrants.filter((g) => g.capabilityId === cap.id).map((g) => g.principalId).sort()),
    }));
}
/** ROLE VIEW. The same rows, grouped the other way: one Role -> Objects -> actions. */
function roleSecurityView(capabilities, grantedCapabilityIds) {
    const byId = new Map(capabilities.map((c) => [c.id, c]));
    const byObject = new Map();
    for (const id of new Set(grantedCapabilityIds)) {
        const cap = byId.get(id);
        if (!cap)
            continue;
        if (!byObject.has(cap.objectKey))
            byObject.set(cap.objectKey, []);
        byObject.get(cap.objectKey).push(cap.actionKey);
    }
    return Object.freeze(Object.fromEntries([...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Object.freeze(v.sort())])));
}
//# sourceMappingURL=objectSecurityAuthority.js.map
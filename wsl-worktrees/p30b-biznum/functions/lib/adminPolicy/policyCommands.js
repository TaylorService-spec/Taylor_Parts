"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdministrationDeniedError = exports.PolicyValidationError = void 0;
exports.createCustomField = createCustomField;
exports.updateFieldDefinition = updateFieldDefinition;
exports.updateObjectMetadata = updateObjectMetadata;
exports.createRole = createRole;
exports.setObjectPermission = setObjectPermission;
exports.setFieldPermissionOverride = setFieldPermissionOverride;
exports.assignRole = assignRole;
exports.revokeRole = revokeRole;
exports.publishWorkflowVersion = publishWorkflowVersion;
// The Admin policy mutation services.
//
// ════════════════════ WHAT EVERY COMMAND IN THIS FILE DOES ════════════════════
//
//   1. AUTHORIZE   against the administration authority, server-side, before anything is read
//   2. VALIDATE    the change itself -- shape, references, and the invariants it could break
//   3. TRANSACT    atomically, so a policy change and its consequences land together or not at all
//   4. VERSION     bump the access version of every principal whose authority could have moved
//   5. AUDIT       append one event; not optional, not configurable
//   6. RETURN      the canonical stored result, never the caller's input echoed back
//
// The UI is not the security boundary and never was. These commands are.
//
// ════════════════════ TENANCY ════════════════════
//
// Every command takes an `AdminActor` whose `tenantId` was derived server-side from the
// authenticated principal. No command accepts a tenant in its input, so a caller cannot name one --
// cross-tenant mutation is not expressible rather than merely refused.
const administrationAuthority_1 = require("./administrationAuthority");
Object.defineProperty(exports, "AdministrationDeniedError", { enumerable: true, get: function () { return administrationAuthority_1.AdministrationDeniedError; } });
const types_1 = require("./types");
const workflowEngine_1 = require("./workflowEngine");
class PolicyValidationError extends Error {
}
exports.PolicyValidationError = PolicyValidationError;
const nonEmpty = (v, what) => {
    if (typeof v !== "string" || v.trim().length === 0)
        throw new PolicyValidationError(`${what} is required`);
    return v.trim();
};
/** A machine key: stable, storage-facing, and deliberately narrow so it can never need escaping. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,62}$/;
const validKey = (v, what) => {
    const s = nonEmpty(v, what);
    if (!KEY_PATTERN.test(s)) {
        throw new PolicyValidationError(`${what} must start with a lower-case letter and contain only letters, digits or underscore`);
    }
    return s;
};
function validCredSet(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new PolicyValidationError("a complete CRED set is required");
    }
    const v = value;
    const out = { C: false, R: false, E: false, D: false };
    for (const verb of types_1.CRED_VERBS) {
        if (typeof v[verb] !== "boolean")
            throw new PolicyValidationError(`CRED verb "${verb}" must be true or false`);
        out[verb] = v[verb];
    }
    for (const k of Object.keys(v)) {
        if (!types_1.CRED_VERBS.includes(k))
            throw new PolicyValidationError(`"${k}" is not a CRED verb`);
    }
    return Object.freeze(out);
}
function validCredOverride(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new PolicyValidationError("an override must be an object");
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (!types_1.CRED_VERBS.includes(k))
            throw new PolicyValidationError(`"${k}" is not a CRED verb`);
        if (typeof v !== "boolean")
            throw new PolicyValidationError(`override for "${k}" must be true or false`);
        out[k] = v;
    }
    return Object.freeze(out);
}
// ════════════════════ A CHANGE THAT CHANGES NOTHING IS NOT A MUTATION ════════════════════
//
// Every command below used to open a transaction, write, bump access versions and append an audit
// event whether or not anything had changed. Measured against the deployed non-production API: an
// identical `updateRole`, `updateObjectMetadata`, `updateCustomFieldMetadata`, `setObjectPermission`
// and `setFieldPermissionOverride` EACH wrote an audit event whose only difference was `updatedAt`.
// The two permission commands also bumped the access version of every holder of the Role, forcing
// each of them to re-resolve authority that had not moved.
//
// An audit trail that records edits nobody made cannot be trusted about the ones they did, and the
// rule was already decided: Ruling C made an identical role assignment idempotent, and acceptance
// requires that an identical no-op write no mutation event. `assignRole` was the only command that
// honoured it. Now they all do -- by returning the current record BEFORE any transaction opens, so
// there is nothing to roll back and nothing to audit.
/** Do two CRED shapes -- complete sets or partial overrides -- say the same thing about every verb? */
const sameVerbs = (a, b) => types_1.CRED_VERBS.every((verb) => a?.[verb] === b[verb]);
/** Would applying this patch leave every named value exactly as it is? Patches here are flat scalars. */
const patchChangesNothing = (current, patch) => Object.entries(patch).every(([key, value]) => current[key] === value);
const auditBase = (actor, action, targetKind, targetId, reason) => ({
    action,
    actorUid: actor.uid,
    targetKind,
    targetId,
    occurredAt: new Date().toISOString(),
    reason,
});
/**
 * Create a CUSTOM field on an Object.
 *
 * Always CUSTOM and always DRAFT: an administrator cannot mint a SYSTEM field, because SYSTEM means
 * "shipped with the platform and read by name in application code", and a field nothing reads is
 * not that however it is labelled.
 */
async function createCustomField(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editObjectDefinition");
    const objectKey = nonEmpty(input.objectKey, "objectKey");
    const key = validKey(input.key, "field key");
    const label = nonEmpty(input.label, "label");
    if (!types_1.FIELD_DATA_TYPES.includes(input.dataType)) {
        throw new PolicyValidationError(`"${String(input.dataType)}" is not a field data type`);
    }
    const sensitivity = input.sensitivity ?? "NORMAL";
    if (!types_1.FIELD_SENSITIVITIES.includes(sensitivity)) {
        throw new PolicyValidationError(`"${String(sensitivity)}" is not a sensitivity`);
    }
    const allowedValues = Object.freeze([...(input.allowedValues ?? [])]);
    const isEnum = input.dataType === "ENUM" || input.dataType === "ENUM_SET";
    if (isEnum && allowedValues.length === 0) {
        throw new PolicyValidationError("an ENUM field needs allowed values -- an enum of nothing can hold nothing");
    }
    if (!isEnum && allowedValues.length > 0) {
        throw new PolicyValidationError("allowed values apply to ENUM and ENUM_SET only");
    }
    if (input.dataType === "REFERENCE" && !input.referenceTo) {
        throw new PolicyValidationError("a REFERENCE field must say which object it points at");
    }
    const object = await repo.getObjectByKey(actor.tenantId, objectKey);
    if (!object)
        throw new PolicyValidationError(`no object "${objectKey}"`);
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const field = await tx.createField({
            objectId: object.id,
            key,
            label,
            description: input.description ?? null,
            dataType: input.dataType,
            required: input.required === true,
            allowedValues,
            defaultValue: input.defaultValue ?? null,
            searchable: input.searchable === true,
            sortable: input.sortable === true,
            reportable: input.reportable !== false,
            sensitivity,
            referenceTo: input.referenceTo ?? null,
            origin: "CUSTOM",
            lifecycle: "DRAFT",
        });
        await tx.appendAudit({
            ...auditBase(actor, "createCustomField", "objectField", field.id, input.reason ?? null),
            before: null,
            after: field,
        });
        return field;
    });
}
/**
 * Update the EDITABLE metadata of a field.
 *
 * WHAT MAY NEVER CHANGE, on any field: its `key` and its `dataType`. A re-key silently orphans every
 * stored value, and a retype makes the stored values mean something they were not written to mean.
 * Neither is offered here -- not guarded behind a flag, not accepted with a warning. There is no
 * parameter for either, so the request cannot be made.
 *
 * A SYSTEM field additionally refuses `lifecycle` changes: retiring a shipped field breaks
 * application code that reads it by name, and that is a code change rather than a configuration one.
 */
async function updateFieldDefinition(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editObjectDefinition");
    const fieldId = nonEmpty(input.fieldId, "fieldId");
    const objects = await repo.listObjects(actor.tenantId);
    let current = null;
    for (const o of objects) {
        const found = (await repo.listFields(actor.tenantId, o.id)).find((f) => f.id === fieldId);
        if (found) {
            current = found;
            break;
        }
    }
    if (!current)
        throw new PolicyValidationError("field not found");
    if (input.sensitivity && !types_1.FIELD_SENSITIVITIES.includes(input.sensitivity)) {
        throw new PolicyValidationError(`"${String(input.sensitivity)}" is not a sensitivity`);
    }
    // ════════════════════ A SYSTEM FIELD DEFINITION IS PROTECTED, FULL STOP ════════════════════
    //
    // This used to protect only `lifecycle`, which left a SYSTEM field's label, description,
    // required, searchable, sortable, reportable and sensitivity all editable. That is not the ruling:
    // system Field DEFINITIONS are protected and custom Fields are Admin-editable.
    //
    // The distinction that makes this safe rather than restrictive: a SYSTEM field's DEFINITION is
    // fixed, and its POLICY is not. An administrator still governs who may Create/Read/Edit/Delete it
    // through Role Field CRED, which is the thing they actually need. What they may not do is rename
    // or reclassify a field that application code reads by name -- `sensitivity` in particular is
    // read by the field-projection path, so "just a label change" is not.
    //
    // Enforced HERE, next to the transaction, rather than by hiding a button: a caller that reaches
    // the command directly gets the same refusal the UI would have prevented.
    if (current.origin === "SYSTEM") {
        throw new PolicyValidationError("a SYSTEM field's definition is protected -- its policy is configurable through Role field permissions, its definition is not");
    }
    // A MUTABLE builder over the record's EDITABLE fields only. `ObjectFieldRecord` is deeply readonly
    // by design -- a stored policy record nobody can reassign in place -- so the patch names the
    // writable subset rather than stripping that guarantee off the record type. `key` and `dataType`
    // are absent from this list on purpose: see the doc comment above.
    const patch = {};
    if (input.label !== undefined)
        patch.label = nonEmpty(input.label, "label");
    if (input.description !== undefined)
        patch.description = input.description;
    if (input.required !== undefined)
        patch.required = input.required === true;
    if (input.searchable !== undefined)
        patch.searchable = input.searchable === true;
    if (input.sortable !== undefined)
        patch.sortable = input.sortable === true;
    if (input.reportable !== undefined)
        patch.reportable = input.reportable === true;
    if (input.sensitivity !== undefined)
        patch.sensitivity = input.sensitivity;
    if (input.lifecycle !== undefined)
        patch.lifecycle = input.lifecycle;
    // A request that names only what this command cannot express -- `key`, `dataType` -- used to reach
    // the transaction with an empty patch, answer 200, and audit an "update" whose only change was
    // `updatedAt`. The caller was told their key change succeeded. `updateRole` and
    // `updateObjectMetadata` already refused this; now all three say the same thing.
    if (Object.keys(patch).length === 0)
        throw new PolicyValidationError("nothing to update");
    if (patchChangesNothing(current, patch))
        return current;
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const updated = await tx.updateField(fieldId, patch);
        await tx.appendAudit({
            ...auditBase(actor, "updateFieldDefinition", "objectField", fieldId, input.reason ?? null),
            before: current,
            after: updated,
        });
        return updated;
    });
}
/**
 * Change an Object's DISPLAY metadata.
 *
 * ════════════════════ WHY THIS EXISTS, AND WHY IT IS THIS SMALL ════════════════════
 *
 * Nothing could edit an Object at all -- no command, no port method -- while the Administration
 * contract said Object definition editing is Admin-only. That gap made "Objects are editable" false
 * in a screen that claimed it.
 *
 * What a tenant legitimately changes is what the Object is CALLED. This platform's own canonical
 * object is keyed `account` and labelled "Accounts" while the business says Customer; that is
 * exactly the case, and it is display metadata rather than a schema change.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE, and would each be a different kind of change:
 *
 *   key              identity. Every stored permission, override and workflow references it.
 *   origin           whether the platform owns this object, not a preference.
 *   lifecycle        what the engine will enforce.
 *   supportsDelete   MEASURED from whether a capability governs Delete. Making it editable would
 *                    let an administrator promise a Delete grant the engine can never honour.
 *
 * There is no generic object patch, and adding one would make authorization a property of the
 * arguments rather than of the operation.
 */
async function updateObjectMetadata(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editObjectDefinition");
    const objectKey = nonEmpty(input.objectKey, "objectKey");
    const object = await repo.getObjectByKey(actor.tenantId, objectKey);
    if (!object)
        throw new PolicyValidationError(`no object "${objectKey}"`);
    const patch = {};
    if (input.label !== undefined)
        patch.label = nonEmpty(input.label, "label");
    if (input.labelPlural !== undefined)
        patch.labelPlural = input.labelPlural;
    if (input.description !== undefined)
        patch.description = input.description;
    if (Object.keys(patch).length === 0)
        throw new PolicyValidationError("nothing to update");
    if (patchChangesNothing(object, patch))
        return object;
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const updated = await tx.updateObject(object.id, patch);
        await tx.appendAudit({
            ...auditBase(actor, "updateObjectMetadata", "object", object.id, input.reason ?? null),
            before: { label: object.label, labelPlural: object.labelPlural, description: object.description },
            after: { label: updated.label, labelPlural: updated.labelPlural, description: updated.description },
        });
        return updated;
    });
}
async function createRole(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editRoleDefinition");
    const key = validKey(input.key, "role key");
    const name = nonEmpty(input.name, "name");
    // A tenant-created Role may not claim a protected key: it would be a second Role wearing the
    // recovery Role's name, and every later "is this the admin Role" question would have two answers.
    if (administrationAuthority_1.PROTECTED_ROLE_KEYS.includes(key)) {
        throw new PolicyValidationError(`"${key}" is a protected system role key`);
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const role = await tx.createRole({
            key, name, description: input.description ?? null, origin: "CUSTOM", protected: false,
        });
        await tx.appendAudit({
            ...auditBase(actor, "createRole", "role", role.id, input.reason ?? null),
            before: null,
            after: role,
        });
        return role;
    });
}
/**
 * Set one Role's CRED over one Object.
 *
 * EVERY PRINCIPAL HOLDING THE ROLE HAS THEIR ACCESS VERSION BUMPED, in the same transaction. A
 * permission change that landed without the bump would leave every cached authorization decision
 * valid -- which is not a consistency inconvenience, it is the change silently not taking effect.
 */
async function setObjectPermission(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editRoleDefinition");
    const roleId = nonEmpty(input.roleId, "roleId");
    const objectKey = nonEmpty(input.objectKey, "objectKey");
    const cred = validCredSet(input.cred);
    const object = await repo.getObjectByKey(actor.tenantId, objectKey);
    if (!object)
        throw new PolicyValidationError(`no object "${objectKey}"`);
    if (cred.D && !object.supportsDelete) {
        // A grant with no enforcement point is refused rather than stored as a no-op an administrator
        // would go on believing they had made.
        throw new PolicyValidationError(`"${objectKey}" does not support Delete`);
    }
    const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
    if (!role)
        throw new PolicyValidationError("role not found");
    const before = (await repo.listObjectPermissions(actor.tenantId, [roleId]))
        .find((p) => p.objectId === object.id) ?? null;
    // Only an EXISTING row can be re-stated. An absent row and an explicit all-false row resolve alike
    // today but are different stored facts, so writing the first time is a real change.
    if (before && sameVerbs(before.cred, cred))
        return before;
    const holders = await principalsHolding(repo, actor.tenantId, roleId);
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const row = await tx.setObjectPermission(roleId, object.id, cred);
        for (const uid of holders)
            await tx.bumpAccessVersion(uid);
        await tx.appendAudit({
            ...auditBase(actor, "setObjectPermission", "roleObjectPermission", row.id, input.reason ?? null),
            before,
            after: row,
        });
        return row;
    });
}
async function setFieldPermissionOverride(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editRoleDefinition");
    const roleId = nonEmpty(input.roleId, "roleId");
    const fieldId = nonEmpty(input.fieldId, "fieldId");
    const override = validCredOverride(input.override);
    const before = (await repo.listFieldOverrides(actor.tenantId, [roleId])).find((o) => o.fieldId === fieldId) ?? null;
    // Removing a row that is not there, or re-stating the one that is, changes nothing.
    const removing = Object.keys(override).length === 0;
    if (removing ? before === null : before !== null && sameVerbs(before.override, override))
        return;
    const holders = await principalsHolding(repo, actor.tenantId, roleId);
    await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        await tx.setFieldOverride(roleId, fieldId, override);
        for (const uid of holders)
            await tx.bumpAccessVersion(uid);
        await tx.appendAudit({
            ...auditBase(actor, "setFieldPermissionOverride", "roleFieldOverride", fieldId, input.reason ?? null),
            before,
            after: Object.keys(override).length === 0 ? null : { roleId, fieldId, override },
        });
    });
}
/** Two assignments are the SAME EFFECTIVE ASSIGNMENT when these four agree. */
const sameEffectiveAssignment = (a, roleId, scopeType, scopeValue) => a.roleId === roleId &&
    a.scopeType === scopeType &&
    // NULL and "" are the same absence of a scope value. Treating them as different is how a
    // "global" assignment gets two spellings and the uniqueness rule stops meaning anything.
    (a.scopeValue ?? "") === (scopeValue ?? "");
/**
 * Assign a Role to a principal.
 *
 * ANY ROLE, INCLUDING ADMIN, per the Owner ruling -- role ASSIGNMENT and role DEFINITION are
 * different authorities, and this is the first. The old two-person privileged route is superseded.
 *
 * ════════════════════ MEMBERSHIP IS REQUIRED ════════════════════
 *
 * A Role granted to somebody who is not a member of this tenant confers nothing -- they resolve to
 * no context -- so it is not a grant, it is a row that looks like one. Refused here, and made
 * UNREPRESENTABLE by the composite foreign key in migration 003. Both layers, because an API check
 * defends the path that goes through the API and a migration or a repair script does not.
 *
 * ════════════════════ IDENTICAL ACTIVE ASSIGNMENTS ARE IDEMPOTENT ════════════════════
 *
 * Multi-role union stays ADDITIVE: a different Role, or the same Role at a different governed
 * scope, is a second assignment and confers more. What is NOT a second assignment is the same
 * principal holding the same Role at the same scope twice -- two active rows saying that confer no
 * more authority than one, and leave an administrator with two things to revoke before the first
 * stops applying.
 *
 * So this returns the EXISTING canonical row rather than creating a duplicate, writes no audit
 * event for a change that did not happen, and does not bump the access version -- nothing about
 * what the principal may do has moved. A revoked assignment does not block a later re-grant: that
 * one is a real change and gets its own row and its own event.
 */
async function assignRole(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "assignRole");
    const principalId = nonEmpty(input.principalId, "principalId");
    const roleId = nonEmpty(input.roleId, "roleId");
    const scopeType = input.scopeType ?? "global";
    const scopeValue = input.scopeValue ?? null;
    const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
    if (!role)
        throw new PolicyValidationError("role not found");
    const membership = await repo.getMembership(actor.tenantId, principalId);
    if (!membership || membership.status !== "active") {
        throw new PolicyValidationError("that principal is not an active member of this tenant");
    }
    const held = await repo.listAssignmentsForPrincipal(actor.tenantId, principalId);
    const already = held.find((a) => a.status === "active" && sameEffectiveAssignment(a, roleId, scopeType, scopeValue));
    if (already)
        return already;
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // BUMP FIRST, then stamp the grant with the NEW version. A grant carrying the old version would
        // be stale the instant it was written -- excluded by the resolver's own staleness rule, which is
        // a grant that silently does nothing.
        const accessVersion = await tx.bumpAccessVersion(principalId);
        const assignment = await tx.createAssignment({
            principalId,
            roleId,
            scopeType,
            scopeValue,
            status: "active",
            grantedBy: actor.uid,
            grantedAt: new Date().toISOString(),
            accessVersionAtGrant: accessVersion,
        });
        await tx.appendAudit({
            ...auditBase(actor, "assignRole", "roleAssignment", assignment.id, input.reason ?? null),
            before: null,
            after: assignment,
        });
        return assignment;
    });
}
/**
 * Revoke ONE EXACT assignment.
 *
 * By assignment id, never by (principal, role): a principal may legitimately hold the same Role at
 * two scopes, and revoking "their salesperson role" would silently remove both. The caller names
 * the one they mean.
 *
 * REFUSES to remove the LAST administering assignment in the tenant. That is the recovery
 * invariant: ordinary configuration must not be able to leave the platform unadministrable, and the
 * cheapest place to stop it is the transaction that would do it.
 */
async function revokeRole(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "assignRole");
    const assignmentId = nonEmpty(input.assignmentId, "assignmentId");
    const roles = await repo.listRoles(actor.tenantId);
    const adminRoleIds = new Set(roles.filter((r) => r.protected).map((r) => r.id));
    const target = await findAssignment(repo, actor.tenantId, assignmentId);
    if (!target)
        throw new PolicyValidationError("assignment not found");
    if (adminRoleIds.has(target.roleId) && target.status === "active") {
        const remaining = await countActiveAdministeringAssignments(repo, actor.tenantId, adminRoleIds);
        if (remaining <= 1) {
            throw new PolicyValidationError("this is the last active administering assignment -- revoking it would leave the tenant unadministrable");
        }
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const updated = await tx.setAssignmentStatus(assignmentId, "disabled");
        await tx.bumpAccessVersion(target.principalId);
        await tx.appendAudit({
            ...auditBase(actor, "revokeRole", "roleAssignment", assignmentId, input.reason ?? null),
            before: target,
            after: updated,
        });
        return updated;
    });
}
/**
 * Publish a workflow version.
 *
 * VALIDATED STRUCTURALLY FIRST. A definition that cannot describe a runnable process -- no initial
 * step, two initial steps, an action from a step that does not exist, an action leaving a terminal
 * step -- is refused here rather than discovered by the first record that gets stuck in it.
 *
 * After publication the version is IMMUTABLE, enforced by the store as well as here.
 */
async function publishWorkflowVersion(repo, actor, input) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editWorkflowDefinition");
    const versionId = nonEmpty(input.versionId, "versionId");
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    const problems = (0, workflowEngine_1.validateWorkflowVersion)(definition);
    if (problems.length > 0) {
        throw new PolicyValidationError(`workflow version cannot be published: ${problems.join("; ")}`);
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const published = await tx.publishWorkflowVersion(versionId);
        await tx.appendAudit({
            ...auditBase(actor, "publishWorkflowVersion", "workflowVersion", versionId, input.reason ?? null),
            before: { status: "DRAFT" },
            after: published,
        });
        return published;
    });
}
// ════════════════════ helpers ════════════════════
/** Every principal currently holding a Role, so a permission change can invalidate their caches. */
async function principalsHolding(repo, tenantId, roleId) {
    const uids = new Set();
    for (const uid of await allPrincipals(repo, tenantId)) {
        const assignments = await repo.listAssignmentsForPrincipal(tenantId, uid);
        if (assignments.some((a) => a.roleId === roleId && a.status === "active"))
            uids.add(uid);
    }
    return [...uids];
}
/**
 * Every principal who could hold a Role in this tenant.
 *
 * MEMBERSHIP FIRST, and that is a correctness fix rather than a tidy-up. This used to be derived
 * ONLY by walking audit events for an `after.principalId`, which is true of an assignment written
 * by `assignRole` and NOT true of one written by the tenant bootstrap -- so the initial
 * administrator was invisible here, and the "you may not revoke the last administering assignment"
 * guard would have counted zero and let it go.
 *
 * The audit-derived set is still unioned in, deliberately: a principal may hold an assignment
 * without a membership row in the foundation's own resolver proofs, which construct assignments
 * directly to test staleness and union arithmetic. A superset is the safe direction here -- this
 * feeds a guard that REFUSES, so including a principal who does not exist costs nothing and
 * excluding one who does costs the recovery invariant.
 */
async function allPrincipals(repo, tenantId) {
    const uids = new Set(await repo.listTenantPrincipalIds(tenantId));
    const events = await repo.listAuditEvents(tenantId, 10_000);
    for (const e of events) {
        const after = e.after;
        if (after && typeof after.principalId === "string")
            uids.add(after.principalId);
    }
    return [...uids];
}
async function findAssignment(repo, tenantId, assignmentId) {
    for (const uid of await allPrincipals(repo, tenantId)) {
        const found = (await repo.listAssignmentsForPrincipal(tenantId, uid)).find((a) => a.id === assignmentId);
        if (found)
            return found;
    }
    return null;
}
async function countActiveAdministeringAssignments(repo, tenantId, adminRoleIds) {
    let count = 0;
    for (const uid of await allPrincipals(repo, tenantId)) {
        for (const a of await repo.listAssignmentsForPrincipal(tenantId, uid)) {
            if (a.status === "active" && adminRoleIds.has(a.roleId))
                count += 1;
        }
    }
    return count;
}
//# sourceMappingURL=policyCommands.js.map
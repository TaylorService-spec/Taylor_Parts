"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMutation = exports.isAdminOperation = exports.ADMIN_MUTATION_OPERATIONS = exports.ADMIN_READ_OPERATIONS = void 0;
exports.executeAdminOperation = executeAdminOperation;
// The trusted Administration API — the only door into the policy store.
//
// ════════════════════ THE SHAPE OF EVERY REQUEST ════════════════════
//
//   authenticated subject          <- proved by the identity provider, and nothing else
//        |
//        v
//   resolvePrincipalContext        <- EOS principal, tenant, held Role KEYS, from PostgreSQL
//        |
//        v
//   ONE NAMED OPERATION            <- from the closed list below
//        |
//        v
//   command / query                <- validates, transacts, audits
//        |
//        v
//   canonical persisted result     <- re-read from the store, never echoed from the request
//
// ════════════════════ WHY THERE IS NO GENERIC MUTATION ════════════════════
//
// No `runSQL`. No `mutatePolicy(table, id, patch)`. No `patchAnything`. Each of those would be a
// single endpoint that can express every possible policy change, which makes authorization a
// property of the ARGUMENTS rather than of the operation — and an authorization check that has to
// parse its own arguments to know what it is permitting is one that eventually gets it wrong.
//
// The list is closed and every entry names one governed act. An operation that is not on it cannot
// be performed through this API at all, which is a much cheaper guarantee than reviewing what a
// general endpoint might accept.
//
// ════════════════════ WHAT THE BROWSER IS NOT ════════════════════
//
// The browser is not the policy source of truth, and its current grid state is not authority. Every
// mutation below re-resolves the actor's Roles from the database, re-reads the records it is about
// to change, and returns what was PERSISTED rather than what was requested. A UI that optimistically
// showed success would be showing the user their own request back.
const policyCommands_1 = require("./policyCommands");
const workflowCommands_1 = require("./workflowCommands");
const administrationAuthority_1 = require("./administrationAuthority");
const workflowEngine_1 = require("./workflowEngine");
const principalContext_1 = require("./principalContext");
// ════════════════════ the closed operation list ════════════════════
exports.ADMIN_READ_OPERATIONS = Object.freeze([
    // ONE READ BEYOND THE OWNER'S NAMED LIST, and the reason is that the list could not be used
    // without it: `listPrincipalRoleAssignments` takes a principal id, and nothing else returns one.
    // A Users screen could show a person's Roles only if somebody already knew their opaque id.
    // Recorded here rather than added quietly.
    "listTenantPrincipals",
    "listObjects",
    "readObjectWithFields",
    "listRoles",
    "readRolePolicy",
    "listPrincipalRoleAssignments",
    "listWorkflows",
    "readWorkflowVersion",
    "readPolicyAuditHistory",
]);
exports.ADMIN_MUTATION_OPERATIONS = Object.freeze([
    // Object DISPLAY metadata. The only Object mutation there is: no key edit, no delete, no generic
    // patch. Added because "Object definition editing is Admin-only" was a contract with no operation
    // behind it, which made the Objects screen's claim to be editable false.
    "updateObjectMetadata",
    "createCustomField",
    "updateCustomFieldMetadata",
    "createRole",
    "updateRole",
    "setObjectPermission",
    "setFieldPermissionOverride",
    "removeFieldPermissionOverride",
    "assignRole",
    "revokeRole",
    "createWorkflowDraft",
    "createWorkflowVersion",
    "updateWorkflowDefinition",
    "setWorkflowRoleBinding",
    "publishWorkflowVersion",
]);
const READS = new Set(exports.ADMIN_READ_OPERATIONS);
const MUTATIONS = new Set(exports.ADMIN_MUTATION_OPERATIONS);
const isAdminOperation = (name) => typeof name === "string" && (READS.has(name) || MUTATIONS.has(name));
exports.isAdminOperation = isAdminOperation;
const isMutation = (name) => MUTATIONS.has(name);
exports.isMutation = isMutation;
/**
 * Run one named operation as one authenticated caller.
 *
 * Never throws for an expected refusal. A thrown error would make "denied" and "the database is
 * down" the same event at the transport, and they need different responses and different alerts.
 */
async function executeAdminOperation(deps, request) {
    const { repo } = deps;
    const operation = request.operation;
    if (!(0, exports.isAdminOperation)(operation)) {
        return fail(operation, "UNKNOWN_OPERATION", `"${String(operation)}" is not an Administration operation`);
    }
    let context;
    try {
        context = await (0, principalContext_1.resolvePrincipalContext)(repo, {
            externalSubject: request.caller?.externalSubject ?? "",
            identityProvider: request.caller?.identityProvider,
            requestedTenantId: request.caller?.requestedTenantId ?? null,
        });
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError) {
            // UNKNOWN_PRINCIPAL is authentication-shaped; everything else is a refusal about authority.
            const code = err.refusal === "UNKNOWN_PRINCIPAL" ? "UNAUTHENTICATED" : "FORBIDDEN";
            return fail(operation, code, refusalMessage(err.refusal));
        }
        throw err;
    }
    const actor = {
        tenantId: context.tenantId,
        uid: context.uid,
        heldRoleKeys: context.heldRoleKeys,
    };
    const input = (request.input ?? {});
    const reason = withRequestId(input.reason, request.requestId);
    try {
        const data = await dispatch(repo, actor, operation, input, reason);
        return { ok: true, operation, tenantId: context.tenantId, data: data };
    }
    catch (err) {
        return fail(operation, classify(err), messageFor(err));
    }
}
async function dispatch(repo, actor, operation, input, reason) {
    switch (operation) {
        // ──────────── reads ────────────
        //
        // Reads are open to any principal with a context in the tenant. That is not a gap: what a read
        // RETURNS is the tenant's policy configuration, and an administrator's grid has to be readable
        // by the people whose access it describes for "why can I not see this" to be answerable. The
        // sensitive act is CHANGING it, and every mutation below is authority-gated.
        case "listObjects":
            return repo.listObjects(actor.tenantId);
        case "readObjectWithFields": {
            const key = requireString(input.objectKey, "objectKey");
            const object = await repo.getObjectByKey(actor.tenantId, key);
            if (!object)
                throw new NotFound(`no object "${key}"`);
            return { object, fields: await repo.listFields(actor.tenantId, object.id) };
        }
        case "listRoles":
            return repo.listRoles(actor.tenantId);
        case "readRolePolicy": {
            const roleId = requireString(input.roleId, "roleId");
            const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
            if (!role)
                throw new NotFound("role not found");
            const [objectPermissions, fieldOverrides] = await Promise.all([
                repo.listObjectPermissions(actor.tenantId, [roleId]),
                repo.listFieldOverrides(actor.tenantId, [roleId]),
            ]);
            return { role, objectPermissions, fieldOverrides };
        }
        case "listTenantPrincipals": {
            // Membership is the population: who this tenant knows about. It returns identity, never
            // authority -- no Roles, no permissions -- so a member can see who else is in the tenant
            // without learning what any of them may do.
            const ids = await repo.listTenantPrincipalIds(actor.tenantId);
            const principals = [];
            for (const id of ids) {
                const principal = await repo.getPrincipal(id);
                if (!principal)
                    continue;
                principals.push({
                    id: principal.id,
                    displayName: principal.displayName,
                    externalSubject: principal.externalSubject,
                    identityProvider: principal.identityProvider,
                    status: principal.status,
                });
            }
            return principals;
        }
        case "listPrincipalRoleAssignments": {
            const principalId = requireString(input.principalId, "principalId");
            const assignments = await repo.listAssignmentsForPrincipal(actor.tenantId, principalId);
            const roles = await repo.listRoles(actor.tenantId);
            const keyById = new Map(roles.map((r) => [r.id, r.key]));
            const version = await repo.getAccessVersion(actor.tenantId, principalId);
            return {
                principalId,
                accessVersion: version?.accessVersion ?? 0,
                assignments: assignments.map((a) => ({
                    ...a,
                    roleKey: keyById.get(a.roleId) ?? null,
                })),
            };
        }
        case "listWorkflows": {
            const workflows = await repo.listWorkflows(actor.tenantId);
            const withVersions = [];
            for (const workflow of workflows) {
                withVersions.push({
                    workflow,
                    versions: await repo.listWorkflowVersions(actor.tenantId, workflow.id),
                });
            }
            return withVersions;
        }
        case "readWorkflowVersion":
            return readWorkflowVersion(repo, actor, requireString(input.versionId, "versionId"));
        case "readPolicyAuditHistory": {
            const limit = clampLimit(input.limit);
            const events = await repo.listAuditEvents(actor.tenantId, limit);
            return events;
        }
        // ──────────── mutations ────────────
        //
        // Each delegates to the governed command, which re-checks authority itself. The check is not
        // done here INSTEAD -- it is done there, next to the transaction, so a future caller that
        // bypasses this dispatcher is still refused.
        case "updateObjectMetadata":
            return (0, policyCommands_1.updateObjectMetadata)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                label: input.label === undefined ? undefined : requireString(input.label, "label"),
                labelPlural: input.labelPlural === undefined ? undefined : optionalString(input.labelPlural),
                description: input.description === undefined ? undefined : optionalString(input.description),
                reason,
            });
        case "createCustomField":
            // EVERY metadata value the command supports, not the three the first UI happened to send.
            // A create surface that silently drops `sensitivity` or `referenceTo` produces a field the
            // administrator has to go and fix immediately, which is worse than refusing it.
            return (0, policyCommands_1.createCustomField)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                key: requireString(input.key, "key"),
                label: requireString(input.label, "label"),
                description: optionalString(input.description),
                dataType: requireString(input.dataType, "dataType"),
                required: input.required === true,
                allowedValues: Array.isArray(input.allowedValues) ? input.allowedValues : undefined,
                defaultValue: (input.defaultValue ?? null),
                searchable: input.searchable === true,
                sortable: input.sortable === true,
                reportable: input.reportable === true,
                sensitivity: input.sensitivity === undefined ? undefined : requireString(input.sensitivity, "sensitivity"),
                referenceTo: optionalString(input.referenceTo),
                reason,
            });
        case "updateCustomFieldMetadata":
            // Every value `UpdateFieldInput` accepts. `key` and `dataType` are absent because they are
            // not in that input at all -- changing either is a data migration wearing an edit's clothes,
            // and the command has no way to express it.
            return (0, policyCommands_1.updateFieldDefinition)(repo, actor, {
                fieldId: requireString(input.fieldId, "fieldId"),
                label: input.label === undefined ? undefined : requireString(input.label, "label"),
                description: input.description === undefined ? undefined : optionalString(input.description),
                required: typeof input.required === "boolean" ? input.required : undefined,
                searchable: typeof input.searchable === "boolean" ? input.searchable : undefined,
                sortable: typeof input.sortable === "boolean" ? input.sortable : undefined,
                reportable: typeof input.reportable === "boolean" ? input.reportable : undefined,
                sensitivity: input.sensitivity === undefined ? undefined : requireString(input.sensitivity, "sensitivity"),
                lifecycle: input.lifecycle === undefined ? undefined : requireString(input.lifecycle, "lifecycle"),
                reason,
            });
        case "createRole":
            return (0, policyCommands_1.createRole)(repo, actor, {
                key: requireString(input.key, "key"),
                name: requireString(input.name, "name"),
                description: optionalString(input.description),
                reason,
            });
        case "updateRole": {
            // Renaming and re-describing a Role is the whole of "update" today. Its PERMISSIONS change
            // through setObjectPermission, and its KEY never changes -- a key is identity, and an
            // identity that can be edited is one that every stored reference has to be rewritten for.
            const roleId = requireString(input.roleId, "roleId");
            const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
            if (!role)
                throw new NotFound("role not found");
            return updateRoleMetadata(repo, actor, role, input, reason);
        }
        case "setObjectPermission":
            return (0, policyCommands_1.setObjectPermission)(repo, actor, {
                roleId: requireString(input.roleId, "roleId"),
                objectKey: requireString(input.objectKey, "objectKey"),
                cred: input.cred,
                reason,
            });
        case "setFieldPermissionOverride":
            return (0, policyCommands_1.setFieldPermissionOverride)(repo, actor, {
                roleId: requireString(input.roleId, "roleId"),
                fieldId: requireString(input.fieldId, "fieldId"),
                override: input.override,
                reason,
            });
        case "removeFieldPermissionOverride":
            // An EMPTY override removes the row. "No opinion" has one spelling, not two, and giving
            // removal its own named operation is what keeps the UI from having to know that.
            return (0, policyCommands_1.setFieldPermissionOverride)(repo, actor, {
                roleId: requireString(input.roleId, "roleId"),
                fieldId: requireString(input.fieldId, "fieldId"),
                override: {},
                reason,
            });
        case "assignRole":
            // MEMBERSHIP, and IDEMPOTENCE, are enforced in the COMMAND -- next to the transaction, so a
            // caller that bypasses this dispatcher gets the same answer. They were briefly checked here
            // as well; two spellings of one rule is how the two eventually disagree. Migration 003 makes
            // the membership half unrepresentable at the database as well.
            return (0, policyCommands_1.assignRole)(repo, actor, {
                principalId: requireString(input.principalId, "principalId"),
                roleId: requireString(input.roleId, "roleId"),
                scopeType: optionalString(input.scopeType) ?? undefined,
                scopeValue: optionalString(input.scopeValue),
                reason,
            });
        case "revokeRole":
            return (0, policyCommands_1.revokeRole)(repo, actor, {
                assignmentId: requireString(input.assignmentId, "assignmentId"),
                reason,
            });
        case "createWorkflowDraft":
            return (0, workflowCommands_1.createWorkflowDraft)(repo, actor, {
                key: requireString(input.key, "key"),
                name: requireString(input.name, "name"),
                description: optionalString(input.description),
                objectKey: requireString(input.objectKey, "objectKey"),
                definition: input.definition,
                reason,
            });
        case "createWorkflowVersion":
            return (0, workflowCommands_1.createWorkflowVersion)(repo, actor, {
                workflowId: requireString(input.workflowId, "workflowId"),
                copyFromVersionId: optionalString(input.copyFromVersionId),
                definition: input.definition,
                reason,
            });
        case "updateWorkflowDefinition":
            return (0, workflowCommands_1.updateWorkflowDefinition)(repo, actor, {
                versionId: requireString(input.versionId, "versionId"),
                definition: input.definition,
                reason,
            });
        case "setWorkflowRoleBinding":
            return (0, workflowCommands_1.setWorkflowRoleBinding)(repo, actor, {
                versionId: requireString(input.versionId, "versionId"),
                actionKey: requireString(input.actionKey, "actionKey"),
                roleId: requireString(input.roleId, "roleId"),
                reason,
            });
        case "publishWorkflowVersion":
            // ONLY IF THE PUBLICATION RULES ARE SATISFIED. The command validates the definition
            // structurally and refuses otherwise; nothing here weakens that, and publication still does
            // not reroute any execution.
            return (0, policyCommands_1.publishWorkflowVersion)(repo, actor, {
                versionId: requireString(input.versionId, "versionId"),
                reason,
            });
        default: {
            // Exhaustiveness: adding an operation to the list without handling it fails to compile,
            // rather than becoming a runtime "unknown operation" nobody notices until a user hits it.
            const never = operation;
            throw new Error(`unhandled operation ${String(never)}`);
        }
    }
}
/**
 * Read one workflow version with its definition, resolved to Role KEYS.
 *
 * Keys rather than ids, because an administrator reads Role keys and an id in a UI is a value
 * somebody eventually starts copying into application code.
 */
async function readWorkflowVersion(repo, actor, versionId) {
    for (const workflow of await repo.listWorkflows(actor.tenantId)) {
        for (const version of await repo.listWorkflowVersions(actor.tenantId, workflow.id)) {
            if (version.id !== versionId)
                continue;
            const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
            const roles = await repo.listRoles(actor.tenantId);
            const keyById = new Map(roles.map((r) => [r.id, r.key]));
            return {
                workflow,
                version,
                steps: definition.steps.map((s) => ({
                    key: s.key, label: s.label, initial: s.initial, terminal: s.terminal,
                })),
                actions: definition.actions.map((a) => ({
                    key: a.key,
                    label: a.label,
                    from: a.fromStepKey,
                    to: a.toStepKey,
                    requiresOwnAssignment: a.requiresOwnAssignment,
                    roleKeys: definition.bindings
                        .filter((b) => b.actionKey === a.key)
                        .map((b) => keyById.get(b.roleId))
                        .filter((k) => typeof k === "string")
                        .sort(),
                })),
            };
        }
    }
    throw new NotFound("workflow version not found");
}
/** Rename or re-describe a Role. Its key and its permissions are not touched here. */
async function updateRoleMetadata(repo, actor, role, input, reason) {
    (0, administrationAuthority_1.requireAdministrationAuthority)(actor.heldRoleKeys, "editRoleDefinition");
    const name = optionalString(input.name);
    const description = input.description === undefined ? undefined : optionalString(input.description);
    if (name === null && description === undefined) {
        throw new policyCommands_1.PolicyValidationError("nothing to update");
    }
    // An identical rename is not a mutation: no write, no audit event. See policyCommands.ts,
    // "A CHANGE THAT CHANGES NOTHING IS NOT A MUTATION".
    if ((name ?? role.name) === role.name && (description === undefined ? role.description : description) === role.description) {
        return role;
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const updated = await tx.updateRole(role.id, {
            ...(name ? { name } : {}),
            ...(description === undefined ? {} : { description }),
        });
        await tx.appendAudit({
            action: "updateRole",
            actorUid: actor.uid,
            targetKind: "role",
            targetId: role.id,
            before: { name: role.name, description: role.description },
            after: { name: updated.name, description: updated.description },
            occurredAt: new Date().toISOString(),
            reason,
        });
        return updated;
    });
}
// ════════════════════ input handling ════════════════════
class NotFound extends Error {
}
function requireString(value, what) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new policyCommands_1.PolicyValidationError(`${what} is required`);
    }
    return value.trim();
}
function optionalString(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string")
        throw new policyCommands_1.PolicyValidationError("expected a string");
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}
/** Bounded, so a caller cannot ask for the whole audit table in one request. */
function clampLimit(value) {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 100;
    return Math.min(Math.max(n, 1), 500);
}
/**
 * Carry the request id into the audit event's reason.
 *
 * Correlating an audit event with the request that caused it is what makes a support question
 * answerable months later; the audit schema has no correlation column, so it rides in the reason
 * rather than requiring a migration for a string.
 */
function withRequestId(reason, requestId) {
    const text = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
    if (!requestId)
        return text;
    return text ? `${text} [request ${requestId}]` : `[request ${requestId}]`;
}
function classify(err) {
    if (err instanceof administrationAuthority_1.AdministrationDeniedError)
        return "FORBIDDEN";
    if (err instanceof NotFound)
        return "NOT_FOUND";
    if (err instanceof policyCommands_1.PolicyValidationError)
        return "INVALID_INPUT";
    const name = err?.constructor?.name;
    // A store refusal is a conflict with what is already there -- a duplicate key, an immutable
    // published version -- rather than a malformed request.
    if (name === "PolicyStoreError")
        return "CONFLICT";
    return "INTERNAL";
}
/**
 * The message a caller sees.
 *
 * An INTERNAL failure is deliberately opaque. A database error's text can carry a table name, a
 * constraint name, a column value, or a fragment of another tenant's row, and none of that belongs
 * in a response -- the detail belongs in the server's own log.
 */
function messageFor(err) {
    if (classify(err) === "INTERNAL")
        return "the request could not be completed";
    return err instanceof Error ? err.message : "the request could not be completed";
}
function refusalMessage(refusal) {
    switch (refusal) {
        case "UNKNOWN_PRINCIPAL": return "this identity is not known to EOS";
        case "PRINCIPAL_DISABLED": return "this principal is disabled";
        case "NO_TENANT_MEMBERSHIP": return "this principal belongs to no tenant";
        case "TENANT_NOT_A_MEMBERSHIP": return "this principal is not a member of the requested tenant";
        case "AMBIGUOUS_TENANT": return "this principal belongs to several tenants; state which one";
        case "TENANT_NOT_ACTIVE": return "this tenant is not active";
        default: return "not authorized";
    }
}
const fail = (operation, code, message) => Object.freeze({ ok: false, operation, code, message });
//# sourceMappingURL=adminPolicyApi.js.map
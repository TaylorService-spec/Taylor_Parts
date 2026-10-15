"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_MUTATION_OPERATIONS = exports.WORKFLOW_READ_OPERATIONS = void 0;
exports.dispatchWorkflowOperation = dispatchWorkflowOperation;
exports.readWorkflowVersionView = readWorkflowVersionView;
// The WORKFLOW half of the Administration API: reads and mutations, dispatched from adminPolicyApi.
//
// adminPolicyApi owns the transport concerns -- the closed operation list, principal resolution,
// the read gate (workflow reads -> workflowDefinition.read via the "workflows" surface; the
// responsibilities read -> admin.principalAccess.read via "users") and failure classification.
// This file owns what each workflow operation MEANS. Every mutation re-checks its own capability
// next to its transaction (workflowAdministration.requireWorkflowAdministrationCapability), so a
// caller that reached a command directly is gated exactly as one that came through here.
const policyCommands_1 = require("./policyCommands");
const workflowCommands_1 = require("./workflowCommands");
const workflowAdministration_1 = require("./workflowAdministration");
const workflowEngine_1 = require("./workflowEngine");
const workflowLifecycle_1 = require("./workflowLifecycle");
const workflowInstances_1 = require("./workflowInstances");
const workflowResponsibilities_1 = require("./workflowResponsibilities");
const workflowValidation_1 = require("./workflowValidation");
exports.WORKFLOW_READ_OPERATIONS = Object.freeze([
    "listWorkflows",
    "readWorkflowVersion",
    "validateWorkflowVersion",
    "listWorkflowInstances",
    "readWorkflowHistory",
    "listPrincipalWorkflowResponsibilities",
]);
exports.WORKFLOW_MUTATION_OPERATIONS = Object.freeze([
    "createWorkflowDraft",
    "createWorkflowVersion",
    "updateWorkflowDefinition",
    "setWorkflowRoleBinding",
    "publishWorkflowVersion",
    "activateWorkflowVersion",
    "retireWorkflowVersion",
    "startWorkflowInstance",
    "adoptRecordsIntoWorkflowVersion",
    "migrateWorkflowInstances",
]);
/** Run one workflow operation. The caller has already resolved the actor and applied the read gate. */
async function dispatchWorkflowOperation(deps, actor, operation, input, reason) {
    const { repo } = deps;
    switch (operation) {
        // ──────────── reads ────────────
        case "listWorkflows": {
            const out = [];
            for (const workflow of await repo.listWorkflows(actor.tenantId)) {
                out.push({ workflow, versions: await repo.listWorkflowVersions(actor.tenantId, workflow.id) });
            }
            return out;
        }
        case "readWorkflowVersion":
            return readWorkflowVersionView(repo, actor, requireString(input.versionId, "versionId"));
        case "validateWorkflowVersion": {
            // A stored version, or an unsaved definition the editor is about to save.
            if (typeof input.versionId === "string" && input.versionId.trim().length > 0) {
                const { workflow, version, ...result } = await (0, workflowLifecycle_1.validateStoredWorkflowVersion)(repo, actor, input.versionId.trim());
                return { versionId: version.id, version: version.version, status: version.status, workflowKey: workflow.key, ...result };
            }
            return validateUnsavedDefinition(repo, actor, input);
        }
        case "listWorkflowInstances": {
            const versionId = requireString(input.versionId, "versionId");
            await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, versionId);
            return repo.listWorkflowInstances(actor.tenantId, versionId);
        }
        case "readWorkflowHistory":
            return workflowHistory(repo, actor, requireString(input.workflowId, "workflowId"), clampLimit(input.limit));
        case "listPrincipalWorkflowResponsibilities": {
            const principalId = requireString(input.principalId, "principalId");
            const membership = await repo.getMembership(actor.tenantId, principalId);
            if (!membership)
                throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "principal not found in this tenant");
            if (typeof deps.explainEffectiveAccess !== "function") {
                throw new Error("listPrincipalWorkflowResponsibilities needs the runtime evaluator, which is not composed on this server");
            }
            const explained = await deps.explainEffectiveAccess(actor.tenantId, principalId);
            // PROVENANCE ONLY: the ids of the Principal's ACTIVE GLOBAL assignments of the Roles the evaluator already counted
            // (explained.securityRoleKeys), so each entry can link to the assignment that produced it. Decides nothing.
            const [roles, assignments] = await Promise.all([repo.listRoles(actor.tenantId), repo.listAssignmentsForPrincipal(actor.tenantId, principalId)]);
            const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
            const counted = new Set(explained.securityRoleKeys);
            const globalAssignments = assignments
                .filter((a) => a.status === "active" && a.scopeType === "global" && counted.has(roleKeyById.get(a.roleId) ?? ""))
                .map((a) => ({ assignmentId: a.id, roleKey: roleKeyById.get(a.roleId) }));
            return (0, workflowResponsibilities_1.deriveWorkflowResponsibilities)(principalId, await (0, workflowResponsibilities_1.loadActiveWorkflowDefinitions)(repo, actor.tenantId), explained, { globalAssignments });
        }
        // ──────────── mutations ────────────
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
            return (0, workflowLifecycle_1.publishWorkflowVersion)(repo, actor, { versionId: requireString(input.versionId, "versionId"), reason });
        case "activateWorkflowVersion":
            return (0, workflowLifecycle_1.activateWorkflowVersion)(repo, actor, { versionId: requireString(input.versionId, "versionId"), reason });
        case "retireWorkflowVersion":
            return (0, workflowLifecycle_1.retireWorkflowVersion)(repo, actor, { versionId: requireString(input.versionId, "versionId"), reason });
        case "startWorkflowInstance":
            return (0, workflowInstances_1.startWorkflowInstance)(repo, actor, {
                workflowKey: requireString(input.workflowKey, "workflowKey"),
                recordId: requireString(input.recordId, "recordId"),
                reason,
            });
        case "adoptRecordsIntoWorkflowVersion":
            return (0, workflowInstances_1.adoptRecordsIntoWorkflowVersion)(repo, actor, {
                versionId: requireString(input.versionId, "versionId"),
                records: Array.isArray(input.records) ? input.records : [],
                reason,
            });
        case "migrateWorkflowInstances":
            return (0, workflowInstances_1.migrateWorkflowInstances)(repo, actor, {
                fromVersionId: requireString(input.fromVersionId, "fromVersionId"),
                toVersionId: requireString(input.toVersionId, "toVersionId"),
                stepMap: (input.stepMap ?? null),
                instanceIds: Array.isArray(input.instanceIds) ? input.instanceIds : null,
                reason,
            });
        default: {
            const never = operation;
            throw new Error(`unhandled workflow operation ${String(never)}`);
        }
    }
}
/** One version with its definition, resolved to Role KEYS, with capability, guard and binding kind. */
async function readWorkflowVersionView(repo, actor, versionId) {
    const { workflow, version } = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, versionId);
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    const [roles, functionalRoles] = await Promise.all([repo.listRoles(actor.tenantId), repo.listFunctionalRoles(actor.tenantId)]);
    const keyById = new Map(roles.map((r) => [r.id, r.key]));
    const functionalKeyById = new Map(functionalRoles.map((f) => [f.id, f.key]));
    return {
        workflow,
        version,
        active: workflow.activeVersionId === version.id,
        steps: definition.steps.map((s) => ({ key: s.key, label: s.label, initial: s.initial, terminal: s.terminal })),
        actions: definition.actions.map((a) => {
            const bindings = definition.bindings
                .filter((b) => b.actionKey === a.key)
                .map((b) => (b.bindingKind ?? "SECURITY_ROLE") === "FUNCTIONAL_ROLE"
                ? { roleKey: null, functionalRoleKey: functionalKeyById.get(b.functionalRoleId ?? "") ?? b.functionalRoleId ?? null, bindingKind: "FUNCTIONAL_ROLE" }
                : { roleKey: keyById.get(b.roleId ?? "") ?? b.roleId, functionalRoleKey: null, bindingKind: b.bindingKind ?? "SECURITY_ROLE" })
                .sort((x, y) => `${x.bindingKind}|${x.roleKey ?? x.functionalRoleKey ?? ""}`.localeCompare(`${y.bindingKind}|${y.roleKey ?? y.functionalRoleKey ?? ""}`));
            return {
                key: a.key,
                label: a.label,
                from: a.fromStepKey,
                to: a.toStepKey,
                requiresOwnAssignment: a.requiresOwnAssignment,
                capabilityKey: a.capabilityKey ?? null,
                guardKind: a.guardKind ?? (a.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
                roleKeys: bindings.filter((b) => b.bindingKind === "SECURITY_ROLE").map((b) => b.roleKey),
                functionalRoleKeys: bindings.filter((b) => b.bindingKind === "FUNCTIONAL_ROLE").map((b) => b.functionalRoleKey),
                bindings,
            };
        }),
    };
}
async function validateUnsavedDefinition(repo, actor, input) {
    const objectKey = optionalString(input.objectKey);
    const definition = input.definition;
    if (!definition || !Array.isArray(definition.steps) || !Array.isArray(definition.actions)) {
        throw new policyCommands_1.PolicyValidationError("versionId, or objectKey and a definition { steps, actions }, is required");
    }
    const context = await (0, workflowValidation_1.loadWorkflowValidationContext)(repo, actor.tenantId);
    return (0, workflowValidation_1.validateWorkflowDefinition)({
        objectKey,
        steps: definition.steps.map((s) => ({ key: String(s?.key ?? ""), initial: s?.initial === true, terminal: s?.terminal === true })),
        actions: definition.actions.map((a) => ({
            key: String(a?.key ?? ""), from: String(a?.from ?? ""), to: String(a?.to ?? ""),
            capabilityKey: (0, workflowCommands_1.actionCapabilityKey)(a), guardKind: (0, workflowCommands_1.actionGuardKind)(a),
        })),
        bindings: definition.actions.flatMap((a) => [
            ...(a?.roleKeys ?? []).map((roleKey) => ({
                actionKey: String(a?.key ?? ""),
                roleKey: context.roleKeys.has(roleKey) ? roleKey : null,
                roleRef: roleKey,
                bindingKind: "SECURITY_ROLE",
            })),
            ...(Array.isArray(a?.functionalRoleKeys) ? a.functionalRoleKeys : []).map((functionalRoleKey) => ({
                actionKey: String(a?.key ?? ""),
                roleKey: null,
                roleRef: String(functionalRoleKey),
                bindingKind: "FUNCTIONAL_ROLE",
                functionalRoleKey: context.functionalRoles?.has(functionalRoleKey) ? functionalRoleKey : null,
            })),
        ]),
    }, context);
}
/**
 * The audit history of ONE workflow: every workflow-kind event whose target is one of its versions
 * or instances, or whose payload names it. Newest last, bounded.
 */
async function workflowHistory(repo, actor, workflowId, limit) {
    const workflow = (await repo.listWorkflows(actor.tenantId)).find((w) => w.id === workflowId);
    if (!workflow)
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "workflow not found");
    const versionIds = new Set((await repo.listWorkflowVersions(actor.tenantId, workflowId)).map((v) => v.id));
    const names = (payload) => {
        const p = payload;
        return p?.workflowId === workflowId || p?.workflowKey === workflow.key;
    };
    const events = await repo.listAuditEvents(actor.tenantId, 500);
    return events
        .filter((e) => typeof e.targetKind === "string" && e.targetKind.startsWith("workflow"))
        .filter((e) => versionIds.has(e.targetId) || names(e.before) || names(e.after))
        .slice(-limit);
}
function requireString(value, what) {
    if (typeof value !== "string" || value.trim().length === 0)
        throw new policyCommands_1.PolicyValidationError(`${what} is required`);
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
function clampLimit(value) {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 100;
    return Math.min(Math.max(n, 1), 500);
}
//# sourceMappingURL=workflowAdminApi.js.map
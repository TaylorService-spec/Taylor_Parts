"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveWorkflowResponsibilities = deriveWorkflowResponsibilities;
exports.loadActiveWorkflowDefinitions = loadActiveWorkflowDefinitions;
const workflowEngine_1 = require("./workflowEngine");
const assignmentScopeRuntime_1 = require("./assignmentScopeRuntime");
/** Pure: bindings matching the Principal's Roles, intersected with effective authority. */
function deriveWorkflowResponsibilities(principalId, active, explained, provenance = {}) {
    const held = new Set(explained.securityRoleKeys);
    const functionalFacts = explained.employeeFacts?.functionalRoles ?? [];
    const heldFunctional = new Set(functionalFacts.map((f) => f.functionalRoleId));
    const functionalAssignmentOf = new Map(functionalFacts.map((f) => [f.functionalRoleId, f.assignmentId ?? null]));
    const authorityByCapability = new Map(explained.actions.map((a) => [a.capabilityKey, a]));
    const globalAssignmentsOf = (roleKey) => (provenance.globalAssignments ?? []).filter((a) => a.roleKey === roleKey);
    const scopedAssignments = explained.assignments?.scoped ?? [];
    const employeeId = explained.employeeId ?? null;
    const responsibilities = [];
    const boundWithoutAuthority = [];
    for (const { workflow, version, definition, roleKeyById, functionalRoleKeyById } of active) {
        for (const action of definition.actions) {
            const capabilityKey = action.capabilityKey ?? null;
            const bindings = definition.bindings.filter((b) => b.actionKey === action.key);
            const securityBindings = bindings.filter((b) => (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE" && b.roleId);
            // GLOBAL holders of a bound Role.
            const securityRoleSources = [];
            for (const b of securityBindings) {
                const roleKey = roleKeyById.get(b.roleId);
                if (!roleKey)
                    continue;
                if (held.has(roleKey)) {
                    const assignments = globalAssignmentsOf(roleKey);
                    for (const a of assignments.length > 0 ? assignments : [{ assignmentId: null, roleKey }]) {
                        securityRoleSources.push(Object.freeze({ roleKey, roleId: b.roleId, bindingId: b.id,
                            assignmentId: a.assignmentId, scopeType: "global", scopeValue: null }));
                    }
                }
                // SCOPED holders: the binding counts only for a capability evaluable at that scope (holdingAdmits' rule).
                for (const a of scopedAssignments) {
                    if (a.roleKey !== roleKey || !capabilityKey || !(0, assignmentScopeRuntime_1.scopeEvaluableCapabilities)(a.scopeType).has(capabilityKey))
                        continue;
                    securityRoleSources.push(Object.freeze({ roleKey, roleId: b.roleId, bindingId: b.id,
                        assignmentId: a.assignmentId, scopeType: a.scopeType, scopeValue: a.scopeValue }));
                }
            }
            const viaRoles = [...new Set(securityRoleSources.map((x) => x.roleKey))].sort();
            const globallyBound = securityRoleSources.some((x) => x.scopeType === "global");
            const functionalBindings = bindings.filter((b) => b.bindingKind === "FUNCTIONAL_ROLE" && b.functionalRoleId);
            const keyOf = (id) => functionalRoleKeyById?.get(id) ?? id;
            const functionalRoleSources = functionalBindings
                .map((b) => Object.freeze({ functionalRoleKey: keyOf(b.functionalRoleId), functionalRoleId: b.functionalRoleId,
                bindingId: b.id, held: heldFunctional.has(b.functionalRoleId),
                assignmentId: functionalAssignmentOf.get(b.functionalRoleId) ?? null }))
                .sort((x, y) => x.functionalRoleKey.localeCompare(y.functionalRoleKey));
            const requiredFunctionalRoles = functionalRoleSources.map((f) => f.functionalRoleKey);
            const viaFunctionalRoles = functionalRoleSources.filter((f) => f.held).map((f) => f.functionalRoleKey);
            if (viaRoles.length === 0 && viaFunctionalRoles.length === 0)
                continue;
            const explainedAction = capabilityKey ? authorityByCapability.get(capabilityKey) : undefined;
            let authority = explainedAction?.result ?? "DENIED";
            let reasonCode = capabilityKey ? (explainedAction?.reasonCode ?? "CAPABILITY_MISSING") : "ACTION_WITHOUT_CAPABILITY";
            let source = requiredFunctionalRoles.length > 0
                ? "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY" : "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY";
            const allowing = (a) => a === "ALLOWED" || a === "CONDITIONAL" || a === "SCOPED";
            if (viaRoles.length === 0) {
                // Holds a bound Functional Role but no bound Security Role: the Functional Role confers NOTHING.
                authority = "DENIED";
                reasonCode = "SECURITY_ROLE_BINDING_REQUIRED";
                source = "FUNCTIONAL_ROLE_BINDING_ONLY";
            }
            else if (requiredFunctionalRoles.length > 0 && viaFunctionalRoles.length === 0 && allowing(authority)) {
                authority = "DENIED";
                reasonCode = "FUNCTIONAL_ROLE_REQUIRED";
            }
            else if (!globallyBound && allowing(authority)) {
                // Bound ONLY through a scoped assignment: the binding itself is admitted per record's business context.
                authority = "SCOPED";
                reasonCode = "SCOPE_CONTEXT_REQUIRED";
            }
            const capabilityGrants = [
                ...(explainedAction?.sourceRoles ?? []).map((r) => Object.freeze({ roleKey: r.roleKey, scopeType: "global", scopeValue: null, condition: r.condition ?? null })),
                ...(explainedAction?.scopedSources ?? []).map((r) => Object.freeze({ roleKey: r.roleKey, scopeType: r.scopeType, scopeValue: r.scopeValue, condition: r.condition ?? null })),
            ];
            const grantConditions = [...new Map(capabilityGrants.filter((g) => g.condition !== null)
                    .map((g) => [JSON.stringify(g.condition), g.condition])).values()];
            const adminLocations = [
                ...securityRoleSources.map((x) => Object.freeze({ kind: "SECURITY_ROLE_ASSIGNMENT", id: x.assignmentId,
                    roleKey: x.roleKey, scopeType: x.scopeType, scopeValue: x.scopeValue, principalId })),
                ...functionalRoleSources.map((f) => Object.freeze({ kind: "FUNCTIONAL_ROLE_ASSIGNMENT", id: f.assignmentId,
                    functionalRoleKey: f.functionalRoleKey, functionalRoleId: f.functionalRoleId, employeeId, held: f.held })),
                ...[...securityBindings.filter((b) => viaRoles.includes(roleKeyById.get(b.roleId) ?? "")), ...functionalBindings]
                    .map((b) => Object.freeze({ kind: "WORKFLOW_BINDING", id: b.id, workflowId: workflow.id, workflowKey: workflow.key,
                    versionId: version.id, version: version.version, actionKey: action.key, bindingKind: b.bindingKind ?? "SECURITY_ROLE",
                    boundKey: b.bindingKind === "FUNCTIONAL_ROLE" ? keyOf(b.functionalRoleId) : (roleKeyById.get(b.roleId) ?? String(b.roleId)) })),
                ...(capabilityKey
                    ? (capabilityGrants.length > 0 ? [...new Set(capabilityGrants.map((g) => g.roleKey))] : viaRoles).map((roleKey) => Object.freeze({
                        kind: "ROLE_CAPABILITY_GRANT", id: `${roleKey}:${capabilityKey}`, roleKey, capabilityKey,
                        objectKey: explainedAction?.objectKey ?? workflow.objectKey ?? null,
                        conditioned: capabilityGrants.some((g) => g.roleKey === roleKey && g.condition !== null)
                    }))
                    : []),
            ];
            const entry = Object.freeze({
                workflowId: workflow.id, workflowKey: workflow.key, workflowName: workflow.name, objectKey: workflow.objectKey,
                versionId: version.id, version: version.version,
                actionKey: action.key, actionLabel: action.label, from: action.fromStepKey, to: action.toStepKey,
                capabilityKey, guardKind: action.guardKind ?? (action.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
                viaRoles: Object.freeze(viaRoles),
                requiredFunctionalRoles: Object.freeze(requiredFunctionalRoles),
                viaFunctionalRoles: Object.freeze(viaFunctionalRoles),
                authority,
                reasonCode,
                source,
                securityRoleSources: Object.freeze(securityRoleSources),
                functionalRoleSources: Object.freeze(functionalRoleSources),
                capabilityGrants: Object.freeze(capabilityGrants),
                grantConditions: Object.freeze(grantConditions),
                adminLocations: Object.freeze(adminLocations),
            });
            if (allowing(authority))
                responsibilities.push(entry);
            else
                boundWithoutAuthority.push(entry);
        }
    }
    return Object.freeze({
        principalId,
        securityRoleKeys: Object.freeze([...explained.securityRoleKeys]),
        responsibilities: Object.freeze(responsibilities),
        boundWithoutAuthority: Object.freeze(boundWithoutAuthority),
    });
}
/** Every workflow's ACTIVE version, loaded once. A workflow with no active version runs nothing. */
async function loadActiveWorkflowDefinitions(reader, tenantId) {
    const [roles, functionalRoles] = await Promise.all([reader.listRoles(tenantId), reader.listFunctionalRoles(tenantId)]);
    const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
    const functionalRoleKeyById = new Map(functionalRoles.map((f) => [f.id, f.key]));
    const out = [];
    for (const workflow of await reader.listWorkflows(tenantId)) {
        if (!workflow.activeVersionId)
            continue;
        const version = (await reader.listWorkflowVersions(tenantId, workflow.id)).find((v) => v.id === workflow.activeVersionId);
        if (!version || version.status !== "PUBLISHED")
            continue;
        out.push({ workflow, version, definition: await (0, workflowEngine_1.loadWorkflowVersionDefinition)(reader, tenantId, version.id), roleKeyById, functionalRoleKeyById });
    }
    return out;
}
//# sourceMappingURL=workflowResponsibilities.js.map
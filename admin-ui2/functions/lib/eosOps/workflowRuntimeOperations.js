"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWorkflowRuntimeOperation = exports.EOS_WORKFLOW_RUNTIME_OPERATIONS = exports.WorkflowRuntimeError = exports.WORKFLOW_RUNTIME_ROUTE = void 0;
exports.listWorkflowWork = listWorkflowWork;
exports.transitionWorkflowInstance = transitionWorkflowInstance;
const postgresPolicyRepository_1 = require("../adminPolicy/postgresPolicyRepository");
const workflowEngine_1 = require("../adminPolicy/workflowEngine");
const workflowInstances_1 = require("../adminPolicy/workflowInstances");
const workflowAdministration_1 = require("../adminPolicy/workflowAdministration");
const workflowAuthority_1 = require("../adminPolicy/workflowAuthority");
const capabilityAuthority_1 = require("./capabilityAuthority");
const entitledActionAuthority_1 = require("./entitledActionAuthority");
const contextualAuthorization_1 = require("./contextualAuthorization");
const functionalRoleFacts_1 = require("./functionalRoleFacts");
exports.WORKFLOW_RUNTIME_ROUTE = "/operations/workflow";
const WORK_LIMIT = 200;
class WorkflowRuntimeError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "WorkflowRuntimeError";
    }
}
exports.WorkflowRuntimeError = WorkflowRuntimeError;
const accept = (input, allowed) => {
    const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
    if (extra.length)
        throw new WorkflowRuntimeError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
};
const text = (v, field) => {
    if (typeof v !== "string" || v.trim().length === 0 || v.length > 200)
        throw new WorkflowRuntimeError("INPUT_INVALID", "INVALID_INPUT", `${field} is required`);
    return v.trim();
};
/** The caller's runtime facts for the engine, resolved by the SAME resolver as every request -- never from the body. */
async function runtimeFor(deps, caller) {
    if (!deps.policyReader)
        throw new WorkflowRuntimeError("RUNTIME_UNAVAILABLE", "FORBIDDEN", "the governed resolver is not composed on this server");
    const { tenantId, principalId } = caller.actor;
    const ctx = await (0, capabilityAuthority_1.resolveOperationalContextForPrincipal)(deps.policyReader, deps.pool, principalId, tenantId, (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool));
    const repo = new postgresPolicyRepository_1.PostgresPolicyRepository(deps.pool);
    const roles = await repo.listRoles(tenantId);
    const held = new Set(ctx.principalContext.heldRoleKeys);
    return {
        repo, ctx,
        actor: { tenantId, principalId, heldRoleKeys: ctx.principalContext.heldRoleKeys,
            scopedRoles: ctx.scopedHeld.map((h) => ({ roleKey: h.sourceRole, scopeType: h.scopeType, scopeValue: h.scopeValue })) },
        roleIds: roles.filter((r) => held.has(r.key)).map((r) => r.id),
        operational: { tenantId, principalId, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
            scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements },
        facts: (0, functionalRoleFacts_1.postgresWorkflowFunctionalRoleFacts)(deps.pool, tenantId, principalId),
    };
}
async function listWorkflowWork(deps, caller, input) {
    accept(input, ["objectKey"]);
    const objectKey = input.objectKey === undefined ? null : text(input.objectKey, "objectKey");
    const rt = await runtimeFor(deps, caller);
    const reader = (0, contextualAuthorization_1.postgresContextualReader)(deps.pool);
    const workflows = (await rt.repo.listWorkflows(caller.actor.tenantId))
        .filter((w) => w.activeVersionId && (!objectKey || w.objectKey === objectKey));
    const items = [];
    let total = 0;
    for (const w of workflows) {
        const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(rt.repo, caller.actor.tenantId, w.activeVersionId);
        const instances = await rt.repo.listWorkflowInstances(caller.actor.tenantId, w.activeVersionId);
        const authority = (0, workflowAuthority_1.operationalWorkflowAuthority)(reader, rt.operational, w.objectKey);
        for (const instance of instances) {
            const step = definition.steps.find((s) => s.key === instance.currentStepKey);
            if (step?.terminal)
                continue;
            total += 1;
            if (items.length >= WORK_LIMIT)
                continue;
            const actions = [];
            for (const a of definition.actions.filter((x) => x.fromStepKey === instance.currentStepKey)) {
                const d = await (0, workflowEngine_1.authorizeWorkflowAction)(definition, instance, a.key, {
                    tenantId: caller.actor.tenantId, principalId: caller.actor.principalId, roleIds: rt.roleIds, recordId: instance.recordId,
                    authority, functionalRoles: rt.facts,
                });
                actions.push({ actionKey: a.key, label: a.label ?? a.key, toStepKey: a.toStepKey, capabilityKey: a.capabilityKey ?? null,
                    allowed: d.allowed, refusal: d.allowed ? null : `${d.refusal}${d.outcome ? ` (${d.outcome})` : ""}` });
            }
            items.push({ workflowKey: w.key, workflowName: w.name, objectKey: instance.objectKey, recordId: instance.recordId,
                currentStepKey: instance.currentStepKey, currentStepLabel: step?.label ?? instance.currentStepKey, actions });
        }
    }
    return Object.freeze({ items, total, truncated: total > items.length });
}
async function transitionWorkflowInstance(deps, caller, input) {
    accept(input, ["objectKey", "recordId", "actionKey", "reason"]);
    const objectKey = text(input.objectKey, "objectKey");
    const recordId = text(input.recordId, "recordId");
    const actionKey = text(input.actionKey, "actionKey");
    const reason = input.reason === undefined || input.reason === null ? null : text(input.reason, "reason");
    const rt = await runtimeFor(deps, caller);
    const workflow = (await rt.repo.listWorkflows(caller.actor.tenantId)).find((w) => w.objectKey === objectKey);
    const authority = (0, workflowAuthority_1.operationalWorkflowAuthority)((0, contextualAuthorization_1.postgresContextualReader)(deps.pool), rt.operational, workflow?.objectKey ?? objectKey);
    try {
        const out = await (0, workflowInstances_1.transitionWorkflowInstance)(rt.repo, rt.actor, { objectKey, recordId, actionKey, reason }, authority, rt.facts);
        return Object.freeze({ objectKey, recordId, actionKey, currentStepKey: out.instance.currentStepKey });
    }
    catch (err) {
        if (err instanceof workflowAdministration_1.WorkflowRefusal) {
            const category = err.category === "NOT_FOUND" ? "NOT_FOUND" : err.category === "CONFLICT" ? "CONFLICT" : "FORBIDDEN";
            throw new WorkflowRuntimeError(err.code, category, err.message);
        }
        throw err;
    }
}
exports.EOS_WORKFLOW_RUNTIME_OPERATIONS = Object.freeze({ listWorkflowWork, transitionWorkflowInstance });
const isWorkflowRuntimeOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(exports.EOS_WORKFLOW_RUNTIME_OPERATIONS, name);
exports.isWorkflowRuntimeOperation = isWorkflowRuntimeOperation;
//# sourceMappingURL=workflowRuntimeOperations.js.map
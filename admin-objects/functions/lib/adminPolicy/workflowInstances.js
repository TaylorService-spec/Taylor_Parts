"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_INSTANCE_BATCH_LIMIT = void 0;
exports.startWorkflowInstance = startWorkflowInstance;
exports.transitionWorkflowInstance = transitionWorkflowInstance;
exports.adoptRecordsIntoWorkflowVersion = adoptRecordsIntoWorkflowVersion;
exports.migrateWorkflowInstances = migrateWorkflowInstances;
// Workflow INSTANCES -- in-flight pinning, runtime transitions, ADOPT and MIGRATE.
//
// ════════════════════ PINNING ════════════════════
//
// An instance is created on the workflow's ACTIVE version and stays on THAT version: every
// transition is evaluated against the version the instance pins, never the active one. Publishing
// or activating a newer version changes where NEW instances start and nothing else. The only way an
// instance changes version is an explicit, audited MIGRATE with a complete step map.
//
// ════════════════════ WHAT IS NOT WIRED HERE ════════════════════
//
// No domain command calls these yet. The record's own status column stays the business authority
// until a domain lifecycle is separately switched to read its pinned version (pass7 §H: keep status,
// drop the instance step, in the same transaction). startWorkflowInstance is the seam a domain
// create will call; transitionWorkflowInstance is the seam a domain transition will call, with the
// transport's resolved OperationalActor behind `authority`.
//
// ════════════════════ ADOPT AND MIGRATE ════════════════════
//
//   ADOPT    attach EXISTING records (created before the workflow was live, or copied in) to a
//            PUBLISHED version at the step their record status already names. Explicit, audited,
//            never an implicit backfill.
//   MIGRATE  move instances from one version of a workflow to another with a step map covering
//            every step those instances occupy.
//
// Both are administrative acts: capability-gated (workflowDefinition.publish), ONE policy audit
// event per operation, and one instance event per record naming that audit event -- the database
// refuses an ADOPT or MIGRATE instance event that names none.
const policyCommands_1 = require("./policyCommands");
const workflowAdministration_1 = require("./workflowAdministration");
const workflowEngine_1 = require("./workflowEngine");
const assignmentScopeRuntime_1 = require("./assignmentScopeRuntime");
/** Records per ADOPT/MIGRATE call -- an administrative batch, not a bulk load. */
exports.WORKFLOW_INSTANCE_BATCH_LIMIT = 500;
const nonEmpty = (v, what) => {
    if (typeof v !== "string" || v.trim().length === 0)
        throw new policyCommands_1.PolicyValidationError(`${what} is required`);
    return v.trim();
};
async function findWorkflowByKey(reader, tenantId, workflowKey) {
    const workflow = (await reader.listWorkflows(tenantId)).find((w) => w.key === workflowKey);
    if (!workflow)
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", `no workflow "${workflowKey}"`);
    return workflow;
}
/**
 * Create the instance for one record, PINNED to the workflow's ACTIVE version, at its initial step.
 * Refuses a workflow with no active version, and a record that already has an instance.
 */
async function startWorkflowInstance(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "startWorkflowInstance");
    const workflow = await findWorkflowByKey(repo, actor.tenantId, nonEmpty(input.workflowKey, "workflowKey"));
    const recordId = nonEmpty(input.recordId, "recordId");
    const reason = (0, workflowAdministration_1.requireWorkflowReason)(input.reason);
    if (!workflow.objectKey)
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VERSION_MISMATCH", "CONFLICT", "the workflow governs no Object");
    if (!workflow.activeVersionId) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_NO_ACTIVE_VERSION", "CONFLICT", `workflow "${workflow.key}" has no ACTIVE version`);
    }
    if (await repo.getWorkflowInstance(actor.tenantId, workflow.objectKey, recordId)) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_INSTANCE_EXISTS", "CONFLICT", `record "${recordId}" already has a workflow instance`);
    }
    const { version } = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, workflow.activeVersionId);
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, version.id);
    const initial = definition.steps.find((s) => s.initial);
    if (!initial)
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VALIDATION_FAILED", "CONFLICT", "the active version has no initial step");
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const instance = await tx.createWorkflowInstance({
            workflowVersionId: version.id, objectKey: workflow.objectKey, recordId, currentStepKey: initial.key,
        });
        const auditEventId = await tx.appendAudit({
            action: "startWorkflowInstance",
            actorUid: actor.uid,
            targetKind: "workflowInstance",
            targetId: instance.id,
            occurredAt: new Date().toISOString(),
            reason,
            before: null,
            after: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, version), instanceId: instance.id, recordId, stepKey: initial.key },
        });
        await tx.appendWorkflowInstanceEvent({
            instanceId: instance.id, actionKey: "instance.start", fromStepKey: initial.key, toStepKey: initial.key,
            actorUid: actor.uid, actorPrincipalId: actor.uid, occurredAt: new Date().toISOString(), reason,
            eventKind: "START", fromVersionId: null, toVersionId: version.id, auditEventId,
        });
        return instance;
    });
}
/**
 * Perform one action on one record's instance: WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY, decided
 * against the instance's PINNED version. Not an Administration operation -- this is the runtime
 * seam; `authority` is the transport-composed evaluator (workflowAuthority.ts).
 */
async function transitionWorkflowInstance(repo, actor, input, authority, 
/**
 * The acting Principal's Functional Role facts (eosOps/functionalRoleFacts.postgresWorkflowFunctionalRoleFacts),
 * composed by the transport. Consulted only for an action with a FUNCTIONAL_ROLE binding, which is REFUSED when
 * this is absent -- never decided without it.
 */
functionalRoles, 
/** The record's business context, resolved server-side by the transport from the governed record. */
businessContext) {
    const objectKey = nonEmpty(input.objectKey, "objectKey");
    const recordId = nonEmpty(input.recordId, "recordId");
    const actionKey = nonEmpty(input.actionKey, "actionKey");
    const instance = await repo.getWorkflowInstance(actor.tenantId, objectKey, recordId);
    if (!instance)
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", "this record has no workflow instance");
    // THE PINNED VERSION, never the active one.
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, instance.workflowVersionId);
    const roles = await repo.listRoles(actor.tenantId);
    const actionCapability = definition.actions.find((a) => a.key === actionKey)?.capabilityKey ?? "";
    const admittedScoped = (actor.scopedRoles ?? [])
        .filter((s) => (0, assignmentScopeRuntime_1.holdingAdmits)({ scopeType: s.scopeType, scopeValue: s.scopeValue, capabilityKey: actionCapability }, businessContext) === "ADMITTED")
        .map((s) => s.roleKey);
    const held = new Set([...(actor.heldRoleKeys ?? []), ...admittedScoped]);
    const roleIds = roles.filter((r) => held.has(r.key)).map((r) => r.id);
    const decision = await (0, workflowEngine_1.authorizeWorkflowAction)(definition, instance, actionKey, {
        tenantId: actor.tenantId, principalId: actor.principalId, roleIds, recordId, authority, functionalRoles, businessContext,
    });
    if (!decision.allowed) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_ACTION_REFUSED", decision.refusal === "invalidFromState" || decision.refusal === "terminalState" ? "CONFLICT" : "FORBIDDEN", `${actionKey} refused: ${decision.refusal}${decision.outcome ? ` (${decision.outcome})` : ""}`);
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.principalId }, async (tx) => {
        const advanced = await tx.advanceWorkflowInstance(instance.id, decision.toStepKey);
        await tx.appendWorkflowInstanceEvent({
            instanceId: instance.id, actionKey, fromStepKey: instance.currentStepKey, toStepKey: decision.toStepKey,
            actorUid: actor.principalId, actorPrincipalId: actor.principalId, occurredAt: new Date().toISOString(),
            reason: input.reason ?? null, eventKind: "TRANSITION",
            fromVersionId: instance.workflowVersionId, toVersionId: instance.workflowVersionId, auditEventId: null,
        });
        return { instance: advanced, decision };
    });
}
/** Attach existing records to a PUBLISHED version, each at the step its record status names. */
async function adoptRecordsIntoWorkflowVersion(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "adoptRecordsIntoWorkflowVersion");
    const versionId = nonEmpty(input.versionId, "versionId");
    const reason = (0, workflowAdministration_1.requireWorkflowReason)(input.reason);
    const records = Array.isArray(input.records) ? input.records : [];
    if (records.length === 0)
        throw new policyCommands_1.PolicyValidationError("records must name at least one record");
    if (records.length > exports.WORKFLOW_INSTANCE_BATCH_LIMIT) {
        throw new policyCommands_1.PolicyValidationError(`at most ${exports.WORKFLOW_INSTANCE_BATCH_LIMIT} records per adoption`);
    }
    const { workflow, version } = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, versionId);
    if (version.status !== "PUBLISHED") {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_INVALID_LIFECYCLE", "CONFLICT", `records can only be adopted into a PUBLISHED version (version ${version.version} is ${version.status})`);
    }
    if (!workflow.objectKey)
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VERSION_MISMATCH", "CONFLICT", "the workflow governs no Object");
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    const stepKeys = new Set(definition.steps.map((s) => s.key));
    const seen = new Set();
    const normalized = records.map((r) => {
        const recordId = nonEmpty(r?.recordId, "recordId");
        const stepKey = nonEmpty(r?.stepKey, `stepKey for "${recordId}"`);
        if (seen.has(recordId))
            throw new policyCommands_1.PolicyValidationError(`record "${recordId}" is listed twice`);
        seen.add(recordId);
        if (!stepKeys.has(stepKey)) {
            throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_STEP_MAP_INVALID", "INVALID_INPUT", `record "${recordId}": step "${stepKey}" does not exist in version ${version.version}`);
        }
        return { recordId, stepKey };
    });
    for (const r of normalized) {
        if (await repo.getWorkflowInstance(actor.tenantId, workflow.objectKey, r.recordId)) {
            throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_INSTANCE_EXISTS", "CONFLICT", `record "${r.recordId}" already has a workflow instance`);
        }
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const auditEventId = await tx.appendAudit({
            action: "adoptRecordsIntoWorkflowVersion",
            actorUid: actor.uid,
            targetKind: "workflowVersion",
            targetId: versionId,
            occurredAt: new Date().toISOString(),
            reason,
            before: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, version), records: normalized.map((r) => ({ recordId: r.recordId, instance: null })) },
            after: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, version), records: normalized },
        });
        const instances = [];
        for (const r of normalized) {
            const instance = await tx.createWorkflowInstance({
                workflowVersionId: versionId, objectKey: workflow.objectKey, recordId: r.recordId, currentStepKey: r.stepKey,
            });
            await tx.appendWorkflowInstanceEvent({
                instanceId: instance.id, actionKey: "instance.adopt", fromStepKey: r.stepKey, toStepKey: r.stepKey,
                actorUid: actor.uid, actorPrincipalId: actor.uid, occurredAt: new Date().toISOString(), reason,
                eventKind: "ADOPT", fromVersionId: null, toVersionId: versionId, auditEventId,
            });
            instances.push(instance);
        }
        return { versionId, auditEventId, instances };
    });
}
/** Move instances between two versions of ONE workflow, with a complete, valid step map. */
async function migrateWorkflowInstances(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "migrateWorkflowInstances");
    const fromVersionId = nonEmpty(input.fromVersionId, "fromVersionId");
    const toVersionId = nonEmpty(input.toVersionId, "toVersionId");
    const reason = (0, workflowAdministration_1.requireWorkflowReason)(input.reason);
    if (fromVersionId === toVersionId)
        throw new policyCommands_1.PolicyValidationError("fromVersionId and toVersionId must differ");
    const stepMap = input.stepMap && typeof input.stepMap === "object" && !Array.isArray(input.stepMap) ? input.stepMap : null;
    if (!stepMap)
        throw new policyCommands_1.PolicyValidationError("stepMap is required");
    const from = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, fromVersionId);
    const to = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, toVersionId);
    if (from.workflow.id !== to.workflow.id) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VERSION_MISMATCH", "INVALID_INPUT", "both versions must belong to the same workflow");
    }
    if (to.version.status !== "PUBLISHED") {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_INVALID_LIFECYCLE", "CONFLICT", `instances can only move to a PUBLISHED version (version ${to.version.version} is ${to.version.status})`);
    }
    const target = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, toVersionId);
    const targetSteps = new Set(target.steps.map((s) => s.key));
    for (const [fromStep, toStep] of Object.entries(stepMap)) {
        if (typeof toStep !== "string" || !targetSteps.has(toStep)) {
            throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_STEP_MAP_INVALID", "INVALID_INPUT", `step "${fromStep}" maps to "${String(toStep)}", which does not exist in version ${to.version.version}`);
        }
    }
    let instances = await repo.listWorkflowInstances(actor.tenantId, fromVersionId);
    if (Array.isArray(input.instanceIds)) {
        const wanted = new Set(input.instanceIds);
        for (const id of wanted) {
            if (!instances.some((i) => i.id === id)) {
                throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_NOT_FOUND", "NOT_FOUND", `instance "${id}" is not pinned to the source version`);
            }
        }
        instances = instances.filter((i) => wanted.has(i.id));
    }
    if (instances.length > exports.WORKFLOW_INSTANCE_BATCH_LIMIT) {
        throw new policyCommands_1.PolicyValidationError(`at most ${exports.WORKFLOW_INSTANCE_BATCH_LIMIT} instances per migration; name them with instanceIds`);
    }
    const unmapped = [...new Set(instances.map((i) => i.currentStepKey).filter((k) => !(k in stepMap)))];
    if (unmapped.length > 0) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_STEP_MAP_INCOMPLETE", "INVALID_INPUT", `the step map does not cover step(s) ${unmapped.join(", ")} occupied by moving instances`);
    }
    // Nothing to move writes nothing -- and no audit event.
    if (instances.length === 0)
        return { fromVersionId, toVersionId, auditEventId: null, migrated: [] };
    const migrated = instances.map((i) => ({
        instanceId: i.id, recordId: i.recordId, fromStepKey: i.currentStepKey, toStepKey: stepMap[i.currentStepKey],
    }));
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const auditEventId = await tx.appendAudit({
            action: "migrateWorkflowInstances",
            actorUid: actor.uid,
            targetKind: "workflowVersion",
            targetId: toVersionId,
            occurredAt: new Date().toISOString(),
            reason,
            before: { ...(0, workflowAdministration_1.workflowAuditIdentity)(from.workflow, from.version), instances: migrated.map((m) => ({ instanceId: m.instanceId, recordId: m.recordId, stepKey: m.fromStepKey })) },
            after: { ...(0, workflowAdministration_1.workflowAuditIdentity)(to.workflow, to.version), stepMap, instances: migrated.map((m) => ({ instanceId: m.instanceId, recordId: m.recordId, stepKey: m.toStepKey })) },
        });
        for (const m of migrated) {
            await tx.repinWorkflowInstance(m.instanceId, toVersionId, m.toStepKey);
            await tx.appendWorkflowInstanceEvent({
                instanceId: m.instanceId, actionKey: "version.migrate", fromStepKey: m.fromStepKey, toStepKey: m.toStepKey,
                actorUid: actor.uid, actorPrincipalId: actor.uid, occurredAt: new Date().toISOString(), reason,
                eventKind: "MIGRATE", fromVersionId, toVersionId, auditEventId,
            });
        }
        return { fromVersionId, toVersionId, auditEventId, migrated };
    });
}
//# sourceMappingURL=workflowInstances.js.map
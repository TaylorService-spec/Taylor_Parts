"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStoredWorkflowVersion = validateStoredWorkflowVersion;
exports.publishWorkflowVersion = publishWorkflowVersion;
exports.activateWorkflowVersion = activateWorkflowVersion;
exports.retireWorkflowVersion = retireWorkflowVersion;
// A workflow version's LIFECYCLE: DRAFT -> PUBLISHED (ACTIVE) -> RETIRED.
//
//   publish     DRAFT -> PUBLISHED, only when validation finds no ERROR (fail closed), and the
//               workflow's active pointer moves to it in the SAME transaction. The previously
//               active version stays PUBLISHED: instances pinned to it keep running on it.
//   activate    point the workflow at another PUBLISHED version (a rollback). New instances start
//               there; existing instances are untouched.
//   retire      DRAFT|PUBLISHED -> RETIRED. REFUSED while the version is active or any instance
//               still pins it -- move them first with migrateWorkflowInstances.
//
// Each is ONE transaction with ONE audit event (actor, tenant, workflow, version, previous/new,
// reason). The store and the database triggers (migration 1762732800000) refuse the same illegal
// moves independently, so a writer that skipped this layer still cannot make them.
const workflowEngine_1 = require("./workflowEngine");
const workflowAdministration_1 = require("./workflowAdministration");
const workflowValidation_1 = require("./workflowValidation");
const policyCommands_1 = require("./policyCommands");
const audit = (actor, action, targetId, reason) => ({
    action,
    actorUid: actor.uid,
    targetKind: "workflowVersion",
    targetId,
    occurredAt: new Date().toISOString(),
    reason,
});
/** Validate one stored version against the tenant's current Objects, catalog, Roles and grants. */
async function validateStoredWorkflowVersion(reader, actor, versionId) {
    const { workflow, version } = await (0, workflowAdministration_1.findWorkflowVersion)(reader, actor, versionId);
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(reader, actor.tenantId, versionId);
    const [view, context] = await Promise.all([
        (0, workflowValidation_1.storedDefinitionView)(reader, actor.tenantId, workflow.objectKey, definition),
        (0, workflowValidation_1.loadWorkflowValidationContext)(reader, actor.tenantId),
    ]);
    return { ...(0, workflowValidation_1.validateWorkflowDefinition)(view, context), workflow, version };
}
/**
 * Publish a DRAFT and make it the ACTIVE version.
 *
 * FAIL CLOSED: any validation ERROR refuses with WORKFLOW_VALIDATION_FAILED and every finding in
 * `issues` -- including BINDING_WITHOUT_CAPABILITY, which is how a stale binding (a Role bound to
 * an action whose capability it does not hold) is stopped before it could ever look like authority.
 */
async function publishWorkflowVersion(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "publishWorkflowVersion");
    const versionId = requireId(input.versionId, "versionId");
    const result = await validateStoredWorkflowVersion(repo, actor, versionId);
    const { workflow, version } = result;
    if (version.status !== "DRAFT") {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_INVALID_LIFECYCLE", "CONFLICT", `workflow version ${version.version} is ${version.status}; only a DRAFT can be published -- create a new version`);
    }
    if (!result.valid) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VALIDATION_FAILED", "INVALID_INPUT", `workflow version cannot be published: ${result.errors.map((e) => `${e.code} ${e.message}`).join("; ")}`, result.errors);
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Under the tenant governance lock, RE-VALIDATE: a Role grant revoked between the first check and
        // this transaction would otherwise let a binding the runtime now refuses be published.
        await tx.beginAdministrationCommand();
        const locked = await validateStoredWorkflowVersion(repo, actor, versionId);
        if (locked.version.status !== "DRAFT" || !locked.valid) {
            throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VALIDATION_FAILED", "INVALID_INPUT", `workflow version cannot be published: ${locked.errors.map((e) => `${e.code} ${e.message}`).join("; ") || `it is ${locked.version.status}`}`, locked.errors);
        }
        const published = await tx.publishWorkflowVersion(versionId);
        const activated = await tx.setWorkflowActiveVersion(workflow.id, published.id);
        await tx.appendAudit({
            ...audit(actor, "publishWorkflowVersion", versionId, input.reason ?? null),
            before: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, version), activeVersionId: workflow.activeVersionId ?? null },
            after: {
                ...(0, workflowAdministration_1.workflowAuditIdentity)(activated, published),
                activeVersionId: activated.activeVersionId ?? null,
                publishedAt: published.publishedAt,
                publishedBy: published.publishedBy,
                warnings: result.warnings.map((w) => w.code),
            },
        });
        return published;
    });
}
/** Point the workflow at another PUBLISHED version. Existing instances are untouched. */
async function activateWorkflowVersion(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "activateWorkflowVersion");
    const versionId = requireId(input.versionId, "versionId");
    const reason = (0, workflowAdministration_1.requireWorkflowReason)(input.reason);
    const { workflow, version } = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, versionId);
    if (version.status !== "PUBLISHED") {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_INVALID_LIFECYCLE", "CONFLICT", `workflow version ${version.version} is ${version.status}; only a PUBLISHED version can be active`);
    }
    // A no-op writes nothing -- and no audit event.
    if (workflow.activeVersionId === versionId)
        return workflow;
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        await tx.beginAdministrationCommand();
        const current = (await repo.listWorkflows(actor.tenantId)).find((w) => w.id === workflow.id);
        if (current?.activeVersionId === versionId)
            return current; // a concurrent identical request won
        const updated = await tx.setWorkflowActiveVersion(workflow.id, versionId);
        await tx.appendAudit({
            ...audit(actor, "activateWorkflowVersion", versionId, reason),
            before: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, version), activeVersionId: workflow.activeVersionId ?? null },
            after: { ...(0, workflowAdministration_1.workflowAuditIdentity)(updated, version), activeVersionId: updated.activeVersionId ?? null },
        });
        return updated;
    });
}
/** Retire a version nothing runs on. Refused while it is active or pinned by an instance. */
async function retireWorkflowVersion(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "retireWorkflowVersion");
    const versionId = requireId(input.versionId, "versionId");
    const reason = (0, workflowAdministration_1.requireWorkflowReason)(input.reason);
    const { workflow, version } = await (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, versionId);
    if (version.status === "RETIRED")
        return version;
    if (workflow.activeVersionId === versionId) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VERSION_ACTIVE", "CONFLICT", `workflow version ${version.version} is the ACTIVE version; activate another version before retiring it`);
    }
    const pinned = await repo.listWorkflowInstances(actor.tenantId, versionId);
    if (pinned.length > 0) {
        throw new workflowAdministration_1.WorkflowRefusal("WORKFLOW_VERSION_PINNED", "CONFLICT", `${pinned.length} live instance(s) are pinned to workflow version ${version.version}; migrate them first`);
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // The active and pinned checks are ALSO the store's and the database trigger's, inside this transaction.
        await tx.beginAdministrationCommand();
        const retired = await tx.retireWorkflowVersion(versionId);
        await tx.appendAudit({
            ...audit(actor, "retireWorkflowVersion", versionId, reason),
            before: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, version) },
            after: { ...(0, workflowAdministration_1.workflowAuditIdentity)(workflow, retired) },
        });
        return retired;
    });
}
function requireId(value, what) {
    if (typeof value !== "string" || value.trim().length === 0)
        throw new policyCommands_1.PolicyValidationError(`${what} is required`);
    return value.trim();
}
//# sourceMappingURL=workflowLifecycle.js.map
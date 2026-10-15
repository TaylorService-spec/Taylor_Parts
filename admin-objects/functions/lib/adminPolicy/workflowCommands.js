"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflowDraft = createWorkflowDraft;
exports.createWorkflowVersion = createWorkflowVersion;
exports.updateWorkflowDefinition = updateWorkflowDefinition;
exports.setWorkflowRoleBinding = setWorkflowRoleBinding;
exports.actionCapabilityKey = actionCapabilityKey;
exports.actionGuardKind = actionGuardKind;
// Editing a workflow DEFINITION — draft creation, revision, Role binding, publication.
//
// ════════════════════ WHY THESE ARE NOT IN policyCommands.ts ════════════════════
//
// policyCommands.ts owns DATA authority: Objects, Fields, Roles, CRED, assignment. These own
// WORKFLOW authority: which business actions exist and who may perform them. Owner ruling D-5 made
// that separation load-bearing rather than cosmetic — a workflow action is never a CRED checkbox
// and a CRED grant never buys a transition — and two files is the cheapest way to keep a later edit
// from quietly blurring it back together.
//
// ════════════════════ A DRAFT IS EDITABLE. A PUBLISHED VERSION IS NOT. ════════════════════
//
// Editing works by REPLACING a draft's definition, not by patching individual steps: a workflow is
// a graph, and a per-edge edit API makes it trivially easy to leave one that is unreachable,
// two-initial, or leaving a terminal state. The whole definition is validated as a unit and stored
// as a unit.
//
// A PUBLISHED version is refused by the store as well as here, so a writer that skipped this layer
// still cannot rewrite history under a running process.
//
// ════════════════════ EDITING IS NOT ROUTING ════════════════════
//
// Nothing in this file changes how a record moves. The Parts/Purchasing, Work Order and Sales
// machines that run today run from the code they always did; these definitions are DRAFTS measured
// from that code. Publishing one does not reroute execution either — that is a later, separately
// authorized step, and until it is taken a published version is a statement about intent rather
// than a live process.
const policyCommands_1 = require("./policyCommands");
const workflowAdministration_1 = require("./workflowAdministration");
const workflowValidation_1 = require("./workflowValidation");
const types_1 = require("./types");
const workflowEngine_1 = require("./workflowEngine");
const nonEmpty = (v, what) => {
    if (typeof v !== "string" || v.trim().length === 0)
        throw new policyCommands_1.PolicyValidationError(`${what} is required`);
    return v.trim();
};
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const validKey = (v, what) => {
    const s = nonEmpty(v, what);
    if (!KEY_PATTERN.test(s))
        throw new policyCommands_1.PolicyValidationError(`${what} must be a simple identifier`);
    return s;
};
const auditBase = (actor, action, targetId, reason) => ({
    action,
    actorUid: actor.uid,
    targetKind: "workflowVersion",
    targetId,
    occurredAt: new Date().toISOString(),
    reason,
});
/**
 * Create a NEW workflow and its first DRAFT version.
 *
 * Refuses a key the tenant already has: two workflows answering to one key is the ambiguity that
 * makes "which definition governs this record" unanswerable.
 */
async function createWorkflowDraft(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "createWorkflowDraft");
    const key = validKey(input.key, "workflow key");
    const name = nonEmpty(input.name, "name");
    const objectKey = nonEmpty(input.objectKey, "objectKey");
    const existing = (await repo.listWorkflows(actor.tenantId)).find((w) => w.key === key);
    if (existing)
        throw new policyCommands_1.PolicyValidationError(`workflow "${key}" already exists`);
    // The Object must exist. A workflow governing a record type the tenant does not have is a
    // definition nothing can ever run against.
    const object = await repo.getObjectByKey(actor.tenantId, objectKey);
    if (!object)
        throw new policyCommands_1.PolicyValidationError(`no object "${objectKey}"`);
    const definition = validateDefinitionShape(input.definition);
    const { roleIdByKey, functionalRoleIdByKey, missingRoleKeys, knownCapabilityKeys, unknownCapabilityKeys } = await resolveRoles(repo, actor, definition);
    const result = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const workflow = await tx.createWorkflow({
            key,
            name,
            description: input.description ?? null,
            objectKey,
            origin: "CUSTOM",
        });
        const version = await tx.createWorkflowVersion({
            workflowId: workflow.id,
            version: 1,
            status: "DRAFT",
            publishedAt: null,
            publishedBy: null,
        });
        const counts = await writeDefinition(tx, version.id, definition, roleIdByKey, knownCapabilityKeys, functionalRoleIdByKey);
        await tx.appendAudit({
            ...auditBase(actor, "createWorkflowDraft", version.id, input.reason ?? null),
            before: null,
            after: { workflowKey: key, version: 1, objectKey, ...counts, missingRoleKeys, unknownCapabilityKeys },
        });
        return { workflow, version, ...counts, missingRoleKeys, unknownCapabilityKeys };
    });
    await requireRunnable(repo, actor, result.version.id, "draft");
    return result;
}
/**
 * Add a new DRAFT version to an existing workflow.
 *
 * A published version is never edited; this is how it changes. The new version's number is one past
 * the highest that exists, so version numbers are dense and monotonic even after a retirement.
 */
async function createWorkflowVersion(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "createWorkflowVersion");
    const workflowId = nonEmpty(input.workflowId, "workflowId");
    const workflow = (await repo.listWorkflows(actor.tenantId)).find((w) => w.id === workflowId);
    if (!workflow)
        throw new policyCommands_1.PolicyValidationError("workflow not found");
    const versions = await repo.listWorkflowVersions(actor.tenantId, workflowId);
    const nextVersion = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
    let definition;
    if (input.definition) {
        definition = validateDefinitionShape(input.definition);
    }
    else {
        const sourceId = nonEmpty(input.copyFromVersionId ?? "", "copyFromVersionId or definition");
        definition = await readDefinition(repo, actor, sourceId);
    }
    const { roleIdByKey, functionalRoleIdByKey, missingRoleKeys, knownCapabilityKeys, unknownCapabilityKeys } = await resolveRoles(repo, actor, definition);
    const result = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const version = await tx.createWorkflowVersion({
            workflowId,
            version: nextVersion,
            status: "DRAFT",
            publishedAt: null,
            publishedBy: null,
        });
        const counts = await writeDefinition(tx, version.id, definition, roleIdByKey, knownCapabilityKeys, functionalRoleIdByKey);
        await tx.appendAudit({
            ...auditBase(actor, "createWorkflowVersion", version.id, input.reason ?? null),
            before: null,
            after: { workflowKey: workflow.key, version: nextVersion, ...counts, missingRoleKeys, unknownCapabilityKeys },
        });
        return { workflow, version, ...counts, missingRoleKeys, unknownCapabilityKeys };
    });
    await requireRunnable(repo, actor, result.version.id, "draft");
    return result;
}
/**
 * Replace a DRAFT version's definition.
 *
 * WHOLE-DEFINITION, not per-edge. A graph edited one edge at a time passes through states nobody
 * validated, and the tempting fix -- validating after every edge -- makes ordinary edits impossible
 * because an intermediate state is legitimately invalid. So the caller sends the definition it
 * wants, and it is validated once, as a whole.
 *
 * The store refuses this on a PUBLISHED version independently of the check here.
 */
async function updateWorkflowDefinition(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "updateWorkflowDefinition");
    const versionId = nonEmpty(input.versionId, "versionId");
    const definition = validateDefinitionShape(input.definition);
    const found = await findVersion(repo, actor, versionId);
    if (found.version.status !== "DRAFT") {
        throw new policyCommands_1.PolicyValidationError(`workflow version ${found.version.version} is ${found.version.status} and cannot be edited -- create a new version`);
    }
    const workflow = found.workflow;
    const before = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    const { roleIdByKey, functionalRoleIdByKey, missingRoleKeys, knownCapabilityKeys, unknownCapabilityKeys } = await resolveRoles(repo, actor, definition);
    // A new version rather than a destructive rewrite of the same rows: the store has no delete for
    // steps or actions, deliberately, so "replace the definition" is expressed as the next draft and
    // the superseded one stays readable. An administrator who wants the old shape back has it.
    const result = await repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const versions = await repo.listWorkflowVersions(actor.tenantId, workflow.id);
        const nextVersion = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
        const version = await tx.createWorkflowVersion({
            workflowId: workflow.id,
            version: nextVersion,
            status: "DRAFT",
            publishedAt: null,
            publishedBy: null,
        });
        const counts = await writeDefinition(tx, version.id, definition, roleIdByKey, knownCapabilityKeys, functionalRoleIdByKey);
        await tx.appendAudit({
            ...auditBase(actor, "updateWorkflowDefinition", version.id, input.reason ?? null),
            before: {
                supersededVersionId: versionId,
                steps: before.steps.map((s) => s.key),
                actions: before.actions.map((a) => a.key),
            },
            after: { workflowKey: workflow.key, version: nextVersion, ...counts, missingRoleKeys, unknownCapabilityKeys },
        });
        return { workflow, version, ...counts, missingRoleKeys, unknownCapabilityKeys };
    });
    await requireRunnable(repo, actor, result.version.id, "draft");
    return result;
}
/**
 * Bind one Role to one action on a DRAFT version.
 *
 * THIS IS WORKFLOW AUTHORITY, NOT DATA AUTHORITY (D-5). Binding a Role here lets it perform the
 * action; it grants no read of the record's fields, and no CRED grant anywhere buys the action.
 */
async function setWorkflowRoleBinding(repo, actor, input) {
    await (0, workflowAdministration_1.requireWorkflowAdministrationCapability)(repo, actor, "setWorkflowRoleBinding");
    const versionId = nonEmpty(input.versionId, "versionId");
    const actionKey = nonEmpty(input.actionKey, "actionKey");
    const roleId = nonEmpty(input.roleId, "roleId");
    const found = await findVersion(repo, actor, versionId);
    if (found.version.status !== "DRAFT") {
        throw new policyCommands_1.PolicyValidationError("a published workflow version's bindings cannot be changed");
    }
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    if (!definition.actions.some((a) => a.key === actionKey)) {
        throw new policyCommands_1.PolicyValidationError(`no action "${actionKey}" on this version`);
    }
    const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
    if (!role)
        throw new policyCommands_1.PolicyValidationError("role not found");
    const already = definition.bindings.find((b) => b.actionKey === actionKey && b.roleId === roleId);
    if (already)
        return already;
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        // Pass 8 serialization: the tenant's governance lock, the same one every Administration grant,
        // revoke and assignment command takes -- so a workflow change and an authority change never interleave.
        await tx.beginAdministrationCommand();
        const binding = await tx.createWorkflowRoleBinding({ workflowVersionId: versionId, actionKey, roleId });
        await tx.appendAudit({
            ...auditBase(actor, "setWorkflowRoleBinding", versionId, input.reason ?? null),
            before: null,
            after: { actionKey, roleKey: role.key, roleId },
        });
        return binding;
    });
}
// ════════════════════ helpers ════════════════════
/** The version row behind a version id, with its workflow (shared, tenant-scoped). */
const findVersion = (repo, actor, versionId) => (0, workflowAdministration_1.findWorkflowVersion)(repo, actor, versionId);
function validateDefinitionShape(definition) {
    if (!definition || typeof definition !== "object")
        throw new policyCommands_1.PolicyValidationError("a definition is required");
    const steps = Array.isArray(definition.steps) ? definition.steps : null;
    const actions = Array.isArray(definition.actions) ? definition.actions : null;
    if (!steps || steps.length === 0)
        throw new policyCommands_1.PolicyValidationError("a definition needs at least one state");
    if (!actions)
        throw new policyCommands_1.PolicyValidationError("a definition needs an actions list, even an empty one");
    const stepKeys = new Set();
    for (const s of steps) {
        const key = validKey(s?.key, "step key");
        if (stepKeys.has(key))
            throw new policyCommands_1.PolicyValidationError(`duplicate state "${key}"`);
        stepKeys.add(key);
        nonEmpty(s?.label, `label for state "${key}"`);
    }
    const actionKeys = new Set();
    for (const a of actions) {
        const key = validKey(a?.key, "action key");
        if (actionKeys.has(key))
            throw new policyCommands_1.PolicyValidationError(`duplicate action "${key}"`);
        actionKeys.add(key);
        nonEmpty(a?.label, `label for action "${key}"`);
        nonEmpty(a?.from, `"from" for action "${key}"`);
        nonEmpty(a?.to, `"to" for action "${key}"`);
        if (a.guardKind !== undefined && a.guardKind !== null
            && !types_1.WORKFLOW_GUARD_KINDS.includes(a.guardKind)) {
            throw new policyCommands_1.PolicyValidationError(`INVALID_GUARD: action "${key}" declares guard "${String(a.guardKind)}"; the closed list is ${types_1.WORKFLOW_GUARD_KINDS.join(", ")}`);
        }
        if (a.guardKind === null && a.requiresOwnAssignment === true) {
            throw new policyCommands_1.PolicyValidationError(`INVALID_GUARD: action "${key}" requires own assignment but declares no guard`);
        }
        for (const roleKey of a.roleKeys ?? []) {
            if (typeof roleKey !== "string" || roleKey.trim().length === 0) {
                throw new policyCommands_1.PolicyValidationError(`action "${key}" names an empty Role key`);
            }
        }
        if (a.functionalRoleKeys !== undefined && a.functionalRoleKeys !== null && !Array.isArray(a.functionalRoleKeys)) {
            throw new policyCommands_1.PolicyValidationError(`action "${key}" functionalRoleKeys must be a list`);
        }
        for (const functionalRoleKey of a.functionalRoleKeys ?? []) {
            if (typeof functionalRoleKey !== "string" || functionalRoleKey.trim().length === 0) {
                throw new policyCommands_1.PolicyValidationError(`action "${key}" names an empty Functional Role key`);
            }
        }
    }
    return { steps, actions };
}
async function resolveRoles(repo, actor, definition) {
    const [roles, catalog, functionalRoles] = await Promise.all([
        repo.listRoles(actor.tenantId), repo.listCapabilities(), repo.listFunctionalRoles(actor.tenantId),
    ]);
    const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));
    const functionalRoleIdByKey = new Map(functionalRoles.map((f) => [f.key, f.id]));
    const missingFunctionalRoleKeys = [
        ...new Set(definition.actions.flatMap((a) => a.functionalRoleKeys ?? []).filter((k) => !functionalRoleIdByKey.has(k))),
    ];
    if (missingFunctionalRoleKeys.length > 0) {
        // FAIL CLOSED: dropping a narrowing binding would widen the action, so the save is refused instead.
        throw new policyCommands_1.PolicyValidationError(`UNKNOWN_FUNCTIONAL_ROLE: ${missingFunctionalRoleKeys.join(", ")} ${missingFunctionalRoleKeys.length === 1 ? "is" : "are"} not a Functional Role of this tenant`);
    }
    const missingRoleKeys = [
        ...new Set(definition.actions.flatMap((a) => a.roleKeys ?? []).filter((k) => !roleIdByKey.has(k))),
    ];
    const knownCapabilityKeys = new Set(catalog.filter((c) => !(0, workflowValidation_1.isSupersededCapabilityDescription)(c.description)).map((c) => c.key));
    const unknownCapabilityKeys = [
        ...new Set(definition.actions.map(actionCapabilityKey).filter((k) => k !== null && !knownCapabilityKeys.has(k))),
    ];
    return { roleIdByKey, functionalRoleIdByKey, missingRoleKeys, knownCapabilityKeys, unknownCapabilityKeys };
}
/** The capability an action input names, under either spelling. */
function actionCapabilityKey(a) {
    const key = a.capabilityKey ?? a.capabilityId ?? null;
    return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}
/** The guard an action input declares: `guardKind`, else the legacy own-assignment flag. */
function actionGuardKind(a) {
    if (a.guardKind !== undefined && a.guardKind !== null)
        return a.guardKind;
    return a.requiresOwnAssignment === true ? "RECORD_ASSIGNMENT" : null;
}
async function writeDefinition(tx, versionId, definition, roleIdByKey, knownCapabilityKeys, functionalRoleIdByKey = new Map()) {
    for (const s of definition.steps) {
        await tx.createWorkflowStep({
            workflowVersionId: versionId,
            key: s.key,
            label: s.label,
            initial: s.initial === true,
            terminal: s.terminal === true,
        });
    }
    let bindingCount = 0;
    let functionalBindingCount = 0;
    for (const a of definition.actions) {
        await tx.createWorkflowAction({
            workflowVersionId: versionId,
            key: a.key,
            label: a.label,
            fromStepKey: a.from,
            toStepKey: a.to,
            requiresOwnAssignment: actionGuardKind(a) === "RECORD_ASSIGNMENT",
            guardKind: actionGuardKind(a),
            // An unknown key is reported (unknownCapabilityKeys) and stored as none -- never invented.
            capabilityKey: knownCapabilityKeys.has(actionCapabilityKey(a) ?? "") ? actionCapabilityKey(a) : null,
        });
        for (const key of a.roleKeys ?? []) {
            const roleId = roleIdByKey.get(key);
            if (!roleId)
                continue; // reported as missing, never invented
            await tx.createWorkflowRoleBinding({ workflowVersionId: versionId, actionKey: a.key, roleId });
            bindingCount += 1;
        }
        for (const key of new Set(a.functionalRoleKeys ?? [])) {
            const functionalRoleId = functionalRoleIdByKey.get(key);
            // Unreachable after resolveRoles, which refuses an unknown key; never silently dropped.
            if (!functionalRoleId)
                throw new policyCommands_1.PolicyValidationError(`UNKNOWN_FUNCTIONAL_ROLE: ${key} is not a Functional Role of this tenant`);
            await tx.createWorkflowRoleBinding({
                workflowVersionId: versionId, actionKey: a.key, roleId: null, functionalRoleId, bindingKind: "FUNCTIONAL_ROLE",
            });
            functionalBindingCount += 1;
        }
    }
    return { stepCount: definition.steps.length, actionCount: definition.actions.length, bindingCount, functionalBindingCount };
}
async function readDefinition(repo, actor, versionId) {
    const loaded = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    const [roles, functionalRoles] = await Promise.all([repo.listRoles(actor.tenantId), repo.listFunctionalRoles(actor.tenantId)]);
    const keyById = new Map(roles.map((r) => [r.id, r.key]));
    const functionalKeyById = new Map(functionalRoles.map((f) => [f.id, f.key]));
    return {
        steps: loaded.steps.map((s) => ({ key: s.key, label: s.label, initial: s.initial, terminal: s.terminal })),
        actions: loaded.actions.map((a) => ({
            key: a.key,
            label: a.label,
            from: a.fromStepKey,
            to: a.toStepKey,
            requiresOwnAssignment: a.requiresOwnAssignment,
            capabilityKey: a.capabilityKey ?? null,
            guardKind: a.guardKind ?? (a.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
            roleKeys: loaded.bindings
                .filter((b) => b.actionKey === a.key && (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE")
                .map((b) => keyById.get(b.roleId ?? ""))
                .filter((k) => typeof k === "string"),
            functionalRoleKeys: loaded.bindings
                .filter((b) => b.actionKey === a.key && b.bindingKind === "FUNCTIONAL_ROLE")
                .map((b) => functionalKeyById.get(b.functionalRoleId ?? ""))
                .filter((k) => typeof k === "string"),
        })),
    };
}
/**
 * A draft is KEPT even when it is structurally wrong, and is not publishable while it is.
 *
 * Validated after writing for the reason applyWorkflowSeed gives: an administrator can fix an
 * incomplete draft, and refusing to store it would mean losing the work. But a definition that
 * cannot describe a runnable process is raised loudly here rather than discovered by the first
 * record that gets stuck in it.
 */
async function requireRunnable(repo, actor, versionId, what) {
    const definition = await (0, workflowEngine_1.loadWorkflowVersionDefinition)(repo, actor.tenantId, versionId);
    const problems = (0, workflowEngine_1.validateWorkflowVersion)(definition);
    if (problems.length > 0) {
        throw new policyCommands_1.PolicyValidationError(`this ${what} is not a runnable definition: ${problems.join("; ")}`);
    }
}
//# sourceMappingURL=workflowCommands.js.map
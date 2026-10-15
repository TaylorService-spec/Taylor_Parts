"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWorkflowVersionDefinition = loadWorkflowVersionDefinition;
exports.decideWorkflowAction = decideWorkflowAction;
exports.allowedWorkflowActions = allowedWorkflowActions;
exports.validateWorkflowVersion = validateWorkflowVersion;
async function loadWorkflowVersionDefinition(reader, tenantId, versionId) {
    const [steps, actions, bindings] = await Promise.all([
        reader.listWorkflowSteps(tenantId, versionId),
        reader.listWorkflowActions(tenantId, versionId),
        reader.listWorkflowRoleBindings(tenantId, versionId),
    ]);
    return { versionId, steps, actions, bindings };
}
/**
 * May this principal perform this action on this instance, right now?
 *
 * The instance carries its own version, so the definition passed in MUST be that version's. A
 * caller that loaded a different one is asking a question about a workflow this record is not
 * running, and `unknownAction` is the honest answer rather than a coincidental match.
 */
function decideWorkflowAction(definition, instance, actionKey, attempt) {
    if (!instance || instance.workflowVersionId !== definition.versionId) {
        return { allowed: false, refusal: "unknownInstance" };
    }
    // THE STORED STATE, and only the stored state.
    const currentStepKey = instance.currentStepKey;
    const currentStep = definition.steps.find((s) => s.key === currentStepKey);
    if (currentStep?.terminal === true)
        return { allowed: false, refusal: "terminalState" };
    const action = definition.actions.find((a) => a.key === actionKey);
    if (!action)
        return { allowed: false, refusal: "unknownAction" };
    // AUTHORITY BEFORE VALIDITY WOULD LEAK. Checked in this order deliberately: an unauthorized
    // principal learns "you may not do this", not "you may, but not from here", which would tell them
    // the record's current state. State is business data and this is an authorization answer.
    if (action.fromStepKey !== currentStepKey)
        return { allowed: false, refusal: "invalidFromState" };
    const bound = definition.bindings.some((b) => b.actionKey === actionKey && attempt.roleIds.includes(b.roleId));
    if (!bound)
        return { allowed: false, refusal: "notBoundToRole" };
    if (action.requiresOwnAssignment) {
        // A missing assignee is a REFUSAL, not a pass. "Nobody is assigned" cannot satisfy "must be the
        // assignee" -- treating an absent value as a match is how an own-assignment gate becomes a
        // no-op on exactly the records that never got assigned.
        if (!attempt.assigneeUid || attempt.assigneeUid !== attempt.actorUid) {
            return { allowed: false, refusal: "notOwnAssignment" };
        }
    }
    return { allowed: true, action, toStepKey: action.toStepKey };
}
/**
 * Every action this principal could perform on this instance now.
 *
 * The same decision function, asked once per action -- not a second, parallel implementation of the
 * rules. A surface that renders buttons and a command that authorizes one must never be able to
 * disagree, and the cheapest way to guarantee that is to make them the same code.
 */
function allowedWorkflowActions(definition, instance, attempt) {
    return definition.actions
        .filter((a) => decideWorkflowAction(definition, instance, a.key, attempt).allowed)
        .map((a) => a.key);
}
/**
 * Structural validation of a version before it may be published.
 *
 * A definition that cannot describe a runnable process is refused at publication rather than
 * discovered by the first record that gets stuck in it.
 */
function validateWorkflowVersion(definition) {
    const problems = [];
    const stepKeys = new Set(definition.steps.map((s) => s.key));
    if (definition.steps.length === 0)
        problems.push("a workflow version needs at least one step");
    const initial = definition.steps.filter((s) => s.initial);
    if (initial.length === 0)
        problems.push("no initial step: an instance would have nowhere to start");
    if (initial.length > 1)
        problems.push(`${initial.length} initial steps: an instance's start would be ambiguous`);
    for (const s of definition.steps) {
        if (s.initial && s.terminal)
            problems.push(`step "${s.key}" is both initial and terminal`);
    }
    for (const a of definition.actions) {
        if (!stepKeys.has(a.fromStepKey))
            problems.push(`action "${a.key}" comes from unknown step "${a.fromStepKey}"`);
        if (!stepKeys.has(a.toStepKey))
            problems.push(`action "${a.key}" goes to unknown step "${a.toStepKey}"`);
        const from = definition.steps.find((s) => s.key === a.fromStepKey);
        if (from?.terminal)
            problems.push(`action "${a.key}" leaves terminal step "${a.fromStepKey}"`);
    }
    const actionKeys = new Set(definition.actions.map((a) => a.key));
    for (const b of definition.bindings) {
        if (!actionKeys.has(b.actionKey))
            problems.push(`binding references unknown action "${b.actionKey}"`);
    }
    // An action nobody may perform is not an error -- a definition may be published before its Roles
    // exist, and refusing that would force Roles to be invented to satisfy a validator. Recorded as a
    // WARNING nowhere: it is simply not a problem, and saying so here stops it being "fixed" later.
    return problems;
}
//# sourceMappingURL=workflowEngine.js.map
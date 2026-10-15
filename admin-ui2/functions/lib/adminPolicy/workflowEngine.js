"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWorkflowVersionDefinition = loadWorkflowVersionDefinition;
exports.decideWorkflowAction = decideWorkflowAction;
exports.authorizeWorkflowAction = authorizeWorkflowAction;
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
    const bound = definition.bindings.some((b) => b.actionKey === actionKey && (b.bindingKind ?? "SECURITY_ROLE") === "SECURITY_ROLE"
        && b.roleId !== null && attempt.roleIds.includes(b.roleId));
    if (!bound)
        return { allowed: false, refusal: "notBoundToRole" };
    // This legacy decision carries no Employee facts, so it cannot prove a FUNCTIONAL_ROLE binding -- refused, never
    // assumed. The runtime decision (authorizeWorkflowAction) is the one that evaluates it.
    if (definition.bindings.some((b) => b.actionKey === actionKey && b.bindingKind === "FUNCTIONAL_ROLE")) {
        return { allowed: false, refusal: "functionalRoleRequired" };
    }
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
 * The runtime decision: WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY, against the PINNED version.
 *
 * Structure first (instance/version, terminal, action exists, from-state), in the same order as
 * `decideWorkflowAction`; then the binding; then the capability through the injected evaluator.
 * The legacy uid-shaped own-assignment check is NOT used here -- the RECORD_ASSIGNMENT guard is
 * decided Employee-against-Employee by the evaluator.
 */
async function authorizeWorkflowAction(definition, instance, actionKey, attempt) {
    if (!instance || instance.workflowVersionId !== definition.versionId) {
        return { allowed: false, refusal: "unknownInstance" };
    }
    const currentStep = definition.steps.find((s) => s.key === instance.currentStepKey);
    if (currentStep?.terminal === true)
        return { allowed: false, refusal: "terminalState" };
    const action = definition.actions.find((a) => a.key === actionKey);
    if (!action)
        return { allowed: false, refusal: "unknownAction" };
    if (action.fromStepKey !== instance.currentStepKey)
        return { allowed: false, refusal: "invalidFromState" };
    const bindings = definition.bindings.filter((b) => b.actionKey === actionKey);
    const kindOf = (b) => b.bindingKind ?? "SECURITY_ROLE";
    if (bindings.some((b) => kindOf(b) !== "SECURITY_ROLE" && kindOf(b) !== "FUNCTIONAL_ROLE")) {
        return { allowed: false, refusal: "unsupportedBindingKind" };
    }
    const securityBindings = bindings.filter((b) => kindOf(b) === "SECURITY_ROLE");
    const functionalRoleIds = bindings
        .filter((b) => kindOf(b) === "FUNCTIONAL_ROLE")
        .map((b) => b.functionalRoleId)
        .filter((id) => typeof id === "string" && id.length > 0);
    const roleIds = Array.isArray(attempt.roleIds) ? attempt.roleIds : [];
    // The SECURITY_ROLE binding rule, exactly as before: a Functional Role binding never stands in for it.
    if (!securityBindings.some((b) => b.roleId !== null && roleIds.includes(b.roleId))) {
        return { allowed: false, refusal: "notBoundToRole" };
    }
    const capabilityKey = typeof action.capabilityKey === "string" && action.capabilityKey.length > 0
        ? action.capabilityKey : null;
    if (!capabilityKey)
        return { allowed: false, refusal: "actionWithoutCapability" };
    if (!attempt.authority || typeof attempt.authority.authorize !== "function") {
        return { allowed: false, refusal: "effectiveAuthorityDenied", outcome: "CONTEXT_AUTHORITY_UNAVAILABLE" };
    }
    let decision;
    try {
        decision = await attempt.authority.authorize({
            capabilityKey, recordId: attempt.recordId, guardKind: action.guardKind ?? null, businessContext: attempt.businessContext,
        });
    }
    catch {
        // An evaluator that cannot answer is an outage, never an allow.
        return { allowed: false, refusal: "effectiveAuthorityDenied", outcome: "CONTEXT_AUTHORITY_UNAVAILABLE" };
    }
    if (decision?.allowed !== true) {
        return { allowed: false, refusal: "effectiveAuthorityDenied", outcome: decision?.outcome ?? "DENIED" };
    }
    // THE NARROWING CONJUNCT. Only when the action carries a FUNCTIONAL_ROLE binding; otherwise untouched.
    const hasFunctionalBinding = bindings.some((b) => kindOf(b) === "FUNCTIONAL_ROLE");
    if (hasFunctionalBinding) {
        if (!attempt.functionalRoles || typeof attempt.functionalRoles.currentFunctionalRoles !== "function") {
            return { allowed: false, refusal: "functionalRoleFactsUnavailable", outcome: "FUNCTIONAL_ROLE_FACTS_UNAVAILABLE" };
        }
        let facts;
        try {
            facts = await attempt.functionalRoles.currentFunctionalRoles();
        }
        catch {
            return { allowed: false, refusal: "functionalRoleFactsUnavailable", outcome: "FUNCTIONAL_ROLE_FACTS_UNAVAILABLE" };
        }
        if (!facts?.employeeId)
            return { allowed: false, refusal: "employeeLinkRequired", outcome: "EMPLOYEE_LINK_REQUIRED" };
        const held = new Set(Array.isArray(facts.functionalRoleIds) ? facts.functionalRoleIds : []);
        if (!functionalRoleIds.some((id) => held.has(id))) {
            return { allowed: false, refusal: "functionalRoleRequired", outcome: "FUNCTIONAL_ROLE_REQUIRED" };
        }
    }
    return { allowed: true, action, toStepKey: action.toStepKey, capabilityKey, outcome: "ALLOWED" };
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
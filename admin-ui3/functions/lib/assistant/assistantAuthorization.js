"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectiveAuthority = resolveEffectiveAuthority;
exports.authorizeTool = authorizeTool;
exports.planToolExecution = planToolExecution;
/**
 * Resolve one actor's effective authority.
 *
 * `activeCapabilities` is passed in rather than read here, because "active" is an ENVIRONMENT
 * question -- the same capability is live in sandbox and denied in production, and a resolver that
 * decided that for itself would be right in one environment and wrong in the other.
 */
function resolveEffectiveAuthority(actor, roles, activeCapabilities) {
    const held = new Set();
    const roleIds = [
        ...actor.businessRoleIds,
        ...actor.functionalRoleIds,
        ...(actor.compatibilityRoleId ? [actor.compatibilityRoleId] : []),
    ];
    for (const roleId of roleIds) {
        for (const p of roles.permissionsForRole(roleId))
            held.add(p);
    }
    const operable = new Set();
    const grantedButInactive = new Set();
    for (const p of held) {
        if (activeCapabilities.has(p))
            operable.add(p);
        else
            grantedButInactive.add(p);
    }
    return { operable, grantedButInactive };
}
/**
 * Decide one tool. Pure, synchronous, and performs no retrieval — the separation is the design.
 */
function authorizeTool(tool, authority) {
    const missing = tool.requires.filter((p) => !authority.operable.has(p));
    if (missing.length === 0) {
        return { toolId: tool.id, decision: "ALLOW", required: tool.requires, missing: [], reason: "" };
    }
    // A capability that is HELD but inactive is refused exactly like one that is not held. The user
    // cannot do the thing either way, and the distinction belongs in the audit record, not the answer.
    return {
        toolId: tool.id,
        decision: "DENY",
        required: tool.requires,
        missing,
        reason: tool.deniedMessage,
    };
}
/**
 * Partition a tool set into allowed and denied WITHOUT executing anything.
 *
 * Returning a plan rather than results is what enforces the ordering: a caller physically cannot
 * retrieve data for a denied tool, because this function hands back no way to do so.
 */
function planToolExecution(tools, authority) {
    const decisions = tools.map((t) => authorizeTool(t, authority));
    const allowedIds = new Set(decisions.filter((d) => d.decision === "ALLOW").map((d) => d.toolId));
    return { allowed: tools.filter((t) => allowedIds.has(t.id)), decisions };
}
//# sourceMappingURL=assistantAuthorization.js.map
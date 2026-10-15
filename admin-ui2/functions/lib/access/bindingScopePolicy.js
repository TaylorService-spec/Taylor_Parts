"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_BINDING_AT_SCOPE_REASON = void 0;
exports.bindingAllowsAssignmentScope = bindingAllowsAssignmentScope;
exports.roleHasAnyBindingAtAssignmentScope = roleHasAnyBindingAtAssignmentScope;
/**
 * The one binding-scope decision. Never throws.
 *
 * @param role the Role whose grant is being tested -- the binding's left half.
 * @param permissionId the capability being conferred -- the binding's right half.
 * @param assignmentScopeType the `Scope.type` of the RoleAssignment offering to confer it.
 * @returns true when the binding permits that kind of assignment.
 */
function bindingAllowsAssignmentScope(role, permissionId, assignmentScopeType) {
    if (role === null || typeof role !== "object")
        return false;
    if (typeof permissionId !== "string" || permissionId.length === 0)
        return false;
    if (typeof assignmentScopeType !== "string" || assignmentScopeType.length === 0)
        return false;
    const policy = role.scopesByPermission;
    // No policy map at all, or no entry for this permission: unrestricted, exactly as before R-32.
    if (policy === null || typeof policy !== "object")
        return true;
    const allowed = policy[permissionId];
    if (allowed === undefined)
        return true;
    // A declared-but-malformed entry is a denial, not an escape hatch. An empty list is a
    // deliberate "this binding confers nothing from any scope" and is honoured as written.
    if (!Array.isArray(allowed))
        return false;
    return allowed.some((entry) => entry === assignmentScopeType);
}
/**
 * Grant-time question (R-32 §4): does this Role carry AT LEAST ONE binding that an assignment at
 * this scope type could confer?
 *
 * DELIBERATELY "SOME", NOT "EVERY". A mixed Role is the normal case, not the exception --
 * `partsManager` carries thirteen permissions of which two are location-required and eleven are
 * not. Requiring every binding to be valid would make a location grant impossible for exactly the
 * Roles R-32 exists to scope; requiring none would make the check meaningless. "At least one" is
 * the only reading under which `partsManager @ global` and `partsManager @ location:wh-main`
 * remain COMPOSABLE assignments rather than rivals -- which R-32 §4 requires by name.
 */
function roleHasAnyBindingAtAssignmentScope(role, assignmentScopeType) {
    if (role === null || typeof role !== "object")
        return false;
    if (!Array.isArray(role.permissions))
        return false;
    return role.permissions.some((permissionId) => bindingAllowsAssignmentScope(role, permissionId, assignmentScopeType));
}
/** The governed refusal reason `grantRole` raises. Stable: it is quoted in audit and in tests. */
exports.NO_BINDING_AT_SCOPE_REASON = "roleHasNoBindingAtRequestedScope";
//# sourceMappingURL=bindingScopePolicy.js.map
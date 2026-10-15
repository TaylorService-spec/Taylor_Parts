"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectivePermission = resolveEffectivePermission;
const permissionCatalog_1 = require("./permissionCatalog");
const bindingScopePolicy_1 = require("./bindingScopePolicy");
// Spec §8 step 5's total order for narrowest-matching-Scope audit
// attribution: ownAssignment < location < businessUnit/domain < operatingCompany/tenant < global.
const SCOPE_NARROWNESS_ORDER = {
    ownAssignment: 0,
    location: 1,
    // FIN-BLOCK-001: a business unit is a slice of one company's activity, so it sorts narrower
    // than a whole operating company; both are value-matched scopes like domain/location. Ties in
    // this table are legal (the sort falls through to grantedAt).
    businessUnit: 2,
    domain: 2,
    operatingCompany: 3,
    tenant: 3,
    global: 4,
};
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isValidScope(value) {
    if (!isPlainObject(value))
        return false;
    const type = value.type;
    return (type === "global" ||
        type === "tenant" ||
        type === "domain" ||
        type === "location" ||
        type === "ownAssignment" ||
        // FIN-BLOCK-001: the governed financial reach scopes (value-matched in scopeMatches below).
        type === "operatingCompany" ||
        type === "businessUnit");
}
// Fail-closed shape validation (Spec §13): an assignment that is
// missing a required field, has the wrong type, or carries an unknown
// Scope type is excluded entirely -- it contributes no grant, but does
// not abort evaluation of the other, well-formed assignments.
function isWellFormedAssignment(assignment) {
    if (!isPlainObject(assignment))
        return false;
    const a = assignment;
    return (typeof a.id === "string" &&
        typeof a.principalUid === "string" &&
        typeof a.roleId === "string" &&
        isValidScope(a.scope) &&
        (a.status === "active" || a.status === "disabled") &&
        typeof a.accessVersionAtGrant === "number");
}
// Spec §8 step 1: "active" and "whose accessVersionAtGrant is
// consistent with the current accessVersion." Interpretation recorded
// for Owner review (Implementation Plan Row 2 has no further authority
// to resolve this): accessVersion increases monotonically per
// principal on every access change (Spec §11), so a well-formed
// assignment's own grant-time snapshot can never legitimately exceed
// the current authoritative value. "Consistent" is implemented as
// `accessVersionAtGrant <= currentAccessVersion`; an assignment whose
// accessVersionAtGrant is GREATER than the current value is impossible
// under a correctly-operating writer and is treated as malformed/stale
// data -- excluded, fail-closed, never granted the benefit of the
// doubt.
function isConsistentWithCurrentAccessVersion(assignment, currentAccessVersion) {
    return assignment.accessVersionAtGrant <= currentAccessVersion;
}
function scopeMatches(assignmentScope, target) {
    switch (assignmentScope.type) {
        case "global":
            return true;
        case "ownAssignment":
            return target.condition.isOwnAssignment === true;
        // Spec §10: tenant is reserved and inert until Issue #140 defines
        // it, and "must never widen access." Correction (Inventory review
        // round 4, prior implementation confirmed a real defect here): an
        // unconditional `true` made a tenant-scoped assignment match ANY
        // target -- functionally identical to `global` -- which is exactly
        // the widening Spec §10 prohibits (a tenant-scoped admin assignment
        // could satisfy a global-scoped trusted-command check). Fixed by
        // requiring the SAME exact match domain/location already require:
        // the target must itself declare a matching tenant Scope+value.
        // Since #140 does not exist, no caller in this repository ever
        // constructs a tenant-scoped target -- every trusted-writer command
        // checks against `{ type: "global" }` -- so a tenant-scoped
        // assignment cannot match anything today. That IS "genuinely
        // inert": not a bypass, not a widening, and not authoritative for
        // any real target until #140 defines what a tenant target even is.
        case "tenant":
        case "domain":
        case "location":
        // FIN-BLOCK-001: operatingCompany/businessUnit are value-matched EXACTLY like domain/
        // location — the target must itself declare the same scope type and value. A financial
        // read resolves them per-target (finance/financeReadCallables.ts enumerates the governed
        // company/unit ids); the always-global effective-access feed target never matches them, so
        // holding such an assignment widens nothing anywhere else.
        case "operatingCompany":
        case "businessUnit":
            return (target.scope.type === assignmentScope.type &&
                target.scope.value !== undefined &&
                target.scope.value === assignmentScope.value);
        default:
            return false;
    }
}
function evaluateConditions(role, permissionId, context) {
    const conditions = role.conditionsByPermission?.[permissionId];
    if (!conditions || conditions.length === 0)
        return true;
    return conditions.every((condition) => {
        switch (condition.kind) {
            case "statusEquals":
                return (typeof condition.params.status === "string" &&
                    context.status !== undefined &&
                    context.status === condition.params.status);
            case "statusIn":
                return (Array.isArray(condition.params.statuses) &&
                    context.status !== undefined &&
                    condition.params.statuses.includes(context.status));
            case "isOwnAssignment":
                return context.isOwnAssignment === true;
            case "employmentActive":
                return context.employmentActive === true;
            case "operationalRoleActive": {
                if (typeof context.operationalRoleActive !== "function")
                    return false;
                // params.role: a single required operational role. params.roles:
                // an ANY-of list (e.g. the Issue #100 NEEDS_PLANNING manual-create
                // path, eligible for either PARTS_MANAGER or WAREHOUSE_MANAGER) --
                // both are repository-declared param shapes for this one
                // ConditionKind (Spec §5.5 fixes {kind, params} as declarative,
                // not the internal shape of params), not a new ConditionKind.
                if (typeof condition.params.role === "string") {
                    return context.operationalRoleActive(condition.params.role) === true;
                }
                if (Array.isArray(condition.params.roles)) {
                    return condition.params.roles.some((role) => typeof role === "string" && context.operationalRoleActive(role) === true);
                }
                return false;
            }
            // Fail-closed (Spec §13/§5.5): an unrecognized ConditionKind
            // never passes.
            default:
                return false;
        }
    });
}
// Spec §8: pure function of (assignments, role definitions, target
// context, accessVersion) -- identical inputs always yield an
// identical decision (Spec §21 A1).
function resolveEffectivePermission(input) {
    const permission = (0, permissionCatalog_1.findPermission)(input.permissionId);
    if (!permission) {
        return { decision: "DENY", reason: "unknownPermission" };
    }
    // Issue #325 / ADR-007 D-226: a REGISTERED capability (found above)
    // whose `active` flag is explicitly `false` denies unconditionally,
    // ahead of and regardless of any Role grant -- the mechanism ADR-007
    // §2.6 requires for "sensitive fields are denied by default and
    // activated only through dedicated security review." Every permission
    // declared before this addition omits `active` (undefined !== false),
    // so this is a strict no-op for all of them; it only ever fires for a
    // capability that explicitly opts in to this denied-by-default state
    // (today: the field-read capabilities documented as pending their
    // wave's review in permissionCatalog.ts, e.g. `customer.notes`'s
    // security-text field or `customer.accountOwner`'s wave-4 deferral).
    //
    // Per-environment activation override (2026-08-14 spec): an environment
    // MAY lift this blanket deny for a bounded set of spine capability ids.
    // Fail-closed by construction: the override is consulted ONLY here, and
    // only its PRESENCE for THIS id suppresses the active:false deny; every
    // Role/Scope/Condition/accessVersion check below is unchanged, so a
    // lifted capability with no qualifying grant still denies. Omitted set =>
    // this is a strict no-op (identical to before the parameter existed).
    if (permission.active === false && !input.activationOverrides?.has(input.permissionId)) {
        return { decision: "DENY", reason: "inactivePermission" };
    }
    if (!Array.isArray(input.assignments)) {
        return { decision: "DENY", reason: "malformedAssignments" };
    }
    const qualifying = [];
    for (const candidate of input.assignments) {
        if (!isWellFormedAssignment(candidate))
            continue;
        if (candidate.status !== "active")
            continue;
        if (!isConsistentWithCurrentAccessVersion(candidate, input.currentAccessVersion)) {
            continue;
        }
        const role = input.roles[candidate.roleId];
        if (!role || !Array.isArray(role.permissions))
            continue;
        if (!role.permissions.includes(input.permissionId))
            continue;
        if (!scopeMatches(candidate.scope, input.target))
            continue;
        // R-32 (#152) STEP 3 -- the per-binding assignment-scope policy, asked here and nowhere else
        // in this function. AUTHORITATIVE by placement: RoleAssignments written before R-32 existed
        // are already in Firestore, and a grant-time check can never see them, so a global manager
        // assignment must be refused HERE or the bypass survives its own fix. Distinct from
        // scopeMatches() above, which asks whether the assignment reaches the TARGET; this asks
        // whether that KIND of assignment may carry this Role's grant of this Permission at all.
        // Absent policy => allow, so every Role that declares none behaves exactly as before.
        if (!(0, bindingScopePolicy_1.bindingAllowsAssignmentScope)(role, input.permissionId, candidate.scope.type))
            continue;
        if (!evaluateConditions(role, input.permissionId, input.target.condition))
            continue;
        qualifying.push({ assignment: candidate, role });
    }
    if (qualifying.length === 0) {
        return { decision: "DENY", reason: "noQualifyingGrant" };
    }
    // Spec §8 step 5: narrowest matching Scope is the authoritative
    // basis for logging; tie-break by PermissionId (constant here, since
    // we resolve one id at a time) then grantedAt.
    qualifying.sort((a, b) => {
        const narrownessDelta = SCOPE_NARROWNESS_ORDER[a.assignment.scope.type] -
            SCOPE_NARROWNESS_ORDER[b.assignment.scope.type];
        if (narrownessDelta !== 0)
            return narrownessDelta;
        const aGrantedAt = a.assignment.grantedAt;
        const bGrantedAt = b.assignment.grantedAt;
        const aMillis = typeof aGrantedAt?.toMillis === "function" ? aGrantedAt.toMillis() : 0;
        const bMillis = typeof bGrantedAt?.toMillis === "function" ? bGrantedAt.toMillis() : 0;
        return aMillis - bMillis;
    });
    const [narrowest] = qualifying;
    return {
        decision: "ALLOW",
        reason: "qualifyingGrant",
        matchedAssignmentId: narrowest.assignment.id,
        matchedRoleId: narrowest.role.id,
    };
}
//# sourceMappingURL=resolveEffectivePermission.js.map
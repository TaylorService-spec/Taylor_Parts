"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateOperationalRoleActive = evaluateOperationalRoleActive;
exports.buildOperationalRoleActiveResolverFromEmployeeId = buildOperationalRoleActiveResolverFromEmployeeId;
exports.buildOperationalRoleActiveResolver = buildOperationalRoleActiveResolver;
const USERS_COLLECTION = "users";
const EMPLOYEES_COLLECTION = "employees";
const ACTIVE_EMPLOYMENT_STATUS = "ACTIVE";
// Always-false resolver -- the fail-closed terminal value returned whenever
// any precondition in the chain above is not met. A single shared constant
// (not reconstructed per call) so every deny path is provably identical.
const ALWAYS_FALSE = () => false;
// PURE. Byte-for-byte mirror of firestore.rules's isActiveOperationalRole(role):
// reciprocal link + ACTIVE employment + operationalRoles list membership.
// Never throws -- every malformed/missing input resolves to `false`.
//
// "Active vocabulary" note: this predicate deliberately FUSES two of
// the four canonical "active" senses -- Employee active
// (employeeEmploymentStatus === ACTIVE) AND Role assignment active
// (operationalRoles membership currently effective) -- into one
// authorization check. That fusion is intentional (an operational role
// is only meaningful for a currently-assignable Employee) and is not a
// naming defect; it is documented, not renamed, in
// docs/architecture/ADR-012-persona-authority-composition-and-scope.md
// section 2.2a. Do not split this function's name without first
// updating firestore.rules and its other mirror
// (adminCredentialCommands.ts's resolveEmployeeLinkFacts) in the same
// Tier-2 deploy-gated change.
function evaluateOperationalRoleActive(facts, role) {
    if (typeof role !== "string" || role.length === 0)
        return false;
    if (typeof facts.uid !== "string" || facts.uid.length === 0)
        return false;
    const employeeId = typeof facts.userEmployeeId === "string" && facts.userEmployeeId.length > 0
        ? facts.userEmployeeId
        : null;
    if (employeeId === null)
        return false;
    if (!facts.employeeExists)
        return false;
    // GOVERNED reciprocal field ONLY -- exact match, no alias fields.
    if (facts.employeeUserId !== facts.uid)
        return false;
    if (facts.employeeEmploymentStatus !== ACTIVE_EMPLOYMENT_STATUS)
        return false;
    if (!Array.isArray(facts.employeeOperationalRoles))
        return false;
    // `hasAny([role])` mirror: exact-equality membership test. A malformed
    // (non-string) entry in the array simply never equals `role` -- it does
    // not throw and does not widen the match.
    return facts.employeeOperationalRoles.includes(role);
}
// Resolve the raw facts for `uid` given an ALREADY-KNOWN
// `users/{uid}.employeeId` value (avoids a caller re-reading the users
// document it already fetched for its own purposes, e.g.
// effectiveAccessFeed.ts's accessVersion read). Performs exactly one
// additional Firestore read (`employees/{employeeId}`) when a candidate
// employeeId is present; zero reads otherwise.
async function resolveFactsFromEmployeeId(db, uid, userEmployeeId) {
    const employeeId = typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
    if (employeeId === null) {
        return {
            uid,
            userEmployeeId,
            employeeExists: false,
            employeeUserId: undefined,
            employeeEmploymentStatus: undefined,
            employeeOperationalRoles: undefined,
        };
    }
    const employeeSnap = await db.collection(EMPLOYEES_COLLECTION).doc(employeeId).get();
    const employeeData = employeeSnap.exists
        ? employeeSnap.data()
        : undefined;
    return {
        uid,
        userEmployeeId,
        employeeExists: employeeSnap.exists,
        employeeUserId: employeeData?.userId,
        employeeEmploymentStatus: employeeData?.employmentStatus,
        employeeOperationalRoles: employeeData?.operationalRoles,
    };
}
// Build a `ConditionContext.operationalRoleActive` resolver
// (resolveEffectivePermission.ts) for `uid`, given an ALREADY-FETCHED
// `users/{uid}.employeeId` value. FAILS CLOSED: any Firestore read error
// resolves to the always-false closure -- this function itself never
// rejects. Intended for callers (like effectiveAccessFeed.ts) that have
// already read the `users/{uid}` document for another reason and want to
// avoid a second read of it.
async function buildOperationalRoleActiveResolverFromEmployeeId(db, uid, userEmployeeId) {
    if (typeof uid !== "string" || uid.length === 0)
        return ALWAYS_FALSE;
    try {
        const facts = await resolveFactsFromEmployeeId(db, uid, userEmployeeId);
        return (role) => {
            try {
                return evaluateOperationalRoleActive(facts, role);
            }
            catch {
                return false;
            }
        };
    }
    catch {
        // Any read failure (network, permission, malformed doc access) fails
        // closed: every role check denies. This function never throws into
        // the caller's authorization path.
        return ALWAYS_FALSE;
    }
}
// Fully self-contained variant: reads BOTH `users/{uid}` and
// `employees/{employeeId}` itself. For future callers that have not
// already fetched the users document (this program's other GLOBAL_TARGET
// call sites currently pass `condition: {}` deliberately -- see
// effectiveAccessFeed.ts's header comment for why only the canonical feed
// is wired today). FAILS CLOSED identically to the function above.
async function buildOperationalRoleActiveResolver(db, uid) {
    if (typeof uid !== "string" || uid.length === 0)
        return ALWAYS_FALSE;
    try {
        const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
        const userEmployeeId = userSnap.exists
            ? userSnap.data()?.employeeId
            : undefined;
        return buildOperationalRoleActiveResolverFromEmployeeId(db, uid, userEmployeeId);
    }
    catch {
        return ALWAYS_FALSE;
    }
}
//# sourceMappingURL=operationalRoleContext.js.map
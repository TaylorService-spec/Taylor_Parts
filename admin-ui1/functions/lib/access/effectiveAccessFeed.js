"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PERMISSION_IDS = exports.MalformedAccessDataError = exports.InvalidInputError = void 0;
exports.resolveEffectiveAccess = resolveEffectiveAccess;
// Enterprise Access & Administration Platform (Issue #226) -- the
// trusted, read-only effective-access feed. Lets a client resolve
// governed capability decisions (e.g. for navigation) WITHOUT ever
// interpreting `users/{uid}.role` as a governed role itself -- the
// legacy `role` field stays meaningful only to the compatibility-Role
// Rules paths (Issue #100 etc.); anything that wants a GOVERNED
// decision (Role/Permission/Scope/Condition/accessVersion) must ask
// this feed, which is the only caller-facing surface for
// resolveEffectivePermission.ts outside the trusted-writer commands and
// the report execution service.
//
// Server-side ONLY -- not mirrored to field-ops-app-vite (matches
// trustedWriterCommands.ts's own "not mirrored" convention: clients
// never call this module directly, only through the callable adapter,
// ./effectiveAccessFeedCallable.ts).
//
// PURE READ, no mutation, no Audit Event: this module never writes to
// Firestore. Unlike the trusted-writer commands (which mutate state and
// therefore audit) or the report execution service (which reads row
// data and therefore audits row-shaped facts per D-AUDIT), this feed
// only answers "what can the caller currently do," a question with no
// row data and no state change to record -- auditing every nav-load
// call would be pure noise, not a security control. (If per-decision
// auditing is ever wanted, e.g. for the sensitive-domain admin
// capabilities, that is a separate, later, explicitly-scoped addition,
// not implied by this feed's own contract.)
//
// Reuses, never reimplements: permissionCatalog.ts (the catalog),
// resolveEffectivePermission.ts (the decision engine) -- every
// fail-closed property that engine already has (unknown/inactive
// permission, malformed/stale/inconsistent assignment, unrecognized
// Scope, unrecognized Condition kind) applies here unchanged, because
// this module calls that SAME function, once per requested capability,
// against the SAME server-resolved principal state every call shares.
const firestore_1 = require("firebase-admin/firestore");
const compatibilityRoles_1 = require("./compatibilityRoles");
const governedBusinessRoles_1 = require("./governedBusinessRoles");
const resolveEffectivePermission_1 = require("./resolveEffectivePermission");
const environmentCapabilityOverrides_1 = require("./environmentCapabilityOverrides");
const compactClaims_1 = require("./compactClaims");
const operationalRoleContext_1 = require("./operationalRoleContext");
class InvalidInputError extends Error {
}
exports.InvalidInputError = InvalidInputError;
class MalformedAccessDataError extends Error {
}
exports.MalformedAccessDataError = MalformedAccessDataError;
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
// Bounded (task requirement: "accept only a bounded list of registered
// capability IDs"). Comfortably covers every capability id registered
// today (permissionCatalog.ts's full catalog is well under this) with
// headroom for near-future waves, while still refusing an arbitrarily
// large or pathological request outright rather than silently
// truncating it (truncation would make "did I get a decision for
// everything I asked" ambiguous -- a hard reject is unambiguous).
exports.MAX_PERMISSION_IDS = 100;
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// Merged Role catalog this feed resolves against -- report.* and every
// other capability may be granted via either a compatibility Role or a
// governed business Role (e.g. Owner's Issue #325 W1 report grant); no
// id collision exists between the two maps (proved by
// resolveEffectivePermission.test.mjs's own "share no id" check).
function allRoles() {
    return { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
}
// Same fail-closed contract as trustedWriterCommands.ts's own
// readAuthoritativeAccessVersion (that function is not exported --
// this is an intentionally small, independent copy, not a shared
// import, matching this codebase's established "no shared/monorepo
// tooling, duplicate small glue rather than couple unrelated modules"
// posture). Missing entirely (no users/{uid} doc, or the field absent)
// is the legitimate bootstrap case -- a principal who has never had an
// access change -- and reads as 0. A field that IS present but the
// wrong shape is data corruption, not a bootstrap case, and fails
// closed by throwing.
function readAuthoritativeAccessVersion(data) {
    if (!data)
        return 0;
    if (data.accessVersion === undefined || data.accessVersion === null)
        return 0;
    if (!(0, compactClaims_1.isValidAccessVersionValue)(data.accessVersion)) {
        throw new MalformedAccessDataError("users/{uid}.accessVersion is malformed");
    }
    return data.accessVersion;
}
function assertValidInput(input) {
    if (!isPlainObject(input)) {
        throw new InvalidInputError("input must be an object");
    }
    if (typeof input.principalUid !== "string" || input.principalUid.length === 0) {
        throw new InvalidInputError("principalUid is required");
    }
    if (!Array.isArray(input.permissionIds)) {
        throw new InvalidInputError("permissionIds must be an array");
    }
    if (input.permissionIds.length === 0) {
        throw new InvalidInputError("permissionIds must not be empty");
    }
    if (input.permissionIds.length > exports.MAX_PERMISSION_IDS) {
        throw new InvalidInputError(`permissionIds must not exceed ${exports.MAX_PERMISSION_IDS} entries`);
    }
    for (const id of input.permissionIds) {
        if (typeof id !== "string" || id.length === 0) {
            throw new InvalidInputError("every permissionId must be a non-empty string");
        }
    }
}
// The trusted entry point. Resolves the CALLER's (never a client-
// claimed) current user/accessVersion/active RoleAssignments server-
// side, then asks resolveEffectivePermission() once per requested
// (de-duplicated) capability id against that SAME state -- so every
// decision in one response is mutually consistent (resolved against
// the identical accessVersion/assignment snapshot), never a mix of
// reads taken at different moments.
async function resolveEffectiveAccess(input, options = {}) {
    assertValidInput(input);
    const db = options.db ?? (0, firestore_1.getFirestore)();
    const roles = options.roles ?? allRoles();
    // Per-environment activation override for this deployed project. ALWAYS
    // derived from the runtime's own trusted project identity (GCLOUD_PROJECT) --
    // there is deliberately NO options seam for this. AUTH-CORE invariant: no
    // caller (client OR internal) may inject an activation set, so this path
    // cannot be widened to activate production. EMPTY in production and for any
    // unknown project -> the active:false spine capabilities stay hard-denied
    // exactly as today. The active branch is exercised in tests via the trusted
    // GCLOUD_PROJECT path (a sandbox projectId), never via a caller override.
    const activationOverrides = (0, environmentCapabilityOverrides_1.resolveRuntimeCapabilityOverrides)();
    const [userSnap, assignmentsSnap] = await Promise.all([
        db.collection(USERS_COLLECTION).doc(input.principalUid).get(),
        db
            .collection(ROLE_ASSIGNMENTS_COLLECTION)
            .where("principalUid", "==", input.principalUid)
            .where("status", "==", "active")
            .get(),
    ]);
    const accessVersion = readAuthoritativeAccessVersion(userSnap.data());
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Fixed, always-global target: this feed answers capability-level
    // ("can the caller do X at all") questions for navigation, never a
    // per-record ("can the caller do X to THIS document") question -- a
    // per-record decision is each governed surface's own Rules/Function
    // concern (e.g. reportExecutionService.ts's own per-field/per-object
    // resolution), not this feed's. isOwnAssignment stays unpopulated here
    // by construction (empty in condition) for exactly that reason -- it
    // is inherently record-scoped ("is THIS the caller's own assignment"),
    // and this feed has no record in play.
    //
    // CORRECTION (Wave 7 extension PART 4): operationalRoleActive is NOT a
    // per-record predicate the way isOwnAssignment is -- it asks "is
    // operational role R currently active for the calling principal,"
    // which is answerable purely from the principal's own linked Employee
    // document, with no target record involved at all. The comment
    // previously here grouped it with isOwnAssignment and left it
    // unpopulated "by design," which meant every operationalRoleActive-
    // conditioned capability (the nine ids on TECHNICIAN_ROLE in
    // compatibilityRoles.ts: reorder.request.*, reorder.purchaseOrder.*,
    // inventory.transaction.read, inventory.action.read,
    // inventory.catalog.read) DENIED unconditionally through this feed for
    // every principal, active operational role or not -- fail-closed (not a
    // security bug), but also not the resolvable-condition behavior the
    // catalog declares. operationalRoleContext.ts now resolves it here, the
    // ONE canonical resolver path, from the SAME userSnap already read above
    // (no extra users/{uid} read) plus one additional employees/{employeeId}
    // read when a candidate link exists. Every OTHER call site building its
    // own GLOBAL_TARGET (partMasterCommands.ts, savedDefinitionCommands.ts,
    // reportExecutionService.ts, receivingCallableWiring.ts,
    // trustedWriterCommands.ts) still deliberately passes `condition: {}` --
    // none of them evaluates a permission id an operationalRoleActive
    // Condition gates, so populating it there would be dead code, and
    // wiring it individually into each would defeat the point of having one
    // shared resolver.
    const operationalRoleActive = await (0, operationalRoleContext_1.buildOperationalRoleActiveResolverFromEmployeeId)(db, input.principalUid, userSnap.data()?.employeeId);
    const target = {
        scope: { type: "global" },
        condition: { operationalRoleActive },
    };
    const decisions = {};
    for (const permissionId of new Set(input.permissionIds)) {
        decisions[permissionId] =
            (0, resolveEffectivePermission_1.resolveEffectivePermission)({
                permissionId,
                assignments,
                roles,
                currentAccessVersion: accessVersion,
                target,
                activationOverrides,
            }).decision === "ALLOW";
    }
    return { accessVersion, decisions };
}
//# sourceMappingURL=effectiveAccessFeed.js.map
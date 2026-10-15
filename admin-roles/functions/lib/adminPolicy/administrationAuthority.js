"use strict";
// Who may change the rules — the administration authority.
//
// ════════════════════ WHY THIS IS NOT ITSELF CONFIGURABLE POLICY ════════════════════
//
// Everything else in this subsystem is tenant-configurable: which Roles read Customers, which Role
// may Void a Purchase Order, what fields exist. THIS is not, and the reason is recovery.
//
// If "who may edit Roles" were an ordinary Object CRED cell, an administrator could remove it --
// from themselves, from every Role, in one transaction that the engine would happily apply because
// it was a valid policy edit. The platform would then be permanently unadministrable by design,
// with no bug to point at. So the authority to change policy is an ENGINE INVARIANT keyed on Role
// identity, and no configuration reaches it.
//
// ════════════════════ TWO DIFFERENT AUTHORITIES ════════════════════
//
// Owner ruling, and the distinction is load-bearing:
//
//   ROLE DEFINITION  -- what a Role may do            ADMIN ONLY
//   ROLE ASSIGNMENT  -- who holds a Role              OWNER, GENERAL MANAGER, or ADMIN
//
// A General Manager may hand somebody the Admin Role without being able to change what Admin means.
// That is deliberate: staffing is an operational decision and rewriting authority is not, and the
// old two-person route for privileged assignment is superseded by this ruling.
//
// ════════════════════ WHAT THIS IS NOT ════════════════════
//
// NOT a new compatibility-role layer. These are keys of Roles in the policy store, resolved through
// the same assignment records as everything else. Nothing here reads `users/{uid}.role`, and nothing
// here reads Firestore at all.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION = exports.AdministrationCapabilityDeniedError = exports.ADMINISTRATION_BOOTSTRAP_GRANTS = exports.isProtectedOwnerRole = exports.PROTECTED_OWNER_ROLE_KEY = exports.isDesignatedAdministratorRole = exports.ADMINISTRATOR_STAFFING_CAPABILITY = exports.SECURITY_ADMINISTRATION_CAPABILITY = exports.AdministrationDeniedError = exports.PROTECTED_ROLE_KEYS = exports.ROLE_ASSIGNMENT_ROLE_KEYS = exports.ADMIN_ROLE_KEY = void 0;
exports.hasAdministrationAuthority = hasAdministrationAuthority;
exports.requireAdministrationAuthority = requireAdministrationAuthority;
exports.hasSecurityAdministrationCapability = hasSecurityAdministrationCapability;
exports.decideWorkflowAdministration = decideWorkflowAdministration;
/** The Role whose holders may edit Objects, Fields, Roles, permissions and Workflows. */
exports.ADMIN_ROLE_KEY = "admin";
/**
 * The Roles whose holders may assign and revoke Roles.
 *
 * Ordered as the Owner stated them. Admin is included because an administrator who could define the
 * Admin Role but not grant it could not onboard the second administrator, which is the same
 * unrecoverable corner this file exists to avoid.
 */
exports.ROLE_ASSIGNMENT_ROLE_KEYS = Object.freeze([
    "owner",
    "generalManager",
    exports.ADMIN_ROLE_KEY,
]);
/**
 * Roles that ordinary configuration may not delete or strip of their administering authority.
 *
 * `protected: true` on the record is the stored flag; this is the list the seed marks. The store and
 * the commands both refuse to violate it, in that order, so a writer that skipped the command still
 * cannot leave the platform unadministrable.
 */
exports.PROTECTED_ROLE_KEYS = Object.freeze([exports.ADMIN_ROLE_KEY, "owner"]);
/**
 * Does this principal hold the authority for this administration action?
 *
 * Takes the Role KEYS the principal actually holds -- resolved from qualifying, active, non-stale
 * assignments by the access resolver. An empty list is a refusal; there is no default-allow branch
 * and no "if we cannot tell, permit" fallback.
 */
function hasAdministrationAuthority(heldRoleKeys, action) {
    if (!Array.isArray(heldRoleKeys) || heldRoleKeys.length === 0)
        return false;
    const held = new Set(heldRoleKeys.filter((k) => typeof k === "string" && k.length > 0));
    if (action === "assignRole")
        return exports.ROLE_ASSIGNMENT_ROLE_KEYS.some((k) => held.has(k));
    return held.has(exports.ADMIN_ROLE_KEY);
}
/** Thrown by every command whose actor lacks the authority. Never carries policy detail. */
class AdministrationDeniedError extends Error {
    constructor(action) {
        super(`not authorized to perform "${action}"`);
    }
}
exports.AdministrationDeniedError = AdministrationDeniedError;
function requireAdministrationAuthority(heldRoleKeys, action) {
    if (!hasAdministrationAuthority(heldRoleKeys, action))
        throw new AdministrationDeniedError(action);
}
exports.SECURITY_ADMINISTRATION_CAPABILITY = Object.freeze({
    editSecurityPolicy: "admin.securityPolicy.write",
    assignRole: "admin.roleAssignment.write",
});
/**
 * Does this EFFECTIVE capability set authorize this security-administration action?
 * Fails closed: a missing or non-Set capability set is a refusal, never a fallback to Role keys.
 */
function hasSecurityAdministrationCapability(capabilities, action) {
    return capabilities instanceof Set && capabilities.has(exports.SECURITY_ADMINISTRATION_CAPABILITY[action]);
}
// ════════════════════ ADMINISTRATOR STAFFING (Owner ruling R1, 2026-09-26) ════════════════════
//
// Pass 8 D5(b) says a Role carrying admin.securityPolicy.write may be assigned only by a holder of
// admin.securityPolicy.write. Owner holds admin.roleAssignment.write only, so Owner could no longer staff
// or recover the Administrator. Owner ruling R1 restores exactly that, through ONE narrowly bounded
// capability, and nothing else:
//
//   admin.administratorRole.assign (rolesPermissions / assignAdministratorRole, migration 1763078400000)
//     lets its holder assignRole / revokeRole THE DESIGNATED Administrator Security Role -- and no other
//     Role -- for ANOTHER Principal, globally, through the normal Administration path.
//
// It confers NOTHING else: not admin.securityPolicy.write, not the ability to change what the
// Administrator Role may do, not a direct grant, not a scoped Administrator assignment. It is not a
// governing Administration capability (it authorizes no policy edit), but it DOES take part in the
// anti-lockout model (ANTI_LOCKOUT_CAPABILITIES, Controller ruling 2026-09-27): no mutation may strand
// the tenant without a holder able to recover Administrator staffing. Being admin.*, it can be neither
// conditioned nor held at a scope. Enforced in policyCommands.authorizeSecurityPolicyStaffing.
/** The R1 staffing capability. Its holder may staff the designated Administrator Role for another Principal. */
exports.ADMINISTRATOR_STAFFING_CAPABILITY = "admin.administratorRole.assign";
/**
 * THE DESIGNATED Administrator Security Role: the protected Role whose key is ADMIN_ROLE_KEY. Identified by its
 * immutable key AND the stored protected flag -- never by display name. A tenant-created Role can claim
 * neither (createRole refuses a protected key and always writes protected=false).
 */
const isDesignatedAdministratorRole = (role) => role.protected === true && role.key === exports.ADMIN_ROLE_KEY;
exports.isDesignatedAdministratorRole = isDesignatedAdministratorRole;
// ════════════════════ PROTECTED OWNER (Controller ruling 2026-09-27) ════════════════════
//
// The protected Owner is NOT an ordinary Security Role assignment. Ordinary role administration --
// admin.roleAssignment.write, admin.securityPolicy.write, and R1 -- may neither appoint nor remove it,
// for anyone, including the Owner themselves; and no ordinary role-assignment command may leave a
// tenant with zero active protected Owners (a per-role invariant: Administrator assignments are never a
// substitute). Owner succession / transfer is a separate governed lifecycle operation, not built here.
// Found by the Pass 10 nonprod incident: an Owner revoked their own owner assignment through revokeRole.
/** The immutable key of the protected Owner Security Role. */
exports.PROTECTED_OWNER_ROLE_KEY = "owner";
/** THE protected Owner Role: key AND the stored protected flag, never the display name (as for Administrator). */
const isProtectedOwnerRole = (role) => role != null && role.protected === true && role.key === exports.PROTECTED_OWNER_ROLE_KEY;
exports.isProtectedOwnerRole = isProtectedOwnerRole;
/**
 * The governing grants a tenant's FIRST administrator is bootstrapped with -- the capability form of
 * the recovery property: definition = admin, assignment = admin + owner. Written by
 * `bootstrapAdministrator` in the same transaction that assigns the first Admin, for every pair
 * whose Role and capability exist; identical to what migrations 1761609600000 and 1762646400000
 * produce for a tenant whose Roles existed when they ran. generalManager is deliberately absent (see
 * the conflict note above).
 */
exports.ADMINISTRATION_BOOTSTRAP_GRANTS = Object.freeze([
    { roleKey: exports.ADMIN_ROLE_KEY, capabilityKey: "admin.securityPolicy.write" },
    { roleKey: exports.ADMIN_ROLE_KEY, capabilityKey: "admin.roleAssignment.write" },
    { roleKey: "owner", capabilityKey: "admin.roleAssignment.write" },
    // Owner ruling R1 (2026-09-26): Owner staffs and recovers the designated Administrator out of the box.
    { roleKey: "owner", capabilityKey: exports.ADMINISTRATOR_STAFFING_CAPABILITY },
].map((g) => Object.freeze(g)));
/** Refusal of a capability-governed administration mutation. Names the missing capability. */
class AdministrationCapabilityDeniedError extends AdministrationDeniedError {
    securityAction;
    constructor(securityAction) {
        super(securityAction === "assignRole" ? "assignRole" : "editRoleDefinition");
        this.securityAction = securityAction;
        this.message = `not authorized: "${exports.SECURITY_ADMINISTRATION_CAPABILITY[securityAction]}" is required`;
    }
}
exports.AdministrationCapabilityDeniedError = AdministrationCapabilityDeniedError;
/** The canonical capability for each workflow configuration action that EXISTS today. */
exports.WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION = Object.freeze({
    create: "workflowDefinition.create",
    read: "workflowDefinition.read",
    edit: "workflowDefinition.edit",
    version: "workflowDefinition.version",
    publish: "workflowDefinition.publish",
    bindRole: "workflowDefinition.bindRole",
});
function decideWorkflowAdministration(attempt) {
    const required = exports.WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION[attempt.action];
    const held = attempt.capabilities;
    if (!(held instanceof Set) || !held.has(required)) {
        return Object.freeze({ allowed: false, refusal: "CAPABILITY_MISSING" });
    }
    if (attempt.wouldRemoveLastAdministrationPath) {
        return Object.freeze({ allowed: false, refusal: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH" });
    }
    return Object.freeze({ allowed: true });
}
//# sourceMappingURL=administrationAuthority.js.map
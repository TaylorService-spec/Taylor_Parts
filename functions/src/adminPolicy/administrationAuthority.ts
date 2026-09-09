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

/** The Role whose holders may edit Objects, Fields, Roles, permissions and Workflows. */
export const ADMIN_ROLE_KEY = "admin";

/**
 * The Roles whose holders may assign and revoke Roles.
 *
 * Ordered as the Owner stated them. Admin is included because an administrator who could define the
 * Admin Role but not grant it could not onboard the second administrator, which is the same
 * unrecoverable corner this file exists to avoid.
 */
export const ROLE_ASSIGNMENT_ROLE_KEYS: readonly string[] = Object.freeze([
  "owner",
  "generalManager",
  ADMIN_ROLE_KEY,
]);

/**
 * Roles that ordinary configuration may not delete or strip of their administering authority.
 *
 * `protected: true` on the record is the stored flag; this is the list the seed marks. The store and
 * the commands both refuse to violate it, in that order, so a writer that skipped the command still
 * cannot leave the platform unadministrable.
 */
export const PROTECTED_ROLE_KEYS: readonly string[] = Object.freeze([ADMIN_ROLE_KEY, "owner"]);

export type AdministrationAction =
  | "editObjectDefinition"
  | "editRoleDefinition"
  | "editWorkflowDefinition"
  | "assignRole";

/**
 * Does this principal hold the authority for this administration action?
 *
 * Takes the Role KEYS the principal actually holds -- resolved from qualifying, active, non-stale
 * assignments by the access resolver. An empty list is a refusal; there is no default-allow branch
 * and no "if we cannot tell, permit" fallback.
 */
export function hasAdministrationAuthority(
  heldRoleKeys: readonly string[] | null | undefined,
  action: AdministrationAction,
): boolean {
  if (!Array.isArray(heldRoleKeys) || heldRoleKeys.length === 0) return false;
  const held = new Set(heldRoleKeys.filter((k): k is string => typeof k === "string" && k.length > 0));
  if (action === "assignRole") return ROLE_ASSIGNMENT_ROLE_KEYS.some((k) => held.has(k));
  return held.has(ADMIN_ROLE_KEY);
}

/** Thrown by every command whose actor lacks the authority. Never carries policy detail. */
export class AdministrationDeniedError extends Error {
  constructor(action: AdministrationAction) {
    super(`not authorized to perform "${action}"`);
  }
}

export function requireAdministrationAuthority(
  heldRoleKeys: readonly string[] | null | undefined,
  action: AdministrationAction,
): void {
  if (!hasAdministrationAuthority(heldRoleKeys, action)) throw new AdministrationDeniedError(action);
}

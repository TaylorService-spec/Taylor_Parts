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

// ════════════════════ CAPABILITY-GOVERNED WORKFLOW ADMINISTRATION ════════════════════
//
// Owner ruling: Workflow Administration becomes capability-governed, and the invariant above stops
// being the normal authorization decision. It does NOT stop existing -- it becomes an ANTI-LOCKOUT
// SAFETY GUARD, which is a different job:
//
//     AUTHORIZATION     may this principal do this?          the canonical Object capability
//     SAFETY INVARIANT  may this change leave the platform   refuses a mutation regardless of
//                       unadministrable?                     how well authorized it was
//
// THE INVARIANT NEVER GRANTS. Holding `admin` is not a substitute for the capability, which is the
// whole point of the ruling: if the Role key could still authorize, the capability model would be
// decorative and the two authorities would drift exactly as objectPermissionMap.js drifted from
// eos_policy.capabilities.
//
// ORDER IS DELIBERATE: capability first, safety second. An unauthorized caller learns only that it
// is unauthorized -- telling it "that would remove the last administrator" reports the shape of the
// tenant's access configuration to someone with no authority over it.
//
// NOT WIRED IN THIS SLICE. This is the metadata/vocabulary slice; `requireAdministrationAuthority`
// above remains the live decision, so no runtime authorization changes here. The keys below are
// registered in eos_policy.capabilities by migration 1761350400000 and are granted to NO Role yet.

export type WorkflowAdministrationAction =
  | "create" | "read" | "edit" | "version" | "publish" | "bindRole";

/** The canonical capability for each workflow configuration action that EXISTS today. */
export const WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION:
  Readonly<Record<WorkflowAdministrationAction, string>> = Object.freeze({
    create: "workflowDefinition.create",
    read: "workflowDefinition.read",
    edit: "workflowDefinition.edit",
    version: "workflowDefinition.version",
    publish: "workflowDefinition.publish",
    bindRole: "workflowDefinition.bindRole",
  });

export type WorkflowAdministrationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly refusal: "CAPABILITY_MISSING" }
  | { readonly allowed: false; readonly refusal: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH" };

export interface WorkflowAdministrationAttempt {
  /** Effective capability keys, resolved through role_capabilities. NEVER Role keys. */
  readonly capabilities: ReadonlySet<string> | null | undefined;
  readonly action: WorkflowAdministrationAction;
  /**
   * Server-derived: would applying this mutation leave no principal able to administer Workflow?
   * A caller cannot supply it as a claim -- it is computed from the stored policy.
   */
  readonly wouldRemoveLastAdministrationPath: boolean;
}

export function decideWorkflowAdministration(
  attempt: WorkflowAdministrationAttempt,
): WorkflowAdministrationDecision {
  const required = WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION[attempt.action];
  const held = attempt.capabilities;
  if (!(held instanceof Set) || !held.has(required)) {
    return Object.freeze({ allowed: false, refusal: "CAPABILITY_MISSING" as const });
  }
  if (attempt.wouldRemoveLastAdministrationPath) {
    return Object.freeze({ allowed: false, refusal: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH" as const });
  }
  return Object.freeze({ allowed: true as const });
}

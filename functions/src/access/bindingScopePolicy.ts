// Binding-scope policy -- ONE governed answer to ONE question (Owner ruling R-32, 2026-09-01):
//
//     may THIS Role's grant of THIS Permission be conferred from an assignment at THIS scope type?
//
// Both enforcement points resolve it HERE. `resolveEffectivePermission` asks it per candidate
// assignment (authoritative, because assignments predating R-32 already exist in Firestore and
// grant-time checks never see them); `grantRole` asks it per requested Role+scope (defence in
// depth, so an assignment that could confer nothing is refused rather than created). Two
// implementations of one predicate would agree today and drift later, and the drift would be
// silent in the direction that matters -- a grant-time check that permits what resolution refuses,
// or worse, the reverse.
//
// ============================ WHAT THIS IS NOT ============================
//
// It is NOT a second scope matcher. `scopeMatches()` answers a different question -- does this
// assignment's scope cover the TARGET being acted on -- and R-32 §3 forbids touching it. This
// module never inspects a target, never reads a scope VALUE, and cannot widen anything: it only
// removes a candidate that `scopeMatches()` would otherwise have accepted.
//
//     scopeMatches   : does the assignment reach this target?
//     this module    : is the assignment's KIND of scope legitimate for this binding at all?
//
// ============================ WHY THE POLICY IS PER BINDING ============================
//
// Measured in 2C.2, and it is the whole reason this module exists rather than a field on
// Permission. `inventory.transaction.read` is carried by EIGHTEEN Roles and
// `inventory.catalog.read` by eighteen -- salesperson, controller, accountingManager,
// financeManager, shopAssociate, partsAssociate among them -- every one legitimately global. The
// same capability id is global on salesperson and location-required on a manager. Declaring it
// location-required on the CAPABILITY would break seventeen unrelated Roles in order to constrain
// one, so the policy is keyed by (Role, PermissionId) exactly as `conditionsByPermission` is.
//
// ============================ FAIL-CLOSED, BUT NOT FAIL-RESTRICTIVE ============================
//
// A malformed declaration denies (an entry that is not an array of strings cannot be satisfied).
// An ABSENT declaration allows -- that is not a gap, it is the compatibility contract R-32 §1
// requires: absent must mean current behaviour exactly, which is why admin, dispatcher and the
// thirty-eight Roles that declare nothing are unaffected by this module existing.
//
// PURE. No Firestore, no clock, no throwing -- every malformed input resolves to a decision.
import type { Role, PermissionId, ScopeType } from "../types/access";

/**
 * The one binding-scope decision. Never throws.
 *
 * @param role the Role whose grant is being tested -- the binding's left half.
 * @param permissionId the capability being conferred -- the binding's right half.
 * @param assignmentScopeType the `Scope.type` of the RoleAssignment offering to confer it.
 * @returns true when the binding permits that kind of assignment.
 */
export function bindingAllowsAssignmentScope(
  role: Role | null | undefined,
  permissionId: PermissionId,
  assignmentScopeType: unknown,
): boolean {
  if (role === null || typeof role !== "object") return false;
  if (typeof permissionId !== "string" || permissionId.length === 0) return false;
  if (typeof assignmentScopeType !== "string" || assignmentScopeType.length === 0) return false;

  const policy = role.scopesByPermission;
  // No policy map at all, or no entry for this permission: unrestricted, exactly as before R-32.
  if (policy === null || typeof policy !== "object") return true;
  const allowed = policy[permissionId];
  if (allowed === undefined) return true;

  // A declared-but-malformed entry is a denial, not an escape hatch. An empty list is a
  // deliberate "this binding confers nothing from any scope" and is honoured as written.
  if (!Array.isArray(allowed)) return false;
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
export function roleHasAnyBindingAtAssignmentScope(
  role: Role | null | undefined,
  assignmentScopeType: unknown,
): boolean {
  if (role === null || typeof role !== "object") return false;
  if (!Array.isArray(role.permissions)) return false;
  return role.permissions.some((permissionId) =>
    bindingAllowsAssignmentScope(role, permissionId, assignmentScopeType),
  );
}

/** The governed refusal reason `grantRole` raises. Stable: it is quoted in audit and in tests. */
export const NO_BINDING_AT_SCOPE_REASON = "roleHasNoBindingAtRequestedScope";

// Wave 7 extension, PART 4 -- Operational-Role Condition Resolver.
//
// GAP THIS CLOSES: resolveEffectivePermission.ts (Issue #226) has evaluated
// a `operationalRoleActive` ConditionKind since its own introduction, but no
// Cloud Function has EVER supplied a populated `ConditionContext.
// operationalRoleActive` resolver -- every real caller (effectiveAccessFeed.ts,
// partMasterCommands.ts, savedDefinitionCommands.ts, reportExecutionService.ts,
// receivingCallableWiring.ts, trustedWriterCommands.ts) has always passed
// `condition: {}`. Because the ConditionKind is declared OPTIONAL and the
// switch in resolveEffectivePermission.ts's evaluateConditions() treats a
// missing function as `return false`, this is fail-closed by construction
// (DENY, never a silent ALLOW) -- but it also means the nine
// operationalRoleActive-conditioned capabilities on TECHNICIAN_ROLE
// (compatibilityRoles.ts) have never actually been reachable through the
// governed resolver for ANY principal, active operational role or not.
//
// This module builds that resolver ONCE, as shared authorization
// infrastructure, so it can be wired into the canonical resolver path
// (effectiveAccessFeed.ts) without being copied into individual domains.
//
// LINKAGE CONTRACT -- reused, not reinvented. Operational-role state lives
// on `employees/{employeeId}` documents (`userId`, `employmentStatus`,
// `operationalRoles`); the reciprocal-link contract this module mirrors is
// the SAME one already used in two other places in this codebase:
//   1. firestore.rules's `isActiveOperationalRole(role)` (~line 112):
//        let employeeId = linkedEmployeeId();              // users/{uid}.employeeId
//        let employee = get(employees/{employeeId}).data;
//        isSignedIn()
//          && employeeId != null
//          && employee.userId == request.auth.uid           // reciprocal link
//          && employee.employmentStatus == "ACTIVE"
//          && employee.operationalRoles is list
//          && employee.operationalRoles.hasAny([role]);
//   2. functions/src/access/adminCredentialCommands.ts's
//      `resolveEmployeeLinkFacts()` (~line 289): the SAME
//      `users/{uid}.employeeId` -> `employees/{employeeId}.userId === uid`
//      reciprocal contract, expressed as a pure fact-resolution function
//      over already-fetched raw document values -- this module's own
//      `evaluateOperationalRoleActive()` follows that exact shape (pure,
//      given raw facts) for the same testability reason.
// No alias fields (`employees.authUid` / `employees.uid`) are accepted --
// same posture as both precedents above.
//
// FAIL CLOSED, per failure mode (mirrors isActiveOperationalRole()
// EXACTLY, term for term):
//   - `role` argument not a non-empty string                -> false
//   - `uid` not a non-empty string                           -> false (alwaysFalse resolver)
//   - `users/{uid}.employeeId` missing / not a string / ""    -> false (no employeeId -> employeeId != null fails)
//   - `employees/{employeeId}` does not exist (deleted/stale) -> false
//   - `employees/{employeeId}.userId !== uid`                 -> false (non-reciprocal link)
//   - `employees/{employeeId}.employmentStatus !== "ACTIVE"`  -> false (any other status, including
//     ON_LEAVE/INACTIVE/TERMINATED/RETIRED/CONTRACTOR/missing/non-string)
//   - `employees/{employeeId}.operationalRoles` missing / not an array -> false (`is list` mirror)
//   - `role` not present in `operationalRoles` (wrong value, wrong type entries) -> false (`hasAny` mirror
//     via `Array.prototype.includes`, same exact-equality semantics as Rules' `hasAny([role])`)
//   - ANY Firestore read failure (network, permission, emulator hiccup) -> false for every role, never
//     a thrown/rejected promise into the caller's authorization path (`buildOperationalRoleActiveResolver*`
//     wrap every read in try/catch and resolve to the always-false closure on any error)
//
// CLIENT NON-ASSERTION: the role set returned here comes ONLY from the
// server-read `employees/{employeeId}` document (Admin SDK, this module's own
// reads) -- it is never taken from request payload, custom claims, or any
// other client-suppliable input. Callers pass only a trusted `uid` (already
// sourced from `request.auth.uid` upstream, e.g. effectiveAccessFeed.ts) and
// receive back a closure; the closure itself carries no client-controlled
// state.
import type { Firestore } from "firebase-admin/firestore";

const USERS_COLLECTION = "users";
const EMPLOYEES_COLLECTION = "employees";
const ACTIVE_EMPLOYMENT_STATUS = "ACTIVE";

// Always-false resolver -- the fail-closed terminal value returned whenever
// any precondition in the chain above is not met. A single shared constant
// (not reconstructed per call) so every deny path is provably identical.
const ALWAYS_FALSE: (role: string) => boolean = () => false;

// PURE. Raw, already-fetched document facts -- no Firestore access, no
// throwing. Mirrors adminCredentialCommands.ts's resolveEmployeeLinkFacts()
// input shape, extended with the operational-role list this module actually
// needs to answer `operationalRoleActive(role)`.
export interface OperationalRoleResolutionFacts {
  uid: string;
  userEmployeeId: unknown; // users/{uid}.employeeId
  employeeExists: boolean; // employees/{employeeId} document exists
  employeeUserId: unknown; // employees/{employeeId}.userId (authoritative back-link)
  employeeEmploymentStatus: unknown; // employees/{employeeId}.employmentStatus
  employeeOperationalRoles: unknown; // employees/{employeeId}.operationalRoles
}

// PURE. Byte-for-byte mirror of firestore.rules's isActiveOperationalRole(role):
// reciprocal link + ACTIVE employment + operationalRoles list membership.
// Never throws -- every malformed/missing input resolves to `false`.
export function evaluateOperationalRoleActive(
  facts: OperationalRoleResolutionFacts,
  role: unknown,
): boolean {
  if (typeof role !== "string" || role.length === 0) return false;
  if (typeof facts.uid !== "string" || facts.uid.length === 0) return false;

  const employeeId =
    typeof facts.userEmployeeId === "string" && facts.userEmployeeId.length > 0
      ? facts.userEmployeeId
      : null;
  if (employeeId === null) return false;

  if (!facts.employeeExists) return false;
  // GOVERNED reciprocal field ONLY -- exact match, no alias fields.
  if (facts.employeeUserId !== facts.uid) return false;
  if (facts.employeeEmploymentStatus !== ACTIVE_EMPLOYMENT_STATUS) return false;
  if (!Array.isArray(facts.employeeOperationalRoles)) return false;

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
async function resolveFactsFromEmployeeId(
  db: Firestore,
  uid: string,
  userEmployeeId: unknown,
): Promise<OperationalRoleResolutionFacts> {
  const employeeId =
    typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
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
    ? (employeeSnap.data() as Record<string, unknown> | undefined)
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
export async function buildOperationalRoleActiveResolverFromEmployeeId(
  db: Firestore,
  uid: string,
  userEmployeeId: unknown,
): Promise<(role: string) => boolean> {
  if (typeof uid !== "string" || uid.length === 0) return ALWAYS_FALSE;
  try {
    const facts = await resolveFactsFromEmployeeId(db, uid, userEmployeeId);
    return (role: string) => {
      try {
        return evaluateOperationalRoleActive(facts, role);
      } catch {
        return false;
      }
    };
  } catch {
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
export async function buildOperationalRoleActiveResolver(
  db: Firestore,
  uid: string,
): Promise<(role: string) => boolean> {
  if (typeof uid !== "string" || uid.length === 0) return ALWAYS_FALSE;
  try {
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    const userEmployeeId = userSnap.exists
      ? (userSnap.data() as Record<string, unknown> | undefined)?.employeeId
      : undefined;
    return buildOperationalRoleActiveResolverFromEmployeeId(db, uid, userEmployeeId);
  } catch {
    return ALWAYS_FALSE;
  }
}

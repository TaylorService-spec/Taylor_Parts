import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import { buildEmployeeSessionResult } from "./employeeSessionResult";

export { buildEmployeeSessionResult };

// "Which employee am I" -- the LAST question the browser answered by reading Firestore directly.
//
// ════════════════════ WHAT THIS USED TO DO, AND WHY IT COULD NOT STAY ════════════════════
//
// Two client reads: users/{uid} for the role and employeeId, then employees/{employeeId} for the
// operational identity. The second one was admitted by a Rules clause that let any authenticated
// user read the Employee document whose id matched their own users/{uid}.employeeId.
//
// That clause is gone. The one surviving direct Employee grant is the PARTS_MANAGER
// assignment-candidate picker, and widening it to a general own-Employee self-read was explicitly
// refused: a self-read predicate over a business collection is still Firestore deciding who may
// read a business record, which is the arrangement this whole workstream removes. So the resolution
// moved server-side.
//
// ════════════════════ THE AUTHORITY MODEL ════════════════════
//
// The callable requires AUTHENTICATION AND NOTHING ELSE. It is deliberately not gated on
// workforce.directory.read -- that capability reads OTHER PEOPLE, and requiring it here would mean
// a technician could not learn their own name. It is identity bootstrap, not a directory read and
// not a configurable permission: there is nothing to configure, because the answer is fixed by who
// is signed in.
//
// THE CALLER SAYS NOTHING. No uid, no employeeId, no role, no operationalRoles, no employmentStatus
// crosses the wire -- the payload is empty. The server takes request.auth.uid, reads that
// principal's own linkage, and returns one projection.
//
// ════════════════════ THE LEGACY ROLE ════════════════════
//
// `role` is still carried, for the client's nav gating and display, and IT IS NOT AUTHORIZATION.
// No trusted command and no read service consults users/{uid}.role -- functions/test/
// legacyRoleIsNotAuthority.test.mjs is the structural proof, and it exists so this field cannot
// quietly become a rule again on the way to being deleted.
const CALLABLE = "resolveCurrentEmployeeSession";

/**
 * @param uid  The signed-in principal, kept ONLY so the caller's intent stays explicit at the call
 *             site and so a mismatched generation is obvious in AuthContext. It is not sent: the
 *             server would ignore it, because a uid supplied by the browser is a claim, not a fact.
 */
export async function resolveEmployeeSession(uid) {
  if (!uid) return buildEmployeeSessionResult(null, null, null);
  // Throws on failure, exactly as the Firestore reads did. AuthContext catches it and clears the
  // whole identity rather than letting a failed resolution look like an account with no roles.
  const res = await httpsCallable(functions, CALLABLE)({});
  const d = res?.data ?? {};
  return {
    role: d.role ?? null,
    employeeId: d.employeeId ?? null,
    displayName: d.displayName ?? null,
    operationalRoles: Array.isArray(d.operationalRoles) ? d.operationalRoles : [],
    employmentStatus: d.employmentStatus ?? null,
  };
}

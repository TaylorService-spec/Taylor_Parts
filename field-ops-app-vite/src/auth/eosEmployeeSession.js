// SESSION IDENTITY FROM EOS FOR A FIREBASE-SIGNED-IN PERSON -- Firebase exit F1 (DECISIONS #244).
//
// auth/employeeSession.js answers { role, employeeId, displayName, operationalRoles, employmentStatus } from two
// Firestore reads (users/{uid}, employees/{employeeId}). Where an EOS API is declared this answers the same shape from
// EOS instead, with the person still signed in through Firebase Auth (the ID token is only the bearer; the server
// resolves the Principal from it):
//
//   resolveMyExperienceContext  -> employeeId (the Employee linked to this Principal; null = unlinked)
//   readMyEmployeeProfile       -> displayName, employmentStatus (EMP-RT-07; no capability needed)
//
// NO LEGACY FIELDS. `role` is null and there is no legacy role list -- the same shape an EOS-login session already has
// (auth/eosSessionIdentity.js). What `role` used to decide is decided by EOS capabilities (access/sessionAccess.js).
//
// AN UNLINKED PRINCIPAL IS A NULL IDENTITY, NOT AN ERROR. Firestore silently returned nulls for a user with no
// employee link; the EOS read refuses the same person (404 no link, 409 ambiguous, 412 unresolved). Surfacing those as
// identityError would show the retry panel to every unlinked person. They map to the null identity. A refusal of the
// Principal itself (403) is also an answer, not a fault. Only an unreachable / failing / malformed service throws, and
// AuthContext renders that as the retryable identity error, never a default role.
import { EOS_EXPERIENCE_OPERATION } from "./eosSessionIdentity.js";

export const READ_MY_EMPLOYEE_PROFILE_OPERATION = "readMyEmployeeProfile";

/** HTTP-derived failure categories (the Operations / Workforce clients share them) that are ANSWERS about the person. */
const UNLINKED_PROFILE = new Set(["NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"]);
const REFUSED_PRINCIPAL = new Set(["FORBIDDEN"]);

// No legacy role list is returned at all: AuthContext holds the empty list for an EOS-sourced session (scope and eligibility are the server's).
const NO_IDENTITY = Object.freeze({ role: null, employeeId: null, displayName: null, employmentStatus: null });

function fault(outcome, what) {
  const err = new Error(outcome?.message ?? `${what} could not be read`);
  err.code = outcome?.reason ?? outcome?.code ?? "EOS_SESSION_UNRESOLVED";
  return err;
}

/**
 * @param {{ operations: { call: Function }, workforce: { call: Function } }} clients  the two transport seams
 * @returns {Promise<{ role: null, employeeId: string|null, displayName: string|null, employmentStatus: string|null }>}
 * @throws Error with `.code` when EOS cannot answer
 */
export async function resolveEosEmployeeSession({ operations, workforce }) {
  const experience = await operations.call(EOS_EXPERIENCE_OPERATION);
  if (!experience?.ok) {
    if (REFUSED_PRINCIPAL.has(experience?.code)) return NO_IDENTITY;
    throw fault(experience, "the EOS experience context");
  }
  const ctx = experience.result;
  if (!ctx || typeof ctx !== "object" || (ctx.employeeId !== null && typeof ctx.employeeId !== "string")) {
    throw fault({ code: "MALFORMED_RESULT", message: "the EOS experience context was malformed" }, "the EOS experience context");
  }
  const employeeId = ctx.employeeId ?? null;
  if (employeeId === null) return NO_IDENTITY;

  const profile = await workforce.call(READ_MY_EMPLOYEE_PROFILE_OPERATION);
  if (!profile?.ok) {
    if (UNLINKED_PROFILE.has(profile?.code) || REFUSED_PRINCIPAL.has(profile?.code)) {
      return { ...NO_IDENTITY, employeeId };
    }
    throw fault(profile, "the EOS employee profile");
  }
  const employee = profile.result?.employee;
  return {
    role: null,
    employeeId,
    displayName: typeof employee?.displayName === "string" && employee.displayName.length > 0 ? employee.displayName : null,
    employmentStatus: typeof employee?.employmentStatus === "string" ? employee.employmentStatus : null,
  };
}

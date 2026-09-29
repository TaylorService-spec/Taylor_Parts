// IDENTITY RESOLUTION FOR AN EOS SESSION -- from the EOS API, never from Firebase or Firestore.
// docs/architecture/eos-identity-session-foundation.md, section 3(e).
//
// A plain .js module (AuthContext.jsx holds JSX), so the resolution is directly testable. It asks the EOS
// API for the caller's own experience context (`resolveMyExperienceContext`), which the server resolves
// through the SAME identity binding, Principal status, membership and DQ-007 employment gate as every other
// request, and returns the session identity AuthContext exposes.
//
// NO FRONTEND ROLE MAP: `role` stays null for an EOS session. Surfaces come from the server's experience
// context; nothing here derives authority from a Security Role key.
export const EOS_EXPERIENCE_OPERATION = "resolveMyExperienceContext";

/**
 * @param {{ call: (operation: string) => Promise<object> }} client  the Operations API seam
 * @returns {Promise<{ principalId: string, employeeId: string|null, tenantId: string|null, role: null,
 *   displayName: null, employmentStatus: null }>}  (AuthContext supplies the empty legacy lists itself)
 * @throws Error with `.code` when the server refuses or cannot be reached
 */
export async function resolveEosSessionIdentity(client) {
  const result = await client.call(EOS_EXPERIENCE_OPERATION);
  if (!result?.ok || !result.result || typeof result.result.principalId !== "string") {
    const err = new Error(result?.message ?? "the EOS session could not be resolved");
    err.code = result?.reason ?? result?.code ?? "EOS_SESSION_UNRESOLVED";
    throw err;
  }
  const ctx = result.result;
  return Object.freeze({
    principalId: ctx.principalId,
    tenantId: typeof ctx.tenantId === "string" ? ctx.tenantId : null,
    employeeId: typeof ctx.employeeId === "string" ? ctx.employeeId : null,
    role: null,
    displayName: null,
    // The server already refused an ineligible Employee (EMPLOYEE_NOT_ACCESS_ELIGIBLE) -- a resolved EOS
    // session is therefore an access-eligible one. The legacy status string is not re-derived here.
    employmentStatus: null,
  });
}

/** The `user` object AuthContext exposes for an EOS session. `uid` is the EOS subject, never a Firebase uid. */
export function eosSessionUser(session) {
  return Object.freeze({
    uid: session.subject,
    identitySource: "eos",
    getIdToken: async () => session.token,
  });
}

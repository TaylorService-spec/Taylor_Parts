// THE ADMINISTRATION CONTROL PLANE, from the browser: one thin, named seam over `POST /admin/policy`.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 8.
//
//   Admin UI -> THIS -> callPolicyApi -> EOS trusted API -> governed PostgreSQL -> the shared server evaluator
//
// WHAT IT IS. A named wrapper per control-plane operation, each sending exactly the input the server's
// dispatcher reads, and returning the server's envelope untouched: `{ ok: true, data }` or
// `{ ok: false, code, message }`. A screen names what it wants rather than a string literal.
//
// WHAT IT IS NOT. It holds no policy and decides nothing. It does not validate a reason, a key or a
// condition locally -- a blank reason is the SERVER's REASON_REQUIRED, an unsupported condition is the
// SERVER's CONDITION_INVALID, and a client that answered first would be a second authority. It never
// touches Firebase: Security Role assignment is PostgreSQL `assignRole` / `revokeRole`, never the
// retired `assignApprovedRole` callable.
//
// explainEffectiveAccess IS SPECIFIED, NOT YET SERVED (contract section 8, "Specified, not
// implemented"). Its name is NOT added to the closed operation list in adminPolicyApiClient.js here,
// because that list mirrors the server's exactly and the server does not serve it on this base. Until
// it does, `callPolicyApi` answers UNKNOWN_OPERATION locally and the Effective Access panel renders its
// honest UNAVAILABLE state. The day the server lane adds the name to both lists, this wrapper starts
// reaching the server with no change here.
import { callPolicyApi } from "./adminPolicyApiClient.js";

/** Build the seam over any `call(operation, input)` with callPolicyApi's envelope -- injectable for tests. */
export function createAdminControlPlaneClient(call = callPolicyApi) {
  const send = (operation, input) => Promise.resolve(call(operation, input ?? {}))
    .catch(() => ({ ok: false, code: "UNREACHABLE", message: "the Administration API could not be reached" }));
  return Object.freeze({
    // ── reads (gate: admin.securityPolicy.read / admin.principalAccess.read / audit.event.read, on the server)
    listObjectsWithActions: () => send("listObjectsWithActions", {}),
    listRoles: () => send("listRoles", {}),
    getObjectActionGrantMatrix: (objectKey) => send("getObjectActionGrantMatrix", { objectKey }),
    getSecurityRoleDetail: (roleKey) => send("getSecurityRoleDetail", { roleKey }),
    listRoleCapabilityDecisionHistory: ({ roleKey, capabilityKey, limit } = {}) => send("listRoleCapabilityDecisionHistory", {
      ...(roleKey ? { roleKey } : {}),
      ...(capabilityKey ? { capabilityKey } : {}),
      ...(limit ? { limit } : {}),
    }),
    listPrincipalRoleAssignments: (principalId) => send("listPrincipalRoleAssignments", { principalId }),
    readPolicyAuditHistory: ({ limit } = {}) => send("readPolicyAuditHistory", limit ? { limit } : {}),
    explainEffectiveAccess: (principalId) => send("explainEffectiveAccess", { principalId }),

    // ── mutations (gate: admin.securityPolicy.write; assignRole/revokeRole: admin.roleAssignment.write)
    grantObjectActionToRole: ({ objectKey, actionKey, roleKey, reason, condition, requiresCondition }) =>
      send("grantObjectActionToRole", {
        objectKey, actionKey, roleKey, reason,
        ...(condition ? { condition } : {}),
        ...(requiresCondition ? { requiresCondition: true } : {}),
      }),
    revokeObjectActionFromRole: ({ objectKey, actionKey, roleKey, reason }) =>
      send("revokeObjectActionFromRole", { objectKey, actionKey, roleKey, reason }),
    setGrantCondition: ({ objectKey, actionKey, roleKey, condition, reason }) =>
      send("setGrantCondition", { objectKey, actionKey, roleKey, condition, reason }),
    retireGrantCondition: ({ objectKey, actionKey, roleKey, reason }) =>
      send("retireGrantCondition", { objectKey, actionKey, roleKey, reason }),
    assignRole: ({ principalId, roleId, reason }) => send("assignRole", { principalId, roleId, reason }),
    revokeRole: ({ assignmentId, reason }) => send("revokeRole", { assignmentId, reason }),
  });
}

/** The production seam. */
export const adminControlPlaneClient = createAdminControlPlaneClient();

/** The server (or this client's mirror of the server's list) does not know the operation: a real state. */
export const isOperationUnavailable = (result) => Boolean(result && result.ok === false && result.code === "UNKNOWN_OPERATION");

/**
 * The server's refusal, VERBATIM: its code and its message. A screen never rewrites a refusal into
 * softer words -- `CONFLICT: CONDITION_RETIREMENT_WOULD_WIDEN ...` is what the administrator needs.
 */
export function refusalText(result) {
  if (!result || result.ok) return null;
  const code = typeof result.code === "string" ? result.code : "INTERNAL";
  const message = typeof result.message === "string" && result.message.length > 0 ? result.message : "the request could not be completed";
  return `${code}: ${message}`;
}

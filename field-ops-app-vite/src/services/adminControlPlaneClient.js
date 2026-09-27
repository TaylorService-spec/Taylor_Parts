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
// explainEffectiveAccess IS SERVED (server lane CP-S, contract section 8). It is decided by the same
// runtime evaluator (resolveOperationalContextForPrincipal + authorizeOperationalAction), and is on the
// closed operation list in adminPolicyApiClient.js. If a server that predates it answers
// UNKNOWN_OPERATION, the Effective Access panel renders its honest UNAVAILABLE state and never falls
// back to a client-side interpretation.
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
    // The server's condition vocabulary (kinds, parameters, record kinds, applicable capabilities).
    // NOT YET in the server's closed operation list on this base, so it is deliberately absent from
    // the client's mirror too: callPolicyApi answers UNKNOWN_OPERATION locally and the condition
    // picker renders DISABLED -- never a local copy. When the server lane adds the name to both lists,
    // this wrapper reaches it with no change here.
    listSupportedConditionKinds: () => send("listSupportedConditionKinds", {}),
    // Lane SC: the assignment scopes the runtime decides -- per scope type its label and THIS tenant's governed
    // values; per Role which scopes it may be assigned at and what each confers or leaves inert.
    listSupportedAssignmentScopes: (roleKey) => send("listSupportedAssignmentScopes", roleKey ? { roleKey } : {}),

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
    // A scope is sent only when one was chosen; a global assignment sends exactly what it always did.
    assignRole: ({ principalId, roleId, reason, scopeType, scopeValue }) => send("assignRole", {
      principalId, roleId, reason,
      ...(scopeType && scopeType !== "global" ? { scopeType, scopeValue } : {}),
    }),
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

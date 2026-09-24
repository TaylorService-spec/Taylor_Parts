// The browser's ONLY route to the EOS policy store.
//
// ════════════════════ WHAT THIS FILE IS ALLOWED TO BE ════════════════════
//
//   browser -> THIS -> EOS trusted API -> authorization -> DAL -> PostgreSQL
//
// and never:
//
//   browser -> PostgreSQL
//   browser -> Firestore, for policy
//   browser -> fetch every Role's policy and decide access for itself
//
// It sends a NAME and an INPUT and gets back what was PERSISTED. It holds no policy, makes no
// authorization decision, and has no idea what any operation means -- which is the point. A client
// that could decide anything would be a second authorization model, and the one that matters lives
// on the server.
//
// ════════════════════ THE BROWSER IS NOT THE SOURCE OF TRUTH ════════════════════
//
// Nothing here caches a mutation's result as though it were state. Every mutation returns the
// canonical persisted record and every caller is expected to re-read; showing a user their own
// request back is how a UI reports success for a change the server refused.
//
// ════════════════════ NOT CONFIGURED IS A REAL STATE ════════════════════
//
// `VITE_EOS_API_BASE_URL` may be absent, and when it is the answer is NOT CONFIGURED -- distinct
// from an error, and distinct from an empty result. A screen that showed "no objects" when it simply
// had nowhere to ask would be lying quietly.
//
// CORRECTED (Wave 7 / Lane AD). This comment used to say the variable was "absent in every
// environment today, because no EOS API is deployed". Both halves are false and had been since
// 2026-09-10: the EOS API is deployed at `https://eos-api-nonprod.onrender.com`, and the variable is
// set in the Vercel non-production project and inlined into that bundle. The address is now recorded
// in config/environments.json (`eosApi`, which records and never supplies) so the repository can
// state it instead of a comment going stale again. It is still absent for a local or production
// build, so NOT CONFIGURED remains a state this client must report honestly -- which is the part of
// the original paragraph that was always the point.
import { auth } from "../firebase/firebase.js";

/** The operations the server accepts. Mirrored so a typo fails here rather than as a 404. */
export const ADMIN_READ_OPERATIONS = Object.freeze([
  "listTenantPrincipals",
  "listObjects",
  "readObjectWithFields",
  "listRoles",
  "readRolePolicy",
  "listPrincipalRoleAssignments",
  // Object-owned security reads. Three projections of ONE server authority --
  // Object -> actions -> grantees, Role -> objects -> actions, Principal -> roles and direct
  // grants -> effective access -- plus the Object/action inventory the first two are read against.
  // Mirrored from the server, which resolves them in PostgreSQL. Nothing here derives access.
  "listObjectsWithActions",
  "getObjectSecurityMatrix",
  "getRoleSecurity",
  "getPrincipalEffectiveAccess",
  "listWorkflows",
  "readWorkflowVersion",
  "readPolicyAuditHistory",
]);

export const ADMIN_MUTATION_OPERATIONS = Object.freeze([
  "updateObjectMetadata",
  "createCustomField",
  "updateCustomFieldMetadata",
  "createRole",
  "updateRole",
  "setObjectPermission",
  "setFieldPermissionOverride",
  "removeFieldPermissionOverride",
  "assignRole",
  "revokeRole",
  // Object-owned grants. The contract is objectKey + actionKey + grantee, never a capability key.
  // NAMED SO THE CLOSED LIST KEEPS MIRRORING THE SERVER, and called by nothing: this tranche wires
  // the READS only. A name in this list confers no authority -- the server checks every one.
  "grantObjectActionToRole",
  "revokeObjectActionFromRole",
  "grantObjectActionToPrincipal",
  "revokeObjectActionFromPrincipal",
  "createWorkflowDraft",
  "createWorkflowVersion",
  "updateWorkflowDefinition",
  "setWorkflowRoleBinding",
  "publishWorkflowVersion",
]);

const ALL_OPERATIONS = new Set([...ADMIN_READ_OPERATIONS, ...ADMIN_MUTATION_OPERATIONS]);

/** Is this a name the server would recognise? */
export const isAdminOperation = (name) => typeof name === "string" && ALL_OPERATIONS.has(name);

/**
 * Where the EOS API is, or null.
 *
 * Read at CALL TIME rather than at module load, so a test can set it and so importing this module
 * never depends on when it happens -- the same lesson `config/env.js` records about lazy routes.
 */
export function policyApiBaseUrl() {
  const raw = typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_EOS_API_BASE_URL
    : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return null;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export const isPolicyApiConfigured = () => policyApiBaseUrl() !== null;

/** Every failure a caller can act on differently. `NOT_CONFIGURED` is not an error, it is a state. */
export const POLICY_API_FAILURES = Object.freeze([
  "NOT_CONFIGURED",
  "NOT_SIGNED_IN",
  "UNKNOWN_OPERATION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL",
  "UNREACHABLE",
]);

const failure = (code, message) => Object.freeze({ ok: false, code, message });

/**
 * Call one named Administration operation.
 *
 * Returns `{ ok: true, data, tenantId }` or `{ ok: false, code, message }`. It does NOT throw for a
 * refusal: a screen has to render "you may not do that" differently from "the network is down", and
 * making both an exception forces every caller to re-derive the difference from a message string.
 */
export async function callPolicyApi(operation, input = {}, options = {}) {
  if (!isAdminOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not an Administration operation`);
  }

  const base = options.baseUrl ?? policyApiBaseUrl();
  if (!base) {
    return failure(
      "NOT_CONFIGURED",
      "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)",
    );
  }

  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : currentIdToken());
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Administration API");

  // The transport is injectable for the same reason the token and base URL are: the envelope has to
  // be provable without a network. Production passes nothing and gets the global fetch.
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}/admin/policy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        // The tenant a client MAY state. The server checks it against membership and refuses
        // rather than adopting it, so sending it can never widen what this browser reaches.
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
        ...(options.requestId ? { "x-request-id": options.requestId } : {}),
      },
      body: JSON.stringify({ operation, input }),
      signal: options.signal,
    });
  } catch (err) {
    // A network failure is not a refusal. Reporting it as one would tell an administrator they lack
    // authority they actually have.
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "the Administration API could not be reached");
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!body || typeof body !== "object") {
    return failure("INTERNAL", `the Administration API returned ${response.status}`);
  }
  if (body.ok === true) {
    return Object.freeze({ ok: true, data: body.data, tenantId: body.tenantId, operation });
  }
  return failure(
    POLICY_API_FAILURES.includes(body.code) ? body.code : "INTERNAL",
    typeof body.message === "string" ? body.message : "the request could not be completed",
  );
}

/**
 * The signed-in user's ID token.
 *
 * The ONLY thing this client takes from the identity provider. No claim it carries is read as
 * authority -- the server resolves the principal, the tenant and the Roles from PostgreSQL, and a
 * token that said otherwise would not be believed.
 */
export async function currentIdToken() {
  const user = auth?.currentUser ?? null;
  if (!user) return null;
  return user.getIdToken();
}

// ════════════════════ THE OBJECT-OWNED SECURITY READS ════════════════════
//
// Four named wrappers over the SAME `POST /admin/policy` envelope -- no second endpoint, no second
// auth scheme, no reshaping. Each sends the operation name and the input the server's dispatcher
// requires, and returns the server's own `data` untouched inside this client's result envelope.
//
// They exist so a screen names what it wants rather than a string literal, and so a wrong input key
// is a diff in ONE file instead of an INVALID_INPUT at run time on four screens.
//
// WHAT THEY DELIBERATELY DO NOT DO
//
//   they do not validate the key locally -- a missing objectKey is the SERVER's INVALID_INPUT, and a
//     client that answered first would be deciding something
//   they do not default a refusal to an empty list -- NOT_CONFIGURED, FORBIDDEN and NOT_FOUND all
//     reach the caller as themselves, because a screen that renders "nobody holds this action" for a
//     read it was refused is lying about the tenant's security
//   they do not merge, cache or cross-reference the four answers -- that would be a fifth projection
//     the server never computed

/**
 * Every Object this tenant registered, each with the actions the canonical metadata says it governs.
 *
 * Takes no input. An Object with no capability still comes back, with an empty `actions` array:
 * "nothing governs this yet" is a fact an administrator needs, not a row to hide.
 */
export function listObjectsWithActions(options = {}) {
  return callPolicyApi("listObjectsWithActions", {}, options);
}

/**
 * OBJECT VIEW. One Object, every action it governs, and who holds each -- Roles AND Principals.
 *
 * `{ objectKey, label, supportsDelete, actions }`, where each action carries `roleKeys` and
 * `principalIds`. An action nobody holds is an empty row rather than an absent one.
 */
export function getObjectSecurityMatrix(objectKey, options = {}) {
  return callPolicyApi("getObjectSecurityMatrix", { objectKey }, options);
}

/** ROLE VIEW. `{ roleKey, name, objects }` -- the same grants, grouped Role -> Object -> actions. */
export function getRoleSecurity(roleKey, options = {}) {
  return callPolicyApi("getRoleSecurity", { roleKey }, options);
}

/**
 * PRINCIPAL VIEW. `{ principalId, roles, directGrants, effective, objects }`.
 *
 * `effective` keeps provenance per capability (ROLE, DIRECT or ROLE_AND_DIRECT) because revoking a
 * Role and revoking a direct grant are different acts. Work Eligibility, Operational Scope and the
 * linked Employee are absent from this payload BY THE SERVER'S DESIGN -- they are subordinate
 * constraints answered elsewhere, and this client must not fold a business fact in beside a grant.
 */
export function getPrincipalEffectiveAccess(principalId, options = {}) {
  return callPolicyApi("getPrincipalEffectiveAccess", { principalId }, options);
}

/** The injectable seam a hook or screen takes, so a test can stand in for the whole read model. */
export const adminSecurityReads = Object.freeze({
  listObjectsWithActions,
  getObjectSecurityMatrix,
  getRoleSecurity,
  getPrincipalEffectiveAccess,
});

/** A failure a person can read, without repeating what the screen already says. */
export function describePolicyFailure(result) {
  if (!result || result.ok) return null;
  switch (result.code) {
    case "NOT_CONFIGURED":
      return "The EOS policy service is not configured for this environment, so Administration is read-only here.";
    case "NOT_SIGNED_IN":
      return "Sign in to reach the Administration service.";
    case "UNAUTHENTICATED":
      return "EOS does not recognise this identity. An administrator has to add you to a tenant first.";
    case "FORBIDDEN":
      return result.message || "You do not hold the authority for this change.";
    case "UNREACHABLE":
      return "The Administration service could not be reached. Nothing was changed.";
    case "CONFLICT":
      return result.message || "That change conflicts with what is already stored.";
    default:
      return result.message || "The change could not be completed.";
  }
}

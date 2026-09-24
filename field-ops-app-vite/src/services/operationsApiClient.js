// The browser's route to the governed PostgreSQL OPERATIONS reads.
//
//   browser -> THIS -> POST /operations/{inventory|experience} (EOS trusted API, functions/src/eosOps/eosOpsHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + Role capabilities
//              + linked Employee + Work Eligibility + Operational Scope -> PostgreSQL
//
// ════════════════════ ONE AUTH SCHEME, REUSED -- AGAIN ════════════════════
//
// Base URL (VITE_EOS_API_BASE_URL) and the signed-in user's ID token come from the SAME seam the
// Administration and Workforce clients use (services/adminPolicyApiClient.js). The token is
// transitional session identity only: no claim in it is read, and nothing here states a tenant, a
// principal, a role or a capability. The server resolves all of that.
//
// ════════════════════ NO FALLBACK. NOT ANYWHERE IN THIS FILE ════════════════════
//
// A refused, misconfigured or unreachable read is RETURNED as a value the caller renders. It is
// never retried against Firestore, never softened into a default experience, and never allowed to
// mean "assume the legacy role". The whole point of this transport is that when it cannot answer,
// the answer is visibly nothing -- fail closed and say so.
//
// ════════════════════ THE CLOSED LIST ════════════════════
//
// Mirrored from the server's OPERATIONS_READ_OPERATIONS and OPERATIONS_ROUTE_BY_OPERATION, so a typo
// fails here rather than as a 404, and so the route a request goes to is derived rather than typed.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";

/** operation -> route. Mirrors functions/src/eosOps/eosOpsHttp.ts OPERATIONS_ROUTE_BY_OPERATION. */
export const OPERATIONS_ROUTE_BY_OPERATION = Object.freeze({
  resolveMyCapabilities: "/operations/inventory",
  resolveMyExperienceContext: "/operations/experience",
});

export const OPERATIONS_READ_OPERATIONS = Object.freeze(Object.keys(OPERATIONS_ROUTE_BY_OPERATION).sort());

export const isOperationsOperation = (name) =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(OPERATIONS_ROUTE_BY_OPERATION, name);

/** Every failure category a screen renders differently. Same vocabulary as the Workforce client. */
export const OPERATIONS_FAILURES = Object.freeze([
  "NOT_CONFIGURED",
  "NOT_SIGNED_IN",
  "UNKNOWN_OPERATION",
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL",
  "UNREACHABLE",
]);

const CATEGORY_BY_STATUS = Object.freeze({
  400: "INVALID_INPUT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "UNKNOWN_OPERATION",
  413: "INVALID_INPUT",
});

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Map an HTTP status and the server's body code to one failure category. Pure; exported for tests. */
export function operationsFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION") return "UNKNOWN_OPERATION";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

/**
 * Call one named Operations read.
 *
 * Returns `{ ok: true, operation, result }` or `{ ok: false, code, reason, status, message }`. It
 * never throws. `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl -- all injectable so the
 * envelope can be proven without a network or a browser.
 */
export async function callOperationsApi(operation, options = {}) {
  if (!isOperationsOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not an Operations operation`);
  }
  const rawBase = options.baseUrl === undefined ? policyApiBaseUrl() : options.baseUrl;
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) {
    return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");
  }

  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : currentIdToken());
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Operations service");

  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${OPERATIONS_ROUTE_BY_OPERATION[operation]}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
      },
      body: JSON.stringify({ operation }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "the Operations service could not be reached");
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body && body.ok === true) {
    return Object.freeze({ ok: true, operation, result: body.result });
  }
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(
    operationsFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Operations service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam hooks take. */
export const operationsApiClient = Object.freeze({ call: callOperationsApi });

// The browser's route to the governed PostgreSQL Employee (Workforce) reads and commands.
//
//   browser -> THIS -> POST /workforce/employees (EOS trusted API, functions/src/eosWorkforce/workforceHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// and never browser -> Firestore for Employee business data, with no fallback of any kind: a refused or failed
// read or command is returned as a value the screen renders, never papered over with another source -- and never
// retried against another writer.
//
// ════════════════════ ONE AUTH SCHEME, REUSED ════════════════════
//
// The base URL (VITE_EOS_API_BASE_URL) and the signed-in user's ID token are taken from the existing
// Administration API client (services/adminPolicyApiClient.js), which is the one EOS trusted-API seam this
// application already has. The token is transitional identity only; no claim in it is read here. The tenant
// may be stated through `x-eos-tenant`, which the server checks against membership and never adopts.
//
// ════════════════════ THE CLOSED LIST ════════════════════
//
// Mirrored from the server's WORKFORCE_READ_OPERATIONS and WORKFORCE_COMMAND_OPERATIONS so a typo fails here rather
// than as a 404. The three commands (EMP-RT-W1B) are the governed Employee writers the Administration editor uses:
// the seventeen profile facts, and the reporting relationship established or ended. Every one requires
// admin.employeeProfile.write, which the SERVER checks; nothing here states tenant, principal or capabilities.
// EMP-RT-05 (assigned work), EMP-RT-08 (Job Role) and any Employee lifecycle / status writer are NOT served by the
// server and are not names here.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";

export const WORKFORCE_ROUTE = "/workforce/employees";

export const WORKFORCE_READ_OPERATIONS = Object.freeze([
  "readMyEmployeeProfile",
  "readEmployee",
  "listEmployees",
  "readEmployeePrincipalLink",
  "listManagedEmployees",
  "listRecordsOwnedByEmployee",
  "listAccountabilitiesForEmployee",
]);

export const WORKFORCE_COMMAND_OPERATIONS = Object.freeze([
  "updateEmployeeProfile",
  "establishReportingRelationship",
  "endReportingRelationship",
]);

/** Operations whose input may be omitted (the server's WORKFORCE_OPTIONAL_INPUT_OPERATIONS). */
export const WORKFORCE_OPTIONAL_INPUT_OPERATIONS = Object.freeze(["readMyEmployeeProfile", "listEmployees"]);

const OPERATIONS = new Set([...WORKFORCE_READ_OPERATIONS, ...WORKFORCE_COMMAND_OPERATIONS]);
export const isWorkforceOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

/**
 * Every failure category a screen renders differently. `reason` on a failure carries the server's own
 * specific code (e.g. EMPLOYEE_NOT_FOUND, CAPABILITY_REQUIRED, EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND).
 */
export const WORKFORCE_FAILURES = Object.freeze([
  "NOT_CONFIGURED",
  "NOT_SIGNED_IN",
  "UNKNOWN_OPERATION",
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "INTERNAL",
  "UNREACHABLE",
]);

const CATEGORY_BY_STATUS = Object.freeze({
  400: "INVALID_INPUT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  412: "PRECONDITION_FAILED",
  413: "INVALID_INPUT",
});

const failure = (code, message, extra = {}) => Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Map an HTTP status and the server's body code to one failure category. Pure; exported for tests. */
export function workforceFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION" || serverCode === "METHOD_NOT_ALLOWED") return "UNKNOWN_OPERATION";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

/**
 * Call one named Workforce read or command.
 *
 * Returns `{ ok: true, result, operation }` or `{ ok: false, code, reason, status, message }`. It never throws.
 * `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl -- all injectable so the envelope can be proven.
 */
export async function callWorkforceApi(operation, input = undefined, options = {}) {
  if (!isWorkforceOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not a Workforce operation`);
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
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Workforce service");

  const envelope = input === undefined ? { operation } : { operation, input };
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${WORKFORCE_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
      },
      body: JSON.stringify(envelope),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "the Workforce service could not be reached");
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
    workforceFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Workforce service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam pages and hooks take. */
export const workforceApiClient = Object.freeze({ call: callWorkforceApi });

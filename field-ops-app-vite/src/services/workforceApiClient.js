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
// changeEmploymentStatus / changeOperatingCompany (EMP-RT-W2) are served and named so the list mirrors the server;
// no screen calls them yet (UI wiring follows the server proof). The EMP-RT-08 Job Role reads (listJobRoles,
// listEmployeeJobRoleHistory, listEmployeesWithoutJobRole) and commands (createJobRole, updateJobRole,
// assignEmployeeJobRole) are served and named the same way; the Administration Employee record and Users directory
// use the three reads and assignEmployeeJobRole (admin.employeeJobRole.write). No screen maintains the catalog yet.
// listEmployeeChangeHistory (EMP-RT-H1, employee.record.read) is the governed Employee change history the Administration
// Employee record renders; the actor's name is included only when the SERVER finds admin.principalAccess.read. EMP-RT-05 (assigned work) is NOT served and not a name here.
// readMyWorkforceCapabilities (finding #17) answers which Workforce controls the CALLER may be offered, from the same
// PostgreSQL capabilities the commands re-check (hooks/useWorkforceCapabilities.js); it takes no input.
// The operationalRoles decomposition (step C) adds the WORK ELIGIBILITY reads/commands
// (admin.employeeWorkEligibility.write) and the OPERATIONAL SCOPE reads/commands
// (admin.employeeOperationalScope.write). They are served and named here so the list keeps mirroring the server; no
// screen calls them yet, exactly as EMP-RT-W2 was named ahead of its UI. Qualification and warehouse scope are
// SEPARATE authorities and separate capabilities: neither grants the other, and neither grants application access.
// listAssignableEmployees (step G, employee.record.read) answers "who may be offered work of this kind" from the
// governed PostgreSQL authorities. It is served and named here ahead of the client cutover; the legacy Firestore
// buildAssignableEmployeesQuery is still what the pickers call until that separate PR lands.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";

export const WORKFORCE_ROUTE = "/workforce/employees";

export const WORKFORCE_READ_OPERATIONS = Object.freeze([
  "readMyEmployeeProfile",
  "readMyWorkforceCapabilities",
  "readEmployee",
  "listEmployees",
  "readEmployeePrincipalLink",
  "listManagedEmployees",
  "listRecordsOwnedByEmployee",
  "listAccountabilitiesForEmployee",
  "listJobRoles",
  "listEmployeeJobRoleHistory",
  "listEmployeesWithoutJobRole",
  "listEmployeeChangeHistory",
  "listEmployeeWorkEligibility",
  "listEmployeeWorkEligibilityHistory",
  "listEmployeeOperationalScopes",
  "listEmployeeOperationalScopeHistory",
  "listAssignableEmployees",
]);

export const WORKFORCE_COMMAND_OPERATIONS = Object.freeze([
  "updateEmployeeProfile",
  "establishReportingRelationship",
  "endReportingRelationship",
  "saveEmployeeEdit",
  "changeEmploymentStatus",
  "changeOperatingCompany",
  "createJobRole",
  "updateJobRole",
  "assignEmployeeJobRole",
  "assignEmployeeWorkEligibility",
  "endEmployeeWorkEligibility",
  "assignEmployeeOperationalScope",
  "endEmployeeOperationalScope",
  // Lane BT: the governed PostgreSQL Employee administration commands. Named here for the same reason
  // changeEmploymentStatus was -- the server serves them, so the browser's vocabulary must mirror the
  // server's or a typo becomes a 404. No screen calls them yet; UI wiring follows the server proof.
  // Each requires admin.employeeProfile.write, which the SERVER checks. Creating an Employee creates no
  // authority: no Security Role, no Job Role, no Work Eligibility, no Operational Scope.
  "createEmployee",
  "linkEmployeePrincipal",
  "unlinkEmployeePrincipal",
  "relinkEmployeePrincipal",
]);

/** Operations whose input may be omitted (the server's WORKFORCE_OPTIONAL_INPUT_OPERATIONS). */
export const WORKFORCE_OPTIONAL_INPUT_OPERATIONS = Object.freeze(["readMyEmployeeProfile", "readMyWorkforceCapabilities", "listEmployees"]);

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

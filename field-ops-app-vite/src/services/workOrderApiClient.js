// The browser's route to the governed PostgreSQL Work Order authority.
//
//   browser -> THIS -> POST /operations/work-orders (EOS trusted API, functions/src/eosOps/eosOpsHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// and never browser -> Firestore `fieldops_wos`, and never browser -> a Work Order Firebase callable
// (createWorkOrder / transitionWorkOrder / updateWorkOrderExecutionData / setWorkOrderPartsPlan /
// listWorkOrderConsumptionSources). There is no fallback of any kind: a refused or failed read or
// command is returned as a value the screen renders, never papered over with another source.
//
// ════════════════════ FAIL-CLOSED READINESS (DQ-S4) ════════════════════
//
// While the server's Work Order authority is INACTIVE, every operation except
// `readWorkOrderAuthorityStatus` answers 503 { code: "NOT_ACTIVATED" }. That is mapped here to its OWN
// category, NOT_ACTIVATED, so a screen renders NOT_YET_ACTIVATED -- not an outage, not an error, and not
// an empty list pretending there is no work. `readWorkOrderAuthorityStatus` answers even while inactive,
// so a screen can ask up front instead of guessing.
//
// ════════════════════ WHO IS "MY" WORK ════════════════════
//
// The technician's own Work Orders come ONLY from `listMyAssignedWorkOrders`: the server resolves the
// caller to an EMPLOYEE through an active employee_principal_link. The browser never compares a uid or a
// fieldops_technicians id to decide whose work is whose.
//
// The base URL (VITE_EOS_API_BASE_URL) and the signed-in user's ID token come from the existing
// Administration API client -- the one EOS trusted-API seam this application has. The tenant may be
// stated through `x-eos-tenant`, which the server checks against membership and never adopts.
//
// The Administration client is loaded LAZILY, and only when a caller did not inject `baseUrl` /
// `getIdToken`: it initializes Firebase Auth at import time, and this module (with the service and the
// adapter above it) must stay importable in plain node, where the contract tests run.
const loadAdminClient = () => import("./adminPolicyApiClient.js");

export const WORK_ORDER_ROUTE = "/operations/work-orders";

/** Mirrors the server's WORK_ORDER_READ_OPERATIONS (functions/src/eosOps/workOrderOperations.ts). */
export const WORK_ORDER_READ_OPERATIONS = Object.freeze([
  "readWorkOrderAuthorityStatus",
  "readWorkOrder",
  "listWorkOrders",
  "listMyAssignedWorkOrders",
  "listWorkOrderTechnicians",
  // The tenant's ACTIVE operating companies with an ACTIVE key binding -- the governed choice a create
  // states (workOrder.create). Never inferred.
  "listWorkOrderOperatingCompanies",
  // The completion pass (2026-09-30).
  "readTechnicianAvailability",
  "findAvailableTechnicianSlots",
  "readWorkOrderLabor",
  "readWorkOrderFieldContext",
  "readWorkOrderReadiness",
  "readTechnicianExecutionStats",
  "readWorkOrderConsumptionSnapshot",
  "readTechnicianVolumeBreakdown",
  // Customer self-scheduling (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
  "listSelfSchedulingPolicies",
  "readSelfSchedulingSessions",
]);

/** Mirrors every other key of the server's EOS_WORK_ORDER_OPERATIONS, in the server's order. */
export const WORK_ORDER_COMMAND_OPERATIONS = Object.freeze([
  "createWorkOrder",
  "markWorkOrderReady",
  "scheduleWorkOrder",
  "unscheduleWorkOrder",
  "rescheduleWorkOrder",
  "dispatchWorkOrder",
  "closeWorkOrder",
  "cancelWorkOrder",
  "setWorkOrderPartsPlan",
  "acceptWorkOrder",
  "startWorkOrderTravel",
  "arriveAtWorkOrder",
  "startWorkOrderWork",
  "recordWorkOrderExecution",
  "completeWorkOrder",
  "setTechnicianWorkingHours",
  "recordTechnicianUnavailability",
  "endTechnicianUnavailability",
  "recordWorkOrderLabor",
  "setWorkOrderEstimatedDuration",
  "saveSelfSchedulingPolicy",
  "issueSelfSchedulingLink",
  "revokeSelfSchedulingLink",
]);

const OPERATIONS = new Set([...WORK_ORDER_READ_OPERATIONS, ...WORK_ORDER_COMMAND_OPERATIONS]);
export const isWorkOrderOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

/** The server's list bound (WORK_ORDER_LIST_MAX). A list read never asks for more. */
export const WORK_ORDER_LIST_MAX = 200;

/**
 * Every failure category a screen renders differently. `reason` carries the server's own specific code
 * (NOT_ACTIVATED, START_IN_PAST, SCHEDULE_CONFLICT, DOUBLE_BOOKED, NOT_ASSIGNED, CAPABILITY_MISSING,
 * STALE_WORK_ORDER_STATE, REASSIGN_REASON_REQUIRED, ...), so a screen can say WHY.
 */
export const WORK_ORDER_FAILURES = Object.freeze([
  "NOT_CONFIGURED",
  "NOT_SIGNED_IN",
  "UNKNOWN_OPERATION",
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "NOT_ACTIVATED",
  "UNAVAILABLE",
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
  503: "UNAVAILABLE",
});

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/**
 * Map an HTTP status and the server's body code to one failure category. Pure; exported for tests.
 *
 * 503 carries two different answers: NOT_ACTIVATED (the authority is not switched on yet -- a readiness
 * state) and UNAVAILABLE (a dependency authority is down, e.g. SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE).
 * Only the former is NOT_ACTIVATED.
 */
export function workOrderFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION" || serverCode === "METHOD_NOT_ALLOWED") return "UNKNOWN_OPERATION";
  if (serverCode === "NOT_ACTIVATED") return "NOT_ACTIVATED";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

/**
 * Call one named Work Order read or command.
 *
 * Returns `{ ok: true, result, operation }` or `{ ok: false, code, reason, status, message }`.
 * It never throws. `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl.
 *
 * @param {string} operation
 * @param {Record<string, unknown>} [input]
 * @param {Record<string, unknown>} [options]
 */
export async function callWorkOrderApi(operation, input = undefined, options = {}) {
  if (!isWorkOrderOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not a Work Order operation`);
  }
  let admin = null;
  if (options.baseUrl === undefined || !options.getIdToken) {
    try {
      admin = await loadAdminClient();
    } catch {
      admin = null;
    }
  }
  let rawBase;
  try {
    rawBase = options.baseUrl === undefined ? (admin ? admin.policyApiBaseUrl() : null) : options.baseUrl;
  } catch {
    rawBase = null;
  }
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) {
    return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");
  }

  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : admin ? admin.currentIdToken() : null);
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Work Order service");

  const envelope = input === undefined ? { operation } : { operation, input };
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${WORK_ORDER_ROUTE}`, {
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
    return failure("UNREACHABLE", "the Work Order service could not be reached");
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
    workOrderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Work Order service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam services and hooks take. */
export const workOrderApiClient = Object.freeze({ call: callWorkOrderApi });

// ─────────────────────────────── readiness ───────────────────────────────

/** The three answers a screen renders, plus the two it renders while it does not know yet. */
export const WORK_ORDER_READINESS = Object.freeze({
  LOADING: "LOADING",
  ACTIVE: "ACTIVE",
  NOT_YET_ACTIVATED: "NOT_YET_ACTIVATED",
  UNAVAILABLE: "UNAVAILABLE",
});

export const WORK_ORDER_NOT_YET_ACTIVATED_MESSAGE =
  "Work Orders are not yet activated on EOS (NOT_YET_ACTIVATED). Nothing is shown here until the governed Work Order authority is switched on.";

/**
 * Ask the server whether its Work Order authority is active. Never throws.
 *
 * Returns `{ readiness, postgres, failure }`. Any answer other than an explicit ACTIVE is fail-closed:
 * an explicit NOT_YET_ACTIVATED is NOT_YET_ACTIVATED; a failed read is UNAVAILABLE (never ACTIVE).
 */
export async function readWorkOrderAuthorityStatus(client = workOrderApiClient) {
  const res = await client.call("readWorkOrderAuthorityStatus", {});
  if (!res.ok) {
    if (res.code === "NOT_ACTIVATED") {
      return Object.freeze({ readiness: WORK_ORDER_READINESS.NOT_YET_ACTIVATED, postgres: "INACTIVE", failure: null });
    }
    return Object.freeze({ readiness: WORK_ORDER_READINESS.UNAVAILABLE, postgres: null, failure: res });
  }
  const readiness = res.result?.readiness === "ACTIVE" && res.result?.postgres === "ACTIVE"
    ? WORK_ORDER_READINESS.ACTIVE
    : WORK_ORDER_READINESS.NOT_YET_ACTIVATED;
  return Object.freeze({ readiness, postgres: res.result?.postgres ?? null, failure: null });
}

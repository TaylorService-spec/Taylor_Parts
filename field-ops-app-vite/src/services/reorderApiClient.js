// The browser's route to the governed PostgreSQL Reorder authority.
//
//   browser -> THIS -> POST /operations/inventory (EOS trusted API, functions/src/eosOps/eosOpsHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// and never browser -> Firestore for Reorder business data, with no fallback of any kind: a refused or
// failed read or command is returned as a value the screen renders, never papered over with another
// source, and never retried against another writer.
//
// ════════════════════ WHY THIS EXISTS: THE ASSIGNEE SEAM ════════════════════
//
// The legacy client decided who could act on a Reorder by comparing `user.uid` to the document's
// `assignedToUserId`, and read "my work" with `where(assignedToUserId == uid)`. A Firebase uid is
// not an Employee, so that comparison could only ever be right by coincidence of provisioning.
//
// Through this client the question is never asked in the browser at all. The server resolves the
// caller to an EMPLOYEE through an active employee_principal_link and compares Employee to Employee,
// inside the transaction that writes. The screen renders the answer; it does not compute it.
//
// ════════════════════ ONE AUTH SCHEME, REUSED ════════════════════
//
// The base URL (VITE_EOS_API_BASE_URL) and the signed-in user's ID token come from the existing
// Administration API client, which is the one EOS trusted-API seam this application has. The token is
// transitional identity only; no claim in it is read here. The tenant may be stated through
// `x-eos-tenant`, which the server checks against membership and never adopts.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";

export const REORDER_ROUTE = "/operations/inventory";

/** Mirrors the server's OPERATIONS_READ_OPERATIONS, so a typo fails here rather than as a 404. */
export const REORDER_READ_OPERATIONS = Object.freeze([
  "readReorderQueue",
  "readMyAssignedReorders",
  "readReorderRequest",
  "readMyReorderHistory",
  "listReorderWarehouseOptions",
]);

/** Mirrors the server's OPERATIONS_MUTATION_OPERATIONS. */
export const REORDER_COMMAND_OPERATIONS = Object.freeze([
  "createReorderRequest",
  "reviewReorderRequest",
  "assignReorderRequest",
  "startPurchasingOnReorder",
  "postPurchasingUpdate",
  "markReorderReceived",
  "cancelReorderRequest",
  "recordReorderPurchaseOrder",
  "voidReorderPurchaseOrder",
]);

/** Reads that take no input. */
export const REORDER_OPTIONAL_INPUT_OPERATIONS = Object.freeze([
  "readReorderQueue",
  "readMyAssignedReorders",
  "readMyReorderHistory",
  "listReorderWarehouseOptions",
]);

const OPERATIONS = new Set([...REORDER_READ_OPERATIONS, ...REORDER_COMMAND_OPERATIONS]);
export const isReorderOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

/**
 * Every failure category a screen renders differently. `reason` carries the server's own specific
 * code (NOT_THE_ASSIGNEE, CAPABILITY_REQUIRED, STATUS_NOT_STARTABLE, WAREHOUSE_NOT_IN_TENANT, ...),
 * so a screen can say WHY rather than "something went wrong".
 */
export const REORDER_FAILURES = Object.freeze([
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

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Map an HTTP status and the server's body code to one failure category. Pure; exported for tests. */
export function reorderFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION" || serverCode === "METHOD_NOT_ALLOWED") return "UNKNOWN_OPERATION";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

/**
 * Call one named Reorder read or command.
 *
 * Returns `{ ok: true, result, operation }` or `{ ok: false, code, reason, status, message }`.
 * It never throws. `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl.
 *
 * @param {string} operation
 * @param {Record<string, unknown>} [input]
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<{ok: true, operation: string, result: unknown} | {ok: false, code: string, message: string, reason: string|null, status: number|null}>}
 */
export async function callReorderApi(operation, input = undefined, options = {}) {
  if (!isReorderOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not a Reorder operation`);
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
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Reorder service");

  const envelope = input === undefined ? { operation } : { operation, input };
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${REORDER_ROUTE}`, {
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
    return failure("UNREACHABLE", "the Reorder service could not be reached");
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
    reorderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Reorder service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam pages and hooks take. */
export const reorderApiClient = Object.freeze({ call: callReorderApi });

/**
 * Which warehouses may this caller raise a reorder for?
 *
 * WAS a Firebase callable (`listReorderWarehouseOptions`). The question and the three-way answer are
 * unchanged; the authority moved. The server scopes it to the caller's own Employee through their
 * governed WAREHOUSE operational scope, so the browser names no identity and no warehouse.
 *
 * Returns `{ options: [{ value, label }], reason }`. An empty list with a `reason` is a REAL ANSWER,
 * not an error: a principal may legitimately be governed to no warehouse at all, and the selector
 * renders that differently from a failed read.
 *
 * THROWS on refusal, because the hook's catch is what turns a failed read into a visible error
 * state -- returning an empty list here would render as "no warehouses exist".
 */
export async function fetchReorderWarehouseOptions(client = reorderApiClient) {
  const res = await client.call("listReorderWarehouseOptions");
  if (!res.ok) {
    const err = new Error(res.message ?? "the reorder warehouse options could not be read");
    err.code = res.reason ?? res.code;
    throw err;
  }
  const options = Array.isArray(res.result?.options) ? res.result.options : [];
  return {
    // Mapped to the selector's { value, label } shape here rather than in the component, so the
    // component stays presentational and the wire shape stays the server's business.
    options: options
      .filter((o) => typeof o?.warehouseId === "string" && o.warehouseId !== "")
      .map((o) => ({ value: o.warehouseId, label: typeof o.label === "string" && o.label !== "" ? o.label : o.warehouseId })),
    reason: typeof res.result?.reason === "string" ? res.result.reason : null,
  };
}

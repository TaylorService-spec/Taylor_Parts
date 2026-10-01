// THE ONE BROWSER SEAM TO THE EOS OPERATIONS TRANSPORT, BY ROUTE.
//
//   browser -> THIS -> POST /operations/<route> (functions/src/eosOps/eosOpsHttp.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities + scope -> PostgreSQL
//
// The Reorder client (reorderApiClient.js) proved the scheme for /operations/inventory; this is the same scheme with
// the route as a parameter, so Placement, Relocation, Transfer and Cycle Count reach PostgreSQL through ONE transport
// instead of five copies of the auth plumbing (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// NO FALLBACK OF ANY KIND. A refusal -- including NOT_ACTIVATED -- is the platform's answer and is returned (or thrown)
// as that answer. It is never retried against Firebase: an EOS refusal is a business / security result, not an outage
// to route around.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";

export const EOS_OPERATIONS_ROUTES = Object.freeze({
  INVENTORY: "/operations/inventory",
  PLACEMENT: "/operations/placement",
  RELOCATION: "/operations/relocation",
  TRANSFER: "/operations/transfer",
  CYCLE_COUNT: "/operations/cycle-count",
  SERIALIZED_ASSET: "/operations/serialized-asset",
});
const KNOWN_ROUTES = new Set(Object.values(EOS_OPERATIONS_ROUTES));

const CATEGORY_BY_STATUS = Object.freeze({
  400: "INVALID_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT",
  412: "PRECONDITION_FAILED", 413: "INVALID_INPUT", 503: "NOT_ACTIVATED",
});

/** Map an HTTP status and the server's body code to one failure category. Pure; exported for tests. */
export function eosFailureCategory(status, serverCode) {
  if (serverCode === "UNKNOWN_OPERATION" || serverCode === "METHOD_NOT_ALLOWED") return "UNKNOWN_OPERATION";
  if (serverCode === "NOT_ACTIVATED") return "NOT_ACTIVATED";
  return CATEGORY_BY_STATUS[status] ?? "INTERNAL";
}

const failure = (code, message, extra = {}) => Object.freeze({
  ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null,
  ...(extra.details && typeof extra.details === "object" ? { details: Object.freeze({ ...extra.details }) } : {}),
});

/**
 * Call one named operation on one EOS operations route. Never throws.
 * Returns `{ ok: true, operation, result }` or `{ ok: false, code, reason, status, message, details? }`.
 * `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl, serviceLabel.
 */
export async function callEosOperation(route, operation, input = undefined, options = {}) {
  const label = options.serviceLabel ?? "the EOS service";
  if (!KNOWN_ROUTES.has(route)) return failure("UNKNOWN_OPERATION", `"${route}" is not an EOS operations route`);
  if (typeof operation !== "string" || operation.trim() === "") return failure("UNKNOWN_OPERATION", "an operation name is required");
  const rawBase = options.baseUrl === undefined ? policyApiBaseUrl() : options.baseUrl;
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");

  let token;
  try { token = await (options.getIdToken ? options.getIdToken() : currentIdToken()); } catch { token = null; }
  if (!token) return failure("NOT_SIGNED_IN", `sign in to reach ${label}`);

  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}),
      },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", `${label} could not be reached`);
  }

  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.ok && body && body.ok === true) return Object.freeze({ ok: true, operation, result: body.result });
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(
    eosFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `${label} returned ${response.status}`,
    { reason: serverCode, status: response.status, details: body && body.details },
  );
}

// ════════════════════ the THROWING seam the existing warehouse screens were written against ════════════════════
//
// The screens (scan workflows, Transfers, Cycle Counts) and the offline executor classify a thrown error by a
// TRANSPORT code (`permission-denied`, `failed-precondition`, `unavailable`, ...) plus a business code in
// `details.code`. The same translation the Work Order route already uses (offline/workOrderSyncError.js): the category
// becomes the transport code that means the same thing, and the server's specific code is `details.code`.
// NOT_ACTIVATED (the EOS writer is not switched on in this environment) is NOT a connectivity problem: retrying will
// not change it, so it must not sit in an offline queue looking like "pending". It is `failed-precondition` -- shown,
// never queued, never retried -- and its own `details.code` lets every screen say "not switched on yet" in so many
// words.
const TRANSPORT_BY_CATEGORY = Object.freeze({
  INVALID_INPUT: "invalid-argument",
  FORBIDDEN: "permission-denied",
  UNAUTHENTICATED: "unauthenticated",
  NOT_SIGNED_IN: "unauthenticated",
  NOT_FOUND: "not-found",
  CONFLICT: "failed-precondition",
  PRECONDITION_FAILED: "failed-precondition",
  NOT_ACTIVATED: "failed-precondition",
  UNREACHABLE: "unavailable",
  NOT_CONFIGURED: "unavailable",
  UNKNOWN_OPERATION: "internal",
  INTERNAL: "internal",
});

export class EosOperationError extends Error {
  constructor(res) {
    super(res.message ?? "the EOS operation was refused");
    this.name = "EosOperationError";
    this.category = res.code;
    this.code = TRANSPORT_BY_CATEGORY[res.code] ?? "internal";
    // The server's specific code (IDEMPOTENCY_CONFLICT, OUTSIDE_OPERATIONAL_SCOPE, NOT_ACTIVATED, ...).
    this.details = { ...(res.details ?? {}), code: res.code === "NOT_ACTIVATED" ? "NOT_ACTIVATED" : (res.reason ?? res.code) };
    this.status = res.status ?? null;
  }
}

/** True when a thrown or returned failure is the platform saying the EOS writer is not switched on yet. */
export const isNotActivated = (err) => err?.category === "NOT_ACTIVATED" || err?.code === "NOT_ACTIVATED" || err?.details?.code === "NOT_ACTIVATED";

/** Call and return the result, or THROW an EosOperationError carrying the refusal. */
export async function eosOperationOrThrow(route, operation, input = undefined, options = {}) {
  const res = await callEosOperation(route, operation, input, options);
  if (!res.ok) throw new EosOperationError(res);
  return res.result;
}

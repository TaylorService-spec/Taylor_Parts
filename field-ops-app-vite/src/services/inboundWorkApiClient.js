// The browser's route to the governed PostgreSQL Inbound Work intake (Owner ruling W9, 2026-09-30).
//
//   browser -> THIS -> POST /operations/inbound-work (EOS trusted API, functions/src/eosOps/inboundWorkOperations.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// and never browser -> a Firebase Inbound Work callable. The review queue, the detail read and the three decisions
// (listInboundWork / getInboundWorkRequest / acceptInboundWork / declineInboundWork / attachInboundWorkToWorkOrder /
// getInboundWorkAttachment) no longer have a client caller. Accept creates the Work Order through the governed EOS
// Work Order create; there is no Firebase fallback of any kind.
//
// FAIL-CLOSED READINESS. The route is served by the Work Order executor, so while the Work Order authority is
// INACTIVE every operation except `readWorkOrderAuthorityStatus` answers 503 NOT_ACTIVATED. That maps to its own
// category and the screen says NOT_YET_ACTIVATED -- never an outage, never an empty queue.
//
// It never throws. The base URL and the signed-in user's token come from the same seam workOrderApiClient uses.
import { callWorkOrderApi, workOrderFailureCategory } from "./workOrderApiClient.js";

const loadAdminClient = () => import("./adminPolicyApiClient.js");

export const INBOUND_WORK_ROUTE = "/operations/inbound-work";

/** Mirrors the server's INBOUND_WORK_READ_OPERATIONS (functions/src/eosOps/inboundWorkOperations.ts). */
export const INBOUND_WORK_READ_OPERATIONS = Object.freeze([
  "readWorkOrderAuthorityStatus",
  "readInboundWorkAccess",
  "listInboundWork",
  "readInboundWorkRequest",
  "readInboundIntakeConfiguration",
  "readInboundProviderReadiness",
  "readInboundAttachment",
  "listInboundRecoveryTargets",
]);

/** Mirrors every other key of the server's EOS_INBOUND_WORK_OPERATIONS. */
export const INBOUND_WORK_COMMAND_OPERATIONS = Object.freeze([
  "acceptInboundWork",
  "declineInboundWork",
  "attachInboundWork",
  "saveInboundMailbox",
  "saveInboundRoutingRule",
  "deliverInboundMessage",
  // The EOS provider runtime (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
  "saveInboundConnection",
  "startInboundConnectionAuthorization",
  "completeInboundConnectionAuthorization",
  "testInboundConnection",
  "disconnectInboundConnection",
  "pollInboundMailboxNow",
  "retryInboundDelivery",
  // Recovery of an unfinished accept claim.
  "releaseInboundWork",
  "reassignInboundWork",
]);

const OPERATIONS = new Set([...INBOUND_WORK_READ_OPERATIONS, ...INBOUND_WORK_COMMAND_OPERATIONS]);
export const isInboundWorkOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/**
 * Call one named Inbound Work read or command. Returns `{ ok: true, result, operation }` or
 * `{ ok: false, code, reason, status, message }`; `code` is a workOrderFailureCategory (NOT_ACTIVATED included).
 * `options`: baseUrl, getIdToken, tenantId, signal, fetchImpl.
 */
export async function callInboundWorkApi(operation, input = undefined, options = {}) {
  if (!isInboundWorkOperation(operation)) {
    return failure("UNKNOWN_OPERATION", `"${operation}" is not an Inbound Work operation`);
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
  if (!base) return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");

  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : admin ? admin.currentIdToken() : null);
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach the Inbound Work service");

  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");

  let response;
  try {
    response = await doFetch(`${base}${INBOUND_WORK_ROUTE}`, {
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
    return failure("UNREACHABLE", "the Inbound Work service could not be reached");
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body && body.ok === true) return Object.freeze({ ok: true, operation, result: body.result });
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(
    workOrderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `the Inbound Work service returned ${response.status}`,
    { reason: serverCode, status: response.status },
  );
}

/** The injectable seam. */
export const inboundWorkApiClient = Object.freeze({ call: callInboundWorkApi });

// ─────────────────────────────── the screen's source ───────────────────────────────

/** The states a governed read can be in, kept distinct so the screen can say which one it is. */
export const INBOUND_SOURCE_STATUS = Object.freeze({
  READY: "ready",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  NOT_ACTIVATED: "not_activated",
});

/** Pure: an API outcome -> a read snapshot. A malformed success is UNAVAILABLE, never a ready empty result. */
export function mapInboundRead(res) {
  if (res?.ok && res.result && typeof res.result === "object") {
    return { status: INBOUND_SOURCE_STATUS.READY, payload: res.result, error: null };
  }
  if (res?.ok) return { status: INBOUND_SOURCE_STATUS.UNAVAILABLE, payload: null, error: "MALFORMED" };
  const status = res?.code === "NOT_ACTIVATED" ? INBOUND_SOURCE_STATUS.NOT_ACTIVATED
    : res?.code === "FORBIDDEN" ? INBOUND_SOURCE_STATUS.DENIED
      : INBOUND_SOURCE_STATUS.UNAVAILABLE;
  return { status, payload: null, error: res?.reason ?? res?.code ?? "UNAVAILABLE" };
}

/** Pure: an API outcome -> a write result. A decision that did not happen never looks like an empty success. */
export function mapInboundWrite(res) {
  if (res?.ok) return { ok: true, data: res.result ?? null, code: null, message: null };
  return {
    ok: false,
    data: null,
    code: res?.code === "NOT_ACTIVATED" ? "NOT_ACTIVATED" : res?.reason ?? res?.code ?? "UNAVAILABLE",
    message: res?.code === "NOT_ACTIVATED"
      ? "Inbound Work is not yet activated on EOS (NOT_YET_ACTIVATED)."
      : typeof res?.message === "string" ? res.message : "That action could not be completed.",
  };
}

/**
 * The Inbound Work review source. The shape the workspace consumes; every member is an EOS call.
 * `client` / `workOrderCall` are injectable for tests.
 */
export function createEosInboundWorkSource({ client = inboundWorkApiClient, workOrderCall = callWorkOrderApi } = {}) {
  return Object.freeze({
    readAccess: async () => mapInboundRead(await client.call("readInboundWorkAccess", {})),
    listQueue: async (options = {}) => mapInboundRead(await client.call("listInboundWork", options)),
    getRequest: async (requestId) => mapInboundRead(await client.call("readInboundWorkRequest", { requestId })),
    accept: async (input) => mapInboundWrite(await client.call("acceptInboundWork", input)),
    decline: async (input) => mapInboundWrite(await client.call("declineInboundWork", input)),
    attach: async (input) => mapInboundWrite(await client.call("attachInboundWork", input)),
    // RECOVERY (inboundWork.request.recover): release / reassign an accepted-but-unfinished claim; reviewers by Employee.
    release: async (input) => mapInboundWrite(await client.call("releaseInboundWork", input)),
    reassign: async (input) => mapInboundWrite(await client.call("reassignInboundWork", input)),
    listRecoveryTargets: async (requestId) => mapInboundRead(await client.call("listInboundRecoveryTargets", { requestId })),
    // A custodied attachment, read THROUGH its request (inboundWork.request.read).
    readAttachment: async (input) => mapInboundRead(await client.call("readInboundAttachment", input)),
    // The governed company choice Accept STATES: ACTIVE and keyed only (requires workOrder.create, as Accept does).
    listOperatingCompanies: async () => mapInboundRead(await workOrderCall("listWorkOrderOperatingCompanies", {})),
  });
}

export const EOS_INBOUND_WORK_SOURCE = createEosInboundWorkSource();

export const INBOUND_WORK_NOT_YET_ACTIVATED_MESSAGE =
  "Inbound Work is not yet activated on EOS (NOT_YET_ACTIVATED). It is served by the governed Work Order authority, which has not been switched on for this environment.";

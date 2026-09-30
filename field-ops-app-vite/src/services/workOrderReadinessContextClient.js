// The Work Order readiness context -- on the governed EOS Work Order route, and nowhere else.
//
//   browser -> THIS -> POST /operations/work-orders { operation: "readWorkOrderReadiness", input: { workOrderId } }
//
// The Firebase callable (getWorkOrderReadinessContext) is retired from the browser: no Firebase import, no
// fallback. The server answers the Work Order / CRM / Catalog dimensions from PostgreSQL and states the inventory
// boundary as `inventory: { state: "NOT_YET_ACTIVATED" }` -- it never invents a stock balance, and neither does this.
//
// The request shape is intentionally one field only. The browser cannot nominate parts, customers, warehouses,
// reorder requests or inventory facts; every join key is derived by the server from the already-authorized Work
// Order.
import { callWorkOrderApi } from "./workOrderApiClient.js";

export const WORK_ORDER_READINESS_OPERATION = "readWorkOrderReadiness";
/** The governed Work Order authority is not switched on yet: a readiness STATE, not an error. */
export const WORK_ORDER_READINESS_CONTEXT_NOT_READY = "transport-not-ready";

const STATUS_BY_CATEGORY = Object.freeze({
  NOT_ACTIVATED: WORK_ORDER_READINESS_CONTEXT_NOT_READY,
  NOT_CONFIGURED: WORK_ORDER_READINESS_CONTEXT_NOT_READY,
  FORBIDDEN: "permission-denied",
  UNAUTHENTICATED: "unauthenticated",
  NOT_SIGNED_IN: "unauthenticated",
  NOT_FOUND: "not-found",
  INVALID_INPUT: "invalid-argument",
});

/** Fetch the readiness source dimensions for one Work Order. Never throws. */
export async function fetchWorkOrderReadinessContext(workOrderId, deps = {}) {
  if (typeof workOrderId !== "string" || !workOrderId.trim()) {
    return { errorStatus: "invalid-argument", errorDetail: null };
  }
  const call = deps.call ?? callWorkOrderApi;
  let res;
  try {
    res = await call(WORK_ORDER_READINESS_OPERATION, { workOrderId: workOrderId.trim() });
  } catch {
    res = null;
  }
  if (res?.ok) return { result: res.result ?? null };
  return { errorStatus: STATUS_BY_CATEGORY[res?.code] ?? "unavailable", errorDetail: res?.reason ?? null };
}

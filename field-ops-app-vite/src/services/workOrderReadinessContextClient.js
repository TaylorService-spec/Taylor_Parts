import { WORK_ORDER_READINESS_CONTEXT_READY } from "../config/workOrderReadinessContextReadiness.js";

export const WORK_ORDER_READINESS_CONTEXT_CALLABLE = "getWorkOrderReadinessContext";
export const WORK_ORDER_READINESS_CONTEXT_NOT_READY = "transport-not-ready";

function mapError(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  return raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
}

/**
 * Fetch the model-safe/source-safe readiness context for one Work Order.
 *
 * The request shape is intentionally one field only. The browser cannot nominate parts, customers,
 * warehouses, reorder requests or inventory facts; every join key is derived by the trusted server
 * from the already-authorized Work Order.
 */
export async function fetchWorkOrderReadinessContext(workOrderId) {
  if (!WORK_ORDER_READINESS_CONTEXT_READY) {
    return { errorStatus: WORK_ORDER_READINESS_CONTEXT_NOT_READY, errorDetail: null };
  }
  if (typeof workOrderId !== "string" || !workOrderId.trim()) {
    return { errorStatus: "invalid-argument", errorDetail: null };
  }

  try {
    const [{ httpsCallable }, { functions }] = await Promise.all([
      import("firebase/functions"),
      import("../firebase/firebase.js"),
    ]);
    const callable = httpsCallable(functions, WORK_ORDER_READINESS_CONTEXT_CALLABLE);
    const response = await callable({ workOrderId: workOrderId.trim() });
    return { result: response?.data ?? null };
  } catch (err) {
    return { errorStatus: mapError(err), errorDetail: null };
  }
}

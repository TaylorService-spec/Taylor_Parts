// Sales Order — transport over the three trusted, capability-gated WRITE callables
// (functions/src/salesOrder/salesOrderCallables.ts's transitionSalesOrder,
// functions/src/fulfillment/allocateSalesOrder.ts, functions/src/salesOrder/createServiceForSalesOrder.ts).
// Structure mirrors services/salesOrderReadCallableClient.js exactly: firebase is imported LAZILY (no
// import-time initializeApp side effect), and this is the only place that invokes these callables.
//
// salesOrder.write / salesOrder.fulfill / salesOrder.service are already sandbox-activated
// (config/environments.json's capabilityActivationOverrides) — unlike Part Master's write callables,
// there is no "not deployed" posture here, so this client carries NO client-side readiness flag. A
// persona's authorization is resolved fail-closed server-side (resolveEffectiveAccess) on every call,
// exactly like the read callable; attempting the call and mapping whatever comes back is the same
// governed pattern every other write client in this codebase uses once its capability is live.
//
// Never throws. Each method returns { result } on success or { errorStatus } on failure, where
// errorStatus is the callable's HttpsError `code` (functions/-prefix stripped), or "internal" when the
// failure carries no usable code. domain/salesOrderActions.js's outcomeFromErrorCode owns turning that
// code into a safe, human message — this file performs transport only.
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code || "internal";
}

async function invoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

// idempotencyKey is REQUIRED by transitionSalesOrder and is carried through VERBATIM (never
// regenerated here) — the caller (hooks/useSalesOrderActions.js) owns generating it once per user
// intent and reusing it across a retry.
export async function transitionSalesOrder({ salesOrderId, transition, idempotencyKey }) {
  try {
    const result = await invoke("transitionSalesOrder", { salesOrderId, transition, idempotencyKey });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

// allocateSalesOrder takes no idempotencyKey — the command is naturally re-run-safe (it nets this SO's
// own prior allocation against on-hand before writing), so none is fabricated or sent here.
export async function allocateSalesOrder({ salesOrderId }) {
  try {
    const result = await invoke("allocateSalesOrder", { salesOrderId });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

// createServiceForSalesOrder also takes no idempotencyKey — it is guarded by its own domain
// invariant (an SO may only ever gain ONE lineage of Service Work Orders; a second call fails
// failed-precondition once serviceWorkOrderIds is non-empty), so none is fabricated or sent here.
export async function createServiceForSalesOrder({ salesOrderId }) {
  try {
    const result = await invoke("createServiceForSalesOrder", { salesOrderId });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

export const salesOrderCommandClient = Object.freeze({
  transitionSalesOrder,
  allocateSalesOrder,
  createServiceForSalesOrder,
});

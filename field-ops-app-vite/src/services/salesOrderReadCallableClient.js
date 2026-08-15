// Sales Order — transport over the trusted `getSalesOrderContext` callable
// (functions/src/salesOrder/salesOrderReadService.ts). Structure mirrors
// services/financeReadCallableClient.js / services/receivingCallableClient.js: firebase is
// imported LAZILY (no import-time initializeApp side effect), and this is the only place
// that invokes the callable.
//
// READ, no client-side readiness flag -- `salesOrder.read` authorization and its
// per-environment activation are both enforced server-side (the callable throws
// permission-denied when unauthorized); attempting the call and mapping whatever comes
// back is the same governed-read pattern every other read client in this codebase uses.
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? "denied" : "unavailable";
}

async function invoke(payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, "getSalesOrderContext")(payload);
  return res?.data;
}

// Fetch one Sales Order by id. Returns { result } on success (the callable's own
// {status, salesOrder} envelope, "ready" or "not-found", passed through verbatim for
// domain/salesOrderView.js to interpret) or { errorStatus } on failure ("denied" |
// "unavailable") -- never throws.
export async function fetchSalesOrderContext(salesOrderId) {
  try {
    const result = await invoke({ salesOrderId });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}

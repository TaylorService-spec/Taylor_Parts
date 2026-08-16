// CRM Activity / Notes — transport over the two trusted callables
// (functions/src/crmActivity/crmActivityReadService.ts's getCrmActivities, functions/src/crmActivity/
// crmActivityCallables.ts's createCrmActivity). Structure mirrors services/salesOrderReadCallableClient.js
// and services/salesOrderCommandClient.js exactly: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes these callables.
//
// crm.activity.read / crm.activity.create are both registered active:false and granted to NO Role today
// -- there is no client-side readiness flag here (matches every other governed-read/write client in this
// codebase); a persona's authorization is resolved fail-closed server-side on every call.
//
// Never throws. Each method returns { result } on success or { errorStatus } on failure.
import { mapCrmActivityErrorToStatus } from "../domain/crmActivityView.js";

function mapWriteErrorToStatus(err) {
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

// Fetch the CRM Activity timeline for one account. Returns { result } on success (the callable's own
// {status, activities} envelope, passed through verbatim for domain/crmActivityView.js to interpret) or
// { errorStatus } on failure ("denied" | "unavailable") -- never throws.
export async function fetchCrmActivities(accountId, limit = 100) {
  try {
    const result = await invoke("getCrmActivities", { accountId, limit });
    return { result };
  } catch (err) {
    return { errorStatus: mapCrmActivityErrorToStatus(err) };
  }
}

// Create a new CRM Activity/Note. `idempotencyKey` is REQUIRED and carried through VERBATIM (never
// regenerated here) -- the caller (hooks/useCrmActivityActions.js) owns generating it once per user
// intent and reusing it across a retry, exactly like useSalesOrderActions.js's own transitionSalesOrder
// call.
export async function createCrmActivity({ accountId, contactId, opportunityId, salesOrderId, type, body, occurredAtMillis, idempotencyKey }) {
  try {
    const result = await invoke("createCrmActivity", {
      accountId, contactId, opportunityId, salesOrderId, type, body, occurredAtMillis, idempotencyKey,
    });
    return { result };
  } catch (err) {
    return { errorStatus: mapWriteErrorToStatus(err) };
  }
}

export const crmActivityCallableClient = Object.freeze({
  fetchCrmActivities,
  createCrmActivity,
});

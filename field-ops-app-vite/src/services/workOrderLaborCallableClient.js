// The technician's labor calls -- on the governed EOS Work Order route, and nowhere else.
//
//   browser -> THIS -> POST /operations/work-orders { readWorkOrderLabor | recordWorkOrderLabor }
//
// The Firebase callables (getWorkOrderLabor / recordWorkOrderLabor) are retired from the browser: there is no
// Firebase import here and no fallback to one. A refused or failed call is RETURNED as a value, never papered over.
//
// Errors are RETURNED, not thrown, so the caller can branch on the code: OVERLAPPING_ENTRY and
// WORK_ORDER_STATE_INVALID are things a technician can act on with the job in front of them. The returned shape is
// the one every consumer (JobLabor, the offline bindings, technicianLaborEntry.interpretLaborResult) already reads:
//
//   { outcome, error: null }                       outcome.outcome is "recorded" | "replayed" for a write
//   { outcome: null, error: { code, details, message } }
//
// `error.code` is the transport code the offline executor classifies (permission-denied, failed-precondition,
// unavailable, ...) and `error.details` the server's specific reason (NOT_ASSIGNED, OVERLAPPING_ENTRY, ...), so a
// queued entry that syncs is classified exactly as it was when these were callables. NOT_ACTIVATED -- the governed
// Work Order authority not switched on yet -- is `unavailable`: a wait, never a refusal.
import { callWorkOrderApi } from "./workOrderApiClient.js";
import { workOrderSyncError } from "../offline/workOrderSyncError.js";

const errorOf = (res) => ({ ...workOrderSyncError(res), message: res?.message ?? null });

const defaultCall = (operation, input) => callWorkOrderApi(operation, input);

/** The time on ONE work order, with derived totals. Scoped to a job, never to an employee. */
export async function fetchWorkOrderLabor({ workOrderId } = {}, deps = {}) {
  const call = deps.call ?? defaultCall;
  const res = await call("readWorkOrderLabor", { workOrderId });
  return res?.ok ? { outcome: res.result ?? null, error: null } : { outcome: null, error: errorOf(res) };
}

/**
 * Record time the SIGNED-IN technician performed.
 *
 * No technicianId / employeeId in the payload, deliberately: the server records for the caller's own governed
 * Employee, and refuses a request that names somebody else.
 */
export async function recordWorkOrderLabor(request, deps = {}) {
  const call = deps.call ?? defaultCall;
  const res = await call("recordWorkOrderLabor", request);
  if (!res?.ok) return { outcome: null, error: errorOf(res) };
  const r = res.result ?? {};
  return {
    outcome: {
      ...r,
      // The server says RECORDED / REPLAYED; every consumer reads the lower-case words the callable used.
      outcome: r.outcome === "REPLAYED" ? "replayed" : r.outcome === "RECORDED" ? "recorded" : r.outcome ?? null,
    },
    error: null,
  };
}

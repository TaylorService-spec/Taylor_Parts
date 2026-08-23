// The technician's labor calls. Both trusted; neither touches Firestore directly.
//
// `work_order_labor_entries` has no Rules match block, so it is deny-all to every client -- there is
// no client-direct path to fall back to, by design. Hours are a business record and only the trusted
// commands write them.
//
// Errors are RETURNED, not thrown, so the caller can branch on the code: OVERLAPPING_ENTRY and
// WORK_ORDER_STATE_INVALID are things a technician can act on with the job in front of them.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const READ_CALLABLE = "getWorkOrderLabor";
const RECORD_CALLABLE = "recordWorkOrderLabor";

const wrap = async (call, payload) => {
  try {
    const res = await call(payload);
    return { outcome: res?.data ?? null, error: null };
  } catch (err) {
    return {
      outcome: null,
      error: { code: err?.code ?? null, details: err?.details ?? null, message: err?.message ?? null },
    };
  }
};

/** The time on ONE work order, with derived totals. Scoped to a job, never to an employee. */
export function fetchWorkOrderLabor({ workOrderId } = {}, deps = {}) {
  const call = deps.call ?? ((data) => httpsCallable(functions, READ_CALLABLE)(data));
  return wrap(call, { workOrderId });
}

/**
 * Record time the AUTHENTICATED technician performed.
 *
 * No technicianId in the payload, deliberately: the server records for whoever is signed in, and
 * refuses a request that names somebody else.
 */
export function recordWorkOrderLabor(request, deps = {}) {
  const call = deps.call ?? ((data) => httpsCallable(functions, RECORD_CALLABLE)(data));
  return wrap(call, request);
}

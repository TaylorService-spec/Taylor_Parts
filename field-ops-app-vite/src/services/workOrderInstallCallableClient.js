// The technician's two calls. Both trusted; neither touches Firestore directly.
//
// `serialized_assets` is deny-all to every client, and a technician has no Equipment read at all, so
// there is no client-direct alternative here by design -- the scoped read is the only way this
// surface can see a machine, and the record callable is the only way it can install one.
//
// Errors are RETURNED, not thrown, so the caller can branch on the code. A refusal like
// ASSET_INSTALLED_ELSEWHERE is information a technician can act on with the box in their hands.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const LIST_CALLABLE = "getInstallableEquipmentForWorkOrder";
const RECORD_CALLABLE = "recordWorkOrderEquipmentInstall";

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

/**
 * What may be installed on this work order.
 *
 * READ-ONLY, including when a scanned serial is supplied. Scanning resolves and confirms; it never
 * installs. Passing `serialNo` narrows the answer to that one unit -- it does not act on it.
 */
export function fetchInstallableEquipmentForWorkOrder({ workOrderId, serialNo } = {}, deps = {}) {
  const call = deps.call ?? ((data) => httpsCallable(functions, LIST_CALLABLE)(data));
  return wrap(call, { workOrderId, ...(serialNo ? { serialNo } : {}) });
}

/**
 * Record the installation. Step one of closeout -- completing the work order is a separate call, in
 * that order, so a completed job whose installation failed cannot exist.
 *
 * Customer and location are deliberately absent from this payload: the server derives both from the
 * work order and refuses a request that tries to supply them.
 */
export function recordWorkOrderEquipmentInstall({ workOrderId, serializedAssetId, notes, idempotencyKey } = {}, deps = {}) {
  const call = deps.call ?? ((data) => httpsCallable(functions, RECORD_CALLABLE)(data));
  return wrap(call, { workOrderId, serializedAssetId, idempotencyKey, ...(notes ? { notes } : {}) });
}

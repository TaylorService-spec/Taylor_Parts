// AUTH-UI-3 -- the client SEAM for admin-initiated password reset. Mirrors
// reportExecutionSeam.js: a deliberately THIN wrapper so `firebase` stays out of
// the unit tests, with ALL outcome/error mapping delegated to the PURE,
// node-tested domain/adminPasswordReset.js.
//
// UNAVAILABLE-SAFE: the callables are NOT deployed today (AUTH-PR-3/3.5 backend
// is repository/emulator-only). When a callable is unreachable the SDK rejects,
// and the mapping resolves it to an honest sanitized result -- never a
// client-direct Auth mutation, never a simulated success. The client never
// performs a reset itself; it only invokes the trusted Function and maps.
//
// RAW vs MAPPED:
//  - `rawInitiateAdminPasswordReset` returns the backend's raw neutral outcome
//    (or throws) because the UI-2 controller (createAdminResetController) does
//    the mapping itself and owns idempotency/lock.
//  - `listResetEligibleUsers` is mapped here (no controller) and never throws.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import { mapCallableError } from "../domain/adminPasswordReset.js";

// onCall export names (functions/src/index.ts), region us-central1 (firebase.js
// binds the functions instance to that region and, in ?emulator=1 dev, to the
// local Functions emulator).
const INITIATE_CALLABLE = "initiateAdminPasswordReset";
const LIST_CALLABLE = "listResetEligibleUsers";

// RAW initiate for the UI-2 controller. Sends ONLY the merged-contract fields
// ({ targetUid, mode, idempotencyKey }); actorUid is derived server-side from
// the authenticated context and is never sent from here. Returns the backend's
// neutral `{ status: "accepted" }` (or throws an HttpsError the controller maps).
export function rawInitiateAdminPasswordReset(payload) {
  return httpsCallable(functions, INITIATE_CALLABLE)(payload).then((res) => res?.data);
}

// List eligible users (sanitized). Resolves (never rejects): { ok:true, users }
// on success, or { ok:false, result } mapped from the callable error.
export async function listResetEligibleUsers(payload = {}) {
  try {
    const res = await httpsCallable(functions, LIST_CALLABLE)(payload);
    const users = Array.isArray(res?.data?.users) ? res.data.users : [];
    return { ok: true, users };
  } catch (err) {
    return { ok: false, result: mapCallableError(err) };
  }
}

// The seam object the AdminUsers surface consumes (injectable for tests).
export const adminPasswordResetClient = {
  rawInitiateAdminPasswordReset,
  listResetEligibleUsers,
};

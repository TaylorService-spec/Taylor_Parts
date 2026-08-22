// PRIVILEGED APPROVAL -- thin transport over the trusted approval callables
// (functions/src/access/accessCommandCallables.ts).
//
// ============================ NO approverUid, EVER ============================
//
// `decide()` sends requestId, decision, reason and an idempotency key. It does NOT send an
// approver, and there is no parameter for one.
//
// That absence is the control. The previous privileged path accepted `approverUid` as request data,
// which proved the named principal HELD approval authority and nothing about whether they used it --
// anyone able to type the Admin UID could mint a privileged Role with the Admin absent. The backend
// now derives the approver from `request.auth.uid` alone, and adding an approver field here would
// be inert at best and misleading at worst.
//
// THE UI IS NOT THE AUTHORITY. Every call here is authorized server-side. Hiding a button is a
// convenience for the operator, never a security boundary -- an unauthorized principal calling this
// module directly is refused by the callable, which is the check that counts.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

export const PRIVILEGED_APPROVAL_CALLABLES = Object.freeze({
  list: "listPrivilegedRoleRequests",
  decide: "decidePrivilegedRoleRequest",
});

const call = (name, payload) => httpsCallable(functions, name)(payload).then((res) => res?.data);

/**
 * Idempotency key for a decision.
 *
 * Deterministic per (request, decision) so a double-click is the SAME request and resolves to the
 * recorded outcome rather than attempting a second decision. A timestamp or random suffix here
 * would make every click a new request and defeat the duplicate protection entirely -- which is the
 * exact failure the backend's retry-vs-second-decision split exists to prevent.
 */
export function decisionIdempotencyKey(requestId, decision) {
  return `decide_${decision.toLowerCase()}_${requestId}`.slice(0, 200);
}

export const privilegedApprovalClient = Object.freeze({
  async listPending() {
    const data = await call(PRIVILEGED_APPROVAL_CALLABLES.list, { status: "PENDING_APPROVAL" });
    return data?.requests ?? [];
  },
  async listAll() {
    const data = await call(PRIVILEGED_APPROVAL_CALLABLES.list, {});
    return data?.requests ?? [];
  },
  async decide({ requestId, decision, reason }) {
    return call(PRIVILEGED_APPROVAL_CALLABLES.decide, {
      requestId,
      decision,
      ...(reason ? { reason } : {}),
      idempotencyKey: decisionIdempotencyKey(requestId, decision),
    });
  },
});

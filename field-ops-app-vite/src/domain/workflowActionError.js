// Issue #214 PR-3 -- safe categorized copy for a workflow action failure: a Work
// Order Cloud Function transition (transitionWorkOrder) OR a client-direct,
// Rules-gated reorder/PO write (cancel / void / reject). Dependency-free so it is
// node-importable and unit-tested directly (test/workflowActionError.test.mjs).
//
// It NEVER surfaces a raw err.message, a Firebase/Functions code, a stack, a UID,
// or a document id -- only one of four safe categories, each ending in
// "Nothing was changed." so the reader knows a failed action mutated nothing.

// Firebase/Functions codes arrive either bare ("permission-denied") or namespaced
// ("functions/permission-denied", "firestore/unavailable"); normalize to the bare
// tail so both shapes map the same way.
function normalizeCode(err) {
  let code = err && typeof err.code === "string" ? err.code : "";
  if (code.includes("/")) code = code.split("/").pop();
  return code;
}

// The governed EOS Work Order route (services/workOrderApiClient.js) reports CATEGORIES, not Firebase
// codes. Each maps onto the same four safe categories -- plus NOT_ACTIVATED, which is a readiness state
// (DQ-S4), said as itself rather than as a failure.
const EOS_CATEGORY = Object.freeze({
  INVALID_INPUT: "invalid-argument",
  PRECONDITION_FAILED: "failed-precondition",
  CONFLICT: "failed-precondition",
  NOT_FOUND: "failed-precondition",
  FORBIDDEN: "permission-denied",
  UNAUTHENTICATED: "unauthenticated",
  NOT_SIGNED_IN: "unauthenticated",
  UNAVAILABLE: "unavailable",
  UNREACHABLE: "unavailable",
  NOT_CONFIGURED: "unavailable",
});

export const WORK_ORDER_NOT_YET_ACTIVATED_ACTION_MESSAGE =
  "Work Orders are not yet activated on EOS (NOT_YET_ACTIVATED). Nothing was changed.";

export function workflowActionErrorMessage(err) {
  if (err && err.blocked) return "Saving is disabled in this mode. Nothing was changed.";
  const raw = err && typeof err.code === "string" ? err.code : "";
  if (raw === "NOT_ACTIVATED") return WORK_ORDER_NOT_YET_ACTIVATED_ACTION_MESSAGE;
  switch (EOS_CATEGORY[raw] ?? normalizeCode(err)) {
    case "invalid-argument":
    case "failed-precondition":
    case "out-of-range":
      return "That action isn't valid for this item right now. Nothing was changed.";
    case "permission-denied":
    case "unauthenticated":
      return "You're not allowed to perform this action. Nothing was changed.";
    case "unavailable":
    case "deadline-exceeded":
      return "The service is temporarily unavailable. Nothing was changed — please try again.";
    default:
      return "Something went wrong and the action could not be completed. Nothing was changed.";
  }
}

// Issue #214 PR-3 -- safe categorized copy for a workflow action failure: a Work
// Order Cloud Function transition (transitionWorkOrder) OR a client-direct,
// Rules-gated reorder/PO write (cancel / void / reject). Dependency-free so it is
// node-importable and unit-tested directly (test/workflowActionError.test.mjs).
//
// It NEVER surfaces a raw err.message, a Firebase/Functions code, a stack, a UID,
// or a document id -- only one of four safe categories, each ending in
// "Nothing was changed." so the reader knows a failed action mutated nothing.

// The governed EOS Work Order route (services/workOrderApiClient.js) reports CATEGORIES, not Firebase codes.
// Both shapes classify through domain/workOrderOutcome.js -- the ONE classifier -- into UNAUTHORIZED,
// NOT_YET_ACTIVATED (said as its named boundary: the Work Order authority, the Commercial fulfillment hold,
// Equipment install, a not-yet-served operation), INTEGRITY or UNAVAILABLE; anything unrecognised is the generic
// sentence.
import { classifyWorkOrderOutcome, workOrderOutcomeMessage } from "./workOrderOutcome.js";

export const WORK_ORDER_NOT_YET_ACTIVATED_ACTION_MESSAGE =
  "Work Orders are not yet activated on EOS (NOT_YET_ACTIVATED). Nothing was changed.";

export function workflowActionErrorMessage(err) {
  if (err && err.blocked) return "Saving is disabled in this mode. Nothing was changed.";
  return workOrderOutcomeMessage(classifyWorkOrderOutcome(err), { mode: "action" });
}

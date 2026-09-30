// Issue #214 PR-4 -- safe, categorized copy for a page/collection LOAD or
// subscription failure, rendered by FailureState. Deliberately a dependency-free
// module (only the dependency-free Work Order outcome classifier) so it is
// node-importable and unit-tested directly (test/sharedStates.test.mjs). It maps a
// failure to safe human copy and NEVER surfaces a raw code, path, document id, or
// stack -- the same discipline as the domain *SaveErrorMessage helpers, for the read side.
//
// The classification is domain/workOrderOutcome.js's -- the ONE place that decides whether a failure is
// UNAUTHORIZED, NOT_YET_ACTIVATED (and which named boundary), INTEGRITY or UNAVAILABLE. Firebase-shaped codes
// ("permission-denied", "firestore/unavailable") classify through the same table.
import { classifyWorkOrderOutcome, workOrderOutcomeMessage } from "./workOrderOutcome.js";

export function loadErrorMessage(err, { entity = "data" } = {}) {
  return workOrderOutcomeMessage(classifyWorkOrderOutcome(err), { mode: "load", entity });
}

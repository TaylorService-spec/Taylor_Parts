import { useCallback, useMemo, useState } from "react";
import { setWorkOrderPartsPlan } from "../services/workOrderService";
import { buildPartsPlanInput, planRemovalBlocked } from "../domain/workOrderPartsPlan";

// WO Parts Planning -- the ONLY place the governed setWorkOrderPartsPlan command is invoked from the
// Work Order experience.
//
// There is deliberately NO readiness flag here. Part Master write has one because its UI must be
// inert in an environment where the callables are absent; parts planning instead relies on the
// capability itself: `workOrder.parts.plan` is registered active:false and granted to no Role, so the
// command fails closed on the server for every caller until a separate grant. Adding a second,
// client-side gate would let the repo *look* activated while the server still denies -- one gate,
// server-side, is the honest model.
//
// Every outcome is an object; this hook never throws. The client NEVER claims a success it did not
// receive, and never optimistically mutates the plan -- the caller refetches the Work Order so the
// rendered plan always comes from the persisted document.
//
// `deps.client` lets tests inject a mocked command without touching firebase.

export const PLAN_OUTCOME = Object.freeze({
  SUCCESS: "SUCCESS",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  REMOVAL_BLOCKED: "REMOVAL_BLOCKED",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  CONFLICT: "CONFLICT",
  FAILED: "FAILED",
});

// Map a callable error to an honest, user-safe outcome. An unrecognized error is FAILED -- never
// silently treated as success, and never reported as "denied" (which would misattribute an outage to
// the user's permissions).
export function outcomeFromPlanError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return {
      outcome: PLAN_OUTCOME.DENIED,
      message: "You do not have permission to change this Work Order's parts plan.",
    };
  }
  if (code === "functions/unauthenticated" || code === "unauthenticated") {
    return { outcome: PLAN_OUTCOME.DENIED, message: "Your session is not signed in." };
  }
  // `not-found` from the callable layer means the FUNCTION is not deployed in this environment;
  // `not-found` raised by the command itself means the Work Order is missing. Both are honestly
  // "this cannot be done here right now", but they are reported distinctly enough to debug.
  if (code === "functions/not-found" || code === "not-found") {
    return {
      outcome: PLAN_OUTCOME.UNAVAILABLE,
      message: "Parts planning is not available in this environment.",
    };
  }
  if (code === "functions/failed-precondition" || code === "failed-precondition") {
    return {
      outcome: PLAN_OUTCOME.CONFLICT,
      message: error?.message || "This Work Order can no longer be planned.",
    };
  }
  if (code === "functions/invalid-argument" || code === "invalid-argument") {
    return { outcome: PLAN_OUTCOME.VALIDATION_FAILED, message: error?.message || "The plan was rejected." };
  }
  return { outcome: PLAN_OUTCOME.FAILED, message: "Could not save the parts plan. Please try again." };
}

export function useWorkOrderPartsPlan(deps) {
  const client = deps?.client ?? setWorkOrderPartsPlan;
  const [saving, setSaving] = useState(false);

  const savePlan = useCallback(
    async (workOrderId, proposedLines, currentPlanned = []) => {
      // Validate the intent BEFORE any network attempt. The server re-enforces every one of these
      // invariants as the authority; checking here only avoids a round trip and gives a precise message.
      const built = buildPartsPlanInput(proposedLines);
      if (!built.ok) {
        return { outcome: PLAN_OUTCOME.VALIDATION_FAILED, error: built.error };
      }

      // A part with recorded usage cannot be un-planned. The server refuses this too
      // (USED_PART_REMOVAL); surfacing it up front keeps the user from losing their edits to a
      // rejection they could have been warned about.
      const blocked = planRemovalBlocked(currentPlanned, built.value);
      if (blocked.length > 0) {
        return { outcome: PLAN_OUTCOME.REMOVAL_BLOCKED, blockedPartIds: blocked };
      }

      setSaving(true);
      try {
        const data = await client(workOrderId, built.value);
        return { outcome: PLAN_OUTCOME.SUCCESS, plannedCount: data?.plannedCount ?? built.value.length };
      } catch (error) {
        return outcomeFromPlanError(error);
      } finally {
        setSaving(false);
      }
    },
    [client],
  );

  return useMemo(() => ({ saving, savePlan }), [saving, savePlan]);
}

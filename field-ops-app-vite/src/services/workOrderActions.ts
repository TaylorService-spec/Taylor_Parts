// Epic 2 Phase 2B -- Dispatcher Action Orchestration Layer.
//
// Thin orchestration between the UI and the two, already-built,
// already-emulator-tested Cloud Functions (createWorkOrder/
// transitionWorkOrder in services/workOrderService.ts) -- this file
// introduces NO new backend, NO new state machine, and NO new
// permission logic of its own. Every rule it applies is a re-export or
// thin wrapper of domain/workOrderWorkflow.js, which already mirrors
// functions/src/transitionEngine.ts exactly (see
// docs/architecture/ADR-002-work-order-engine.md and
// docs/architecture/UI_ACTION_PIPELINES.md).
//
// getAvailableActions/resolveTargetState are deliberately NOT
// reimplementations -- they wrap workOrderWorkflow.js's
// getAllowedActions/ACTION_TO_STATUS. A third copy of the transition
// table (server transitionEngine.ts, client workOrderWorkflow.js, and
// a hypothetical third one here) is exactly the duplication risk
// ADR-002 already flagged; this file avoids adding it.
//
// UI-side validation here is a UX convenience, not an authority: the
// Cloud Function re-validates everything server-side regardless (see
// transitionWorkOrder.ts) and remains the only place a transition
// actually takes effect.
//
// No idempotency key is attached: transitionWorkOrder.ts doesn't
// accept or enforce one, and adding one is a Cloud Function change,
// out of scope this phase. A client-supplied key the backend ignores
// would be theater, not real double-submission protection --
// preventing double-clicks is instead the UI's job (disable the
// action button while a call is pending; see WorkOrderPreview.jsx).
import { getAllowedActions, ACTION_TO_STATUS } from "../domain/workOrderWorkflow";
import { transitionWorkOrder } from "./workOrderService";
import type { TransitionWorkOrderExtra } from "./workOrderService";
import type { WorkOrderStatus, ActionName } from "../types/workOrder";

export type Role = "admin" | "dispatcher" | "technician";

// Thin wrapper over domain/workOrderWorkflow.js's getAllowedActions --
// kept as its own export so call sites here read as "the action
// system," without every caller needing to know the gating logic
// actually lives in domain/.
export function getAvailableActions(
  state: WorkOrderStatus,
  role: Role | null,
  isOwnAssignment = false
): ActionName[] {
  // domain/workOrderWorkflow.js is plain JS -- TS can only infer
  // string[] from it, not the precise ActionName union. Cast here
  // rather than converting that file to TS, which would be a bigger,
  // unrelated change (see this phase's file-boundary intent).
  return getAllowedActions(state, role, isOwnAssignment) as ActionName[];
}

// Thin wrapper over domain/workOrderWorkflow.js's ACTION_TO_STATUS --
// same reasoning as getAvailableActions above.
export function resolveTargetState(action: ActionName): WorkOrderStatus {
  return (ACTION_TO_STATUS as Record<ActionName, WorkOrderStatus>)[action];
}

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidActionError";
  }
}

interface ExecuteWorkOrderActionParams {
  workOrderId: string;
  action: ActionName;
  currentState: WorkOrderStatus;
  userRole: Role | null;
  isOwnAssignment?: boolean;
  extra?: TransitionWorkOrderExtra;
}

// The only function DispatcherWorkspace/WorkOrderPreview should call
// to mutate a Work Order. Re-validates client-side (UI-only safety,
// not the final authority -- see header comment) that the requested
// action is actually one getAvailableActions() would offer for this
// state/role, so a stale/bypassed UI can't even attempt an action the
// backend would reject anyway; then delegates the actual mutation to
// transitionWorkOrder() (workOrderService.ts), the sole write path.
export async function executeWorkOrderAction({
  workOrderId,
  action,
  currentState,
  userRole,
  isOwnAssignment = false,
  extra,
}: ExecuteWorkOrderActionParams) {
  const allowed = getAvailableActions(currentState, userRole, isOwnAssignment);
  if (!allowed.includes(action)) {
    throw new InvalidActionError(
      `Action "${action}" is not available for a Work Order in status "${currentState}" for role "${userRole}".`
    );
  }

  return transitionWorkOrder(workOrderId, action, extra);
}

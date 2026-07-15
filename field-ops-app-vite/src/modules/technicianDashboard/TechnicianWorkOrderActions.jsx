import { useState } from "react";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { transitionWorkOrder } from "../../services/workOrderService";
import { FormError } from "../../shared/ui/form";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";

// Epic 6 Phase 6.2 -- technician-side lifecycle action UI. Mirrors
// modules/controlTower/WorkOrderActions.jsx's pattern (getAllowedActions()
// -> button per allowed action -> transitionWorkOrder()) but is a
// SEPARATE component, not a modification of that dispatcher-only file --
// same reasoning as WorkOrderActions.jsx's own header comment about
// FieldMode being out of scope for it, mirrored back the other
// direction here.
//
// UI is not a state machine: every button rendered comes directly from
// domain/workOrderWorkflow.js's getAllowedActions(status, role,
// isOwnAssignment) -- the client mirror of the one canonical authority,
// functions/src/transitionEngine.ts (see docs/architecture/ADR-002-work-order-engine.md's
// "Work Order Lifecycle Authority" section). No status/action mapping
// is hardcoded here beyond a display LABEL for each already-real action
// name -- verified live (see this PR's description) that the real
// mapping is a clean 1:1: DISPATCHED->Accept, ACCEPTED->Travel,
// EN_ROUTE->Arrive, ARRIVED->WorkStart, WORK_IN_PROGRESS->Complete,
// every other status -> no technician actions at all.
//
// isOwnAssignment is hardcoded true here (unlike WorkOrderActions.jsx's
// dispatcher-side hardcoded false) because every Work Order reachable
// through this component came from useAssignedWorkOrders(technicianId)
// (PT-002) -- a query already scoped to the signed-in technician's own
// assignments, so it always is their own by construction.
//
// No extra params are ever needed: unlike the dispatcher's Dispatch
// action (which requires assignedTechId), none of the 5 technician
// actions take any additional payload -- transitionWorkOrder(id, action)
// is always sufficient.
const ACTION_LABEL = {
  Accept: "Accept",
  Travel: "Start Travel",
  Arrive: "Arrived On Site",
  WorkStart: "Start Work",
  Complete: "Complete Work Order",
};

const STATUS_LABEL = {
  CREATED: "Not yet dispatched",
  READY_TO_DISPATCH: "Not yet dispatched",
  SCHEDULED: "Not yet dispatched",
  DISPATCHED: "Awaiting your acceptance",
  ACCEPTED: "Accepted -- ready to travel",
  EN_ROUTE: "Traveling",
  ARRIVED: "On site",
  WORK_IN_PROGRESS: "Work in progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export default function TechnicianWorkOrderActions({ workOrder }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const allowedActions = getAllowedActions(workOrder.status, "technician", true);

  async function handleAction(action) {
    setSubmitting(true);
    setError(null);
    try {
      await transitionWorkOrder(workOrder.id, action);
    } catch (err) {
      // Safe, categorized copy -- never the raw message / Functions code.
      console.error(err);
      setError(workflowActionErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wo-actions">
      <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{STATUS_LABEL[workOrder.status] ?? workOrder.status}</span>

      <FormError role="alert">{error}</FormError>

      {allowedActions.length > 0 && (
        <div className="fo-btn-row">
          {allowedActions.map((action) => (
            <button key={action} type="button" disabled={submitting} onClick={() => handleAction(action)}>
              {submitting ? "Working..." : (ACTION_LABEL[action] ?? action)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

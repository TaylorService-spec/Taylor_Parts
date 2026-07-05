import { useState } from "react";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { transitionWorkOrder } from "../../services/workOrderService";
import { TECH_STATUS } from "../../domain/constants";

// Epic 2 Phase 2B -- Work Order Lifecycle UI (dispatcher side only; see
// WorkOrderDetail.jsx's former "Phase 2 TODO" comment this replaces).
// Shared action renderer for ControlTower.jsx's dispatcher-facing view.
//
// FieldMode.jsx (technician mobile) is explicitly OUT OF SCOPE -- it
// still runs entirely on fieldops_jobs/JOB_STATUS via
// domain/jobActions.js's updateJobStatus(), unrelated to this file.
// That's a separate migration epic, not touched here.
//
// All writes go through transitionWorkOrder() (Cloud Function) --
// nothing here ever writes fieldops_wos directly. Which actions are
// even offered comes from domain/workOrderWorkflow.js's
// getAllowedActions(status, role, isOwnAssignment) -- the same
// mirror of functions/src/transitionEngine.ts already used
// server-side, not a new state machine. isOwnAssignment is hardcoded
// false here: every action a dispatcher/admin can take
// (MarkReady/Schedule/Dispatch/Close/Cancel) has
// requiresOwnAssignment: false in that file, so it never affects
// dispatcher-side filtering.
//
// One deliberate narrowing beyond what the backend technically
// permits: once a technician has accepted (ACCEPTED/EN_ROUTE/ARRIVED/
// WORK_IN_PROGRESS), this view shows a read-only status only, even
// though Cancel remains backend-valid from all of those. That's a
// requested UX restriction (don't let a dispatcher cancel out from
// under an in-flight technician via this screen), not a contract
// violation -- the backend still accepts a Cancel call from those
// states if one were ever added elsewhere.
//
// This is a UI-layer decision, not sourced from
// domain/workOrderWorkflow.js's getAllowedActions() -- see
// docs/architecture/ADR-002-work-order-engine.md's "Work Order
// Lifecycle Authority" section (functions/src/transitionEngine.ts is
// the canonical lifecycle authority; anything layered on top of it
// here, like this constant, must stay clearly named and documented as
// exactly that -- a layer on top, never a competing interpretation)
// and docs/architecture/SYSTEM_AUTHORITIES.md (the "who owns what"
// map -- Work Order lifecycle's row points at transitionEngine.ts,
// not this file). Exported so it stays a single, findable point of
// change if this UX restriction is ever revisited.
export const READ_ONLY_STATUSES = new Set(["ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);

// Pure map from workOrder.status only -- no timestamps, no derived
// lifecycle logic, per this epic's UI state rule.
const STATUS_LABEL = {
  CREATED: "Dispatcher actions",
  READY_TO_DISPATCH: "Ready to schedule",
  SCHEDULED: "Scheduled, awaiting dispatch",
  DISPATCHED: "Awaiting technician",
  ACCEPTED: "En route preparation",
  EN_ROUTE: "Traveling",
  ARRIVED: "On site",
  WORK_IN_PROGRESS: "Active job",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const ACTION_LABEL = {
  MarkReady: "Mark Ready",
  Schedule: "Schedule",
  Dispatch: "Dispatch",
  Close: "Close",
  Cancel: "Cancel",
};

export default function WorkOrderActions({ workOrder, role, technicians }) {
  const [submitting, setSubmitting] = useState(false);
  const [showTechPicker, setShowTechPicker] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState("");

  const isOwnAssignment = false; // dispatcher-only view -- see header comment
  const allowedActions = getAllowedActions(workOrder.status, role, isOwnAssignment);

  async function runAction(action, extra = {}) {
    setSubmitting(true);
    try {
      await transitionWorkOrder(workOrder.id, action, extra);
      setShowTechPicker(false);
      setSelectedTechId("");
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleActionClick(action) {
    if (action === "Dispatch") {
      setShowTechPicker(true);
      return;
    }
    runAction(action);
  }

  function confirmDispatch() {
    if (!selectedTechId) return;
    runAction("Dispatch", { assignedTechId: selectedTechId });
  }

  if (READ_ONLY_STATUSES.has(workOrder.status) || workOrder.status === "CLOSED" || workOrder.status === "CANCELLED") {
    return <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{STATUS_LABEL[workOrder.status]}</span>;
  }

  return (
    <div className="wo-actions">
      <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{STATUS_LABEL[workOrder.status]}</span>

      <div className="fo-btn-row">
        {allowedActions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={submitting}
            onClick={() => handleActionClick(action)}
          >
            {ACTION_LABEL[action] ?? action}
          </button>
        ))}
      </div>

      {showTechPicker && (
        <div className="fo-form">
          <select value={selectedTechId} onChange={(e) => setSelectedTechId(e.target.value)}>
            <option value="" disabled>
              Select technician…
            </option>
            {technicians
              .filter((t) => t.status === TECH_STATUS.AVAILABLE)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <button type="button" disabled={submitting || !selectedTechId} onClick={confirmDispatch}>
            Confirm Dispatch
          </button>
          <button type="button" disabled={submitting} onClick={() => setShowTechPicker(false)}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}

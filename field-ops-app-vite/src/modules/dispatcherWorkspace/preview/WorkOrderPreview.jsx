import { useState } from "react";
import { getCatalogItem } from "../../../data/partsCatalog";
import { resolveTechnicianName } from "../shared/formatters";
import EmptyState from "../../../shared/ui/EmptyState";
import ActionConfirmModal from "../actions/ActionConfirmModal";
import { getAvailableActions, resolveTargetState, executeWorkOrderAction } from "../../../services/workOrderActions";
import { useAuth } from "../../../auth/AuthContext";

// Outlook-style in-place preview (per this phase's UI behavior model):
// takes the already-selected `workOrder` object as a prop -- found by
// DispatcherWorkspace.jsx from the single useWorkOrders() subscription
// it already owns, NOT a second live subscription for one doc. Clicking
// a queue row never navigates; it only changes which object this
// component renders.
//
// Deliberately a lighter view than modules/controlTower/WorkOrderDetail.jsx
// (no Operational History) -- that section needs the fieldops_jobs
// collection too, which would mean a second Firestore listener in this
// workspace. This phase's spec is read-only Work Order triage, not a
// full detail page; Operational History stays ControlTower's job.
//
// Epic 2 Phase 2B: action buttons are derived from
// services/workOrderActions.ts's getAvailableActions() -- never
// hardcoded -- and gated to the dispatcher-facing action set (this
// workspace has no `isOwnAssignment` concept; dispatcher actions never
// require it). A successful action needs no manual refetch: the
// single useWorkOrders() listener in DispatcherWorkspace.jsx picks up
// the Firestore change live, same as everywhere else in this app.
export default function WorkOrderPreview({ workOrder, technicians }) {
  const { role } = useAuth();
  const [pendingAction, setPendingAction] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!workOrder) {
    return <EmptyState message="Select a Work Order to preview it here." />;
  }

  const availableActions = getAvailableActions(workOrder.status, role, false);

  async function handleConfirm(extra) {
    setSubmitting(true);
    setError(null);
    try {
      await executeWorkOrderAction({
        workOrderId: workOrder.id,
        action: pendingAction,
        currentState: workOrder.status,
        userRole: role,
        isOwnAssignment: false,
        extra,
      });
      // No optimistic update, no manual refetch -- the Firestore
      // listener updates workOrder in place once the write lands.
      // Per this phase's failure UX rule: do not assume success here
      // either -- just stop showing the modal; if the write actually
      // failed, the catch block below (not this path) handles it.
      setPendingAction(null);
    } catch (err) {
      // Per this phase's failure UX rule: show the reason, do not
      // retry automatically, do not assume success.
      setError(err.message || "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const timestampRows = [
    ["Scheduled", workOrder.scheduledStart],
    ["Dispatched", workOrder.dispatchedAt],
    ["Accepted", workOrder.acceptedAt],
    ["En Route", workOrder.enRouteAt],
    ["Arrived", workOrder.arrivedAt],
    ["Work Started", workOrder.workStartedAt],
    ["Completed", workOrder.completedAt],
    ["Closed", workOrder.closedAt],
  ].filter(([, value]) => value != null);

  return (
    <div className="fo-panel fo-work-order-preview">
      <h3>
        {workOrder.woNumber}
        <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{workOrder.status}</span>
      </h3>

      <div>
        Priority: {workOrder.priority}
        {workOrder.severity && <> | Severity: {workOrder.severity}</>} | Type: {workOrder.type}
      </div>

      <div>
        Customer: {workOrder.customerId} | Location: {workOrder.locationId}
      </div>

      <div className="fo-muted">Technician: {resolveTechnicianName(workOrder.assignedTechId, technicians)}</div>

      {timestampRows.length > 0 && (
        <div>
          {timestampRows.map(([label, value]) => (
            <span key={label} className="fo-muted">
              {label}: {value.toDate().toLocaleString()}{" "}
            </span>
          ))}
        </div>
      )}

      {workOrder.complaint && <p>{workOrder.complaint}</p>}

      {workOrder.inventorySnapshot?.length > 0 && (
        <div>
          <strong>Planned Parts:</strong>
          {workOrder.inventorySnapshot.map((item) => (
            <div key={item.sku}>
              - {item.name || getCatalogItem(item.sku)?.name || item.sku} × {item.qtyPlanned}
            </div>
          ))}
        </div>
      )}

      {availableActions.length > 0 && (
        <div className="fo-wizard-actions-right" style={{ marginTop: 16 }}>
          {availableActions.map((action) => (
            <button key={action} type="button" className="fo-btn-large" onClick={() => setPendingAction(action)}>
              {action}
            </button>
          ))}
        </div>
      )}

      {pendingAction && (
        <ActionConfirmModal
          workOrder={workOrder}
          action={pendingAction}
          targetState={resolveTargetState(pendingAction)}
          technicians={technicians}
          submitting={submitting}
          error={error}
          onConfirm={handleConfirm}
          onCancel={() => {
            setPendingAction(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

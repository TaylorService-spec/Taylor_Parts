import { memo } from "react";
import { workOrderPriorityText, workOrderPriorityLabel } from "../../domain/workOrderPriority";
import { workOrderStatusLabel } from "../../domain/workOrderStatus";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";

// Epic 2 Phase 2C -- left pane. Pure renderer: takes already-computed
// recommendations (from DispatcherBoard.jsx) and already-loaded
// workOrders/technicians, does no scoring or Firestore access itself.
//
// "Customer name" and "equipment summary" are shown using the only
// real fields that exist -- WorkOrder has no customerName or
// equipment field (see types/workOrder.ts): customerId is an opaque
// string id, and `type` (SERVICE_CALL/PM/INSTALL/WARRANTY/INSPECTION)
// is the closest thing to an equipment/job-category summary.
//
// "Age" is a pure display computation from workOrder.createdAt (a
// Firestore Timestamp) -- purely informational (same category as
// WorkOrderDetail.jsx's existing raw timestamp rows), not a workflow
// state inference. It never substitutes for or overrides
// workOrder.status.
function formatAge(createdAt) {
  if (!createdAt?.toMillis) return null;
  const ms = Date.now() - createdAt.toMillis();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function WorkOrderQueue({ workOrders, customerNames, recommendationsByWorkOrderId, technicians, selectedId, onSelect }) {
  // Shared resolver -- see domain/actorDisplayName.js. Previously fell back to the raw technician
  // document id, printing an opaque key where a person's name belongs.
  const techName = (id) => resolveTechnicianIdentity(id, { technicians }).name;

  // Dragging a card also selects it -- keeps the Preview/Technician
  // panes' recommendation scores in sync with whatever is actually
  // being dragged, rather than showing scores for a separately
  // "selected" (clicked) card that may not match. onDragEnd always
  // fires (success, cancel, or drop outside any valid target), so
  // there's no orphaned "mid-drag" UI state possible.
  function handleDragStart(e, workOrder) {
    e.dataTransfer.setData("text/plain", workOrder.id);
    e.dataTransfer.effectAllowed = "move";
    onSelect(workOrder.id);
  }

  return (
    <div className="disp-pane disp-pane--queue" role="listbox" aria-label="Work Order queue" tabIndex={0}>
      <h3>Work Order Queue ({workOrders.length})</h3>
      {workOrders.map((wo) => {
        const recs = recommendationsByWorkOrderId.get(wo.id) ?? [];
        const top = recs[0];
        const age = formatAge(wo.createdAt);
        const isSelected = selectedId === wo.id;
        return (
          <div
            key={wo.id}
            className={`disp-wo-card${isSelected ? " disp-wo-card--selected" : ""}`}
            draggable
            onDragStart={(e) => handleDragStart(e, wo)}
            onClick={() => onSelect(wo.id)}
            role="option"
            aria-selected={isSelected}
            aria-label={`Work Order ${wo.woNumber}, status ${workOrderStatusLabel(wo.status)}, priority ${workOrderPriorityLabel(wo.priority) ?? "not set"}`}
            tabIndex={-1}
          >
            <div className="disp-wo-card-header">
              <span className={`wo-status wo-${wo.status.toLowerCase()}`}>{workOrderStatusLabel(wo.status)}</span>
              <span className="fo-muted">{workOrderPriorityText(wo.priority) ?? "Priority not set"}</span>
            </div>
            <div>{wo.woNumber}</div>
            <div className="fo-muted">
              Customer: {customerNames?.get(wo.customerId) ?? wo.customerId} | {wo.type}
              {age && ` | ${age}`}
            </div>
            {wo.assignedTechId ? (
              <div className="fo-muted">Assigned: {techName(wo.assignedTechId)}</div>
            ) : top ? (
              <div className="fo-muted">
                ⭐ Recommended: {techName(top.techId)} ({top.score}%)
              </div>
            ) : (
              <div className="fo-muted">No technicians available to recommend</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// React.memo -- Priority 3 render audit: avoids re-rendering the whole
// queue when a sibling pane's own local state (search input text
// before debounce, toolbar filter dropdown open/closed, etc.) changes
// without actually changing this component's props.
export default memo(WorkOrderQueue);

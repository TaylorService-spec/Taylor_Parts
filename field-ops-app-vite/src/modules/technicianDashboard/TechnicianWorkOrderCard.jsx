import { memo } from "react";
import { getCatalogItem } from "../../data/partsCatalog";

// Epic 6 Phase 6.1 -- reuses the same card shape/CSS classes as
// modules/dispatcherBoard/WorkOrderQueue.jsx's cards (disp-wo-card,
// wo-status wo-{status}, fo-muted) for visual consistency with the
// Dispatcher Board, per this phase's Step 5. Not the same component --
// that one is drag-and-drop/dispatcher-recommendation-specific and
// doesn't fit a technician's own read-only card.
//
// "Customer name" and "equipment summary" use the only real fields
// that exist -- WorkOrder has no customerName or dedicated equipment
// field (types/workOrder.ts): customerId is an opaque string id, and
// `type` (SERVICE_CALL/PM/INSTALL/WARRANTY/INSPECTION) is the closest
// thing to an equipment/job-category summary. Same precedent as
// WorkOrderQueue.jsx and docs/epics/EPIC-6-Technician-Execution-Workspace.md.
//
// Click behavior: only calls onSelect(workOrder.id) -- no navigation,
// no lifecycle action, no detail panel. Phase 6.2's job, not this
// phase's.
function TechnicianWorkOrderCard({ workOrder, isSelected, onSelect }) {
  const plannedParts = (workOrder.inventorySnapshot ?? []).filter((item) => item.qtyPlanned);

  return (
    <div
      className={`disp-wo-card${isSelected ? " disp-wo-card--selected" : ""}`}
      onClick={() => onSelect(workOrder.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(workOrder.id);
        }
      }}
      aria-pressed={isSelected}
      aria-label={`Work Order ${workOrder.woNumber}, status ${workOrder.status}, priority ${workOrder.priority}`}
    >
      <div className="disp-wo-card-header">
        <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{workOrder.status}</span>
        <span className="fo-muted">Priority {workOrder.priority}</span>
      </div>
      <div>{workOrder.woNumber}</div>
      <div className="fo-muted">
        Customer: {workOrder.customerId} | {workOrder.type}
      </div>
      {plannedParts.length > 0 && (
        <div className="fo-muted">
          Parts planned: {plannedParts.map((item) => item.name || getCatalogItem(item.sku)?.name || item.sku).join(", ")}
        </div>
      )}
    </div>
  );
}

export default memo(TechnicianWorkOrderCard);

// Epic 2 Phase 2C -- left pane. Pure renderer: takes already-computed
// recommendations (from DispatcherBoard.jsx) and already-loaded
// workOrders/technicians, does no scoring or Firestore access itself.
//
// "Customer name" and "equipment summary" are shown using the only
// real fields that exist -- WorkOrder has no customerName or
// equipment field (see types/workOrder.ts): customerId is an opaque
// string id, and `type` (SERVICE_CALL/PM/INSTALL/WARRANTY/INSPECTION)
// is the closest thing to an equipment/job-category summary.
export default function WorkOrderQueue({ workOrders, recommendationsByWorkOrderId, technicians, selectedId, onSelect }) {
  const techName = (id) => technicians.find((t) => t.id === id)?.name ?? id;

  function handleDragStart(e, workOrder) {
    e.dataTransfer.setData("text/plain", workOrder.id);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="disp-pane disp-pane--queue">
      <h3>Work Order Queue ({workOrders.length})</h3>
      {workOrders.map((wo) => {
        const recs = recommendationsByWorkOrderId.get(wo.id) ?? [];
        const top = recs[0];
        return (
          <div
            key={wo.id}
            className={`disp-wo-card${selectedId === wo.id ? " disp-wo-card--selected" : ""}`}
            draggable
            onDragStart={(e) => handleDragStart(e, wo)}
            onClick={() => onSelect(wo.id)}
          >
            <div className="disp-wo-card-header">
              <span className={`wo-status wo-${wo.status.toLowerCase()}`}>{wo.status}</span>
              <span className="fo-muted">Priority {wo.priority}</span>
            </div>
            <div>{wo.woNumber}</div>
            <div className="fo-muted">Customer: {wo.customerId} | {wo.type}</div>
            {wo.assignedTechId ? (
              <div className="fo-muted">Assigned: {techName(wo.assignedTechId)}</div>
            ) : top ? (
              <div className="fo-muted">
                Recommended: {techName(top.techId)} ({top.score}%)
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

import { getCatalogItem } from "../../data/partsCatalog";
import TechnicianWorkOrderActions from "./TechnicianWorkOrderActions";

// Epic 6 Phase 6.2 -- the technician execution entry point. Rendered
// inline within TechnicianDashboard.jsx when a Work Order is selected
// (no new route/navigation architecture -- see that file). Shows
// summary/customer/equipment/status plus the lifecycle actions layer
// (TechnicianWorkOrderActions.jsx); does NOT itself contain any
// status/transition logic.
//
// "Customer" and "equipment" use the only real fields that exist --
// same precedent as TechnicianWorkOrderCard.jsx/WorkOrderQueue.jsx:
// customerId is an opaque string id (no customerName field anywhere),
// and `type` is the closest thing to an equipment/job-category
// summary. Planned parts (inventorySnapshot) are shown for reference
// only -- parts consumption UI is explicitly out of scope for this
// phase (a future phase, per docs/epics/EPIC-6-Technician-Execution-Workspace.md).
export default function TechnicianWorkOrderDetail({ workOrder, onClose }) {
  const plannedParts = (workOrder.inventorySnapshot ?? []).filter((item) => item.qtyPlanned);

  return (
    <div className="fo-card work-order-card">
      <div className="disp-wo-card-header">
        <h3 style={{ margin: 0 }}>{workOrder.woNumber}</h3>
        <button type="button" onClick={onClose}>
          Back to list
        </button>
      </div>

      <div className="fo-muted">
        Priority {workOrder.priority} | Type: {workOrder.type}
      </div>
      <div className="fo-muted">Customer: {workOrder.customerId}</div>

      {workOrder.complaint && <div>Complaint: {workOrder.complaint}</div>}

      {plannedParts.length > 0 && (
        <div className="wo-inventory">
          <h4>Planned Parts</h4>
          <div className="fo-muted">Reference only -- parts usage tracking is a future phase.</div>
          {plannedParts.map((item) => {
            const catalogEntry = getCatalogItem(item.sku);
            const displayName = item.name || catalogEntry?.name || item.sku;
            return (
              <div key={item.sku}>
                - {displayName} ({item.sku}) &rarr; {item.qtyPlanned} {catalogEntry?.unit ?? "unit(s)"}
              </div>
            );
          })}
        </div>
      )}

      <TechnicianWorkOrderActions workOrder={workOrder} />
    </div>
  );
}

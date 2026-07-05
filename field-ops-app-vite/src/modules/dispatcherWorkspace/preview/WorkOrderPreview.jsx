import { getCatalogItem } from "../../../data/partsCatalog";
import { resolveTechnicianName } from "../shared/formatters";
import EmptyState from "../../../shared/ui/EmptyState";

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
export default function WorkOrderPreview({ workOrder, technicians }) {
  if (!workOrder) {
    return <EmptyState message="Select a Work Order to preview it here." />;
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
    </div>
  );
}

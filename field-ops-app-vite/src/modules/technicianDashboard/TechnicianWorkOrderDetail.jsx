import TechnicianWorkOrderActions from "./TechnicianWorkOrderActions";
import ExecutionCapture from "./ExecutionCapture";
import { useWorkOrderFieldContext } from "../../hooks/useWorkOrderFieldContext";
import { resolveCustomerIdentity } from "../../domain/fieldCurrentJob";
import CustomerIdentity from "../../shared/ui/CustomerIdentity.jsx";
import { workOrderPriorityText } from "../../domain/workOrderPriority";

// Epic 6 Phase 6.2/6.3 -- the technician execution entry point.
// Rendered inline within TechnicianDashboard.jsx when a Work Order is
// selected (no new route/navigation architecture -- see that file).
// Shows summary/customer/equipment/status, the lifecycle actions layer
// (TechnicianWorkOrderActions.jsx, Phase 6.2), and the field execution
// capture layer (ExecutionCapture.jsx, Phase 6.3 -- parts used/work
// notes). This file itself contains no status/transition logic and no
// writes of its own.
//
// "Customer" and "equipment" use the only real fields that exist --
// same precedent as TechnicianWorkOrderCard.jsx/WorkOrderQueue.jsx:
// customerId is an opaque string id (no customerName field anywhere),
// and `type` is the closest thing to an equipment/job-category
// summary. Planned-parts display (with qty-used editing) now lives in
// ExecutionCapture.jsx, not duplicated here.
export default function TechnicianWorkOrderDetail({ workOrder, onClose }) {
  const { context: fieldContext, denied: contextDenied } = useWorkOrderFieldContext(workOrder?.id ?? null);
  const customerIdentity = resolveCustomerIdentity(
    workOrder,
    !contextDenied && fieldContext
      ? () => (fieldContext.customer?.state === "RESOLVED" ? fieldContext.customer.displayName : null)
      : null,
  );

  return (
    <div className="fo-card work-order-card fo-touch-targets">
      <div className="disp-wo-card-header">
        <h3 style={{ margin: 0 }}>{workOrder.woNumber}</h3>
        <button type="button" onClick={onClose}>
          Back to list
        </button>
      </div>

      <div className="fo-muted">
        Priority: {workOrderPriorityText(workOrder.priority) ?? "Priority not set"} | Type: {workOrder.type}
      </div>
      {/* Identity via the F1 trusted WorkOrder-keyed projection -- the governed path
          for a technician, who deliberately has NO accounts read. A denial passes no
          resolver, which the domain reports as NOT_AUTHORIZED. The raw id is never
          rendered as the name. */}
      <div className="fo-muted">Customer: <CustomerIdentity identity={customerIdentity} /></div>

      {workOrder.complaint && <div>Complaint: {workOrder.complaint}</div>}

      <TechnicianWorkOrderActions workOrder={workOrder} />
      <ExecutionCapture workOrder={workOrder} />
    </div>
  );
}

import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useWorkOrder } from "../../hooks/useWorkOrder";
import { useAccount } from "../../hooks/useAccount";
import { useLocation as useLocationDoc } from "../../hooks/useLocation";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "../../domain/constants";
import WorkOrderDetail from "../controlTower/WorkOrderDetail";

// Sprint 2.0.3 -- Service > Work Orders detail route
// (/service/work-orders/:workOrderId). Thin route wrapper: fetches
// the Work Order + its Account/Location (for display names) +
// job/technician context, then renders the existing WorkOrderDetail.jsx
// unchanged in structure.
//
// This route is gated to admin/dispatcher only at the routing layer
// (App.jsx) -- see Sprint 2.0.3's implementation plan Section 7 for
// why (WorkOrderActions.jsx embedded here is dispatcher-only in
// intent; a technician's real lifecycle-action flow is
// TechnicianWorkOrderActions.jsx, on their own separate
// TechnicianDashboard route). Because of that gate, this component
// only ever mounts for admin/dispatcher -- calling useAccount()/
// useLocation() unconditionally here is therefore safe, not a
// technician-facing permission-denied risk.
export default function WorkOrderDetailPage() {
  const { workOrderId } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { workOrder, loading } = useWorkOrder(workOrderId);
  const { account } = useAccount(workOrder?.customerId ?? null);
  const { location } = useLocationDoc(workOrder?.locationId ?? null);
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  if (loading) return <div className="fo-panel"><p className="fo-muted">Loading work order...</p></div>;

  if (!workOrder) {
    return (
      <div className="fo-panel">
        <p className="fo-muted">Work order not found.</p>
        <button type="button" onClick={() => navigate("/service/work-orders")}>Back to Work Orders</button>
      </div>
    );
  }

  const jobsForThisWorkOrder = jobs.filter((j) => j.workOrderId === workOrder.id);

  return (
    <div className="fo-panel">
      <button type="button" onClick={() => navigate("/service/work-orders")} className="fo-link-btn">
        &larr; Back to Work Orders
      </button>
      <WorkOrderDetail
        workOrder={workOrder}
        jobs={jobsForThisWorkOrder}
        role={role}
        technicians={technicians}
        customerName={account?.name}
        locationLabel={location?.name}
      />
    </div>
  );
}

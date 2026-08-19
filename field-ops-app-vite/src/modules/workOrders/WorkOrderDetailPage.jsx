import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useWorkOrder } from "../../hooks/useWorkOrder";
import { useAccount } from "../../hooks/useAccount";
import { useLocation as useLocationDoc } from "../../hooks/useLocation";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import { Button } from "../../shared/ui/primitives";
import WorkOrderDetail from "../controlTower/WorkOrderDetail";
import WorkOrderPartsPlanEditor from "./WorkOrderPartsPlanEditor";
import { useWorkOrderPartsPlanCapability } from "../../access/useWorkOrderPartsPlanCapability.js";

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
  const { role, user } = useAuth();
  const partsPlanCapability = useWorkOrderPartsPlanCapability(user);
  const { workOrder, loading, error, retry } = useWorkOrder(workOrderId);
  const { account, error: accountError } = useAccount(workOrder?.customerId ?? null);
  const { location, error: locationError } = useLocationDoc(workOrder?.locationId ?? null);
  const { data: technicians, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  if (loading) return <div className="fo-panel"><LoadingState>Loading work order…</LoadingState></div>;

  // H14 -- a denied/failed Work Order read used to leave `loading` true
  // forever (no error, no recovery). It now resolves with a distinct
  // failure, never conflated with the CONFIRMED-absence "could not be
  // found" message below, which only applies to a successful read that
  // found no such Work Order.
  if (error) {
    return (
      <div className="fo-panel">
        <FailureState
          message={error}
          action={<Button variant="secondary" onClick={retry}>Retry</Button>}
        />
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="fo-panel">
        <FailureState
          message="This work order could not be found."
          action={<Button variant="secondary" onClick={() => navigate("/service/work-orders")}>Back to Work Orders</Button>}
        />
      </div>
    );
  }

  // F0 -- a governed Work Order has no child job rows: it IS the execution
  // record, carrying its own status, lifecycle timestamps and executionLog.
  // The legacy fieldops_jobs read that populated this has been removed rather
  // than repointed, because there is nothing on the governed model to repoint
  // it AT. Passing the Work Order itself keeps the detail panel's contract.
  const jobsForThisWorkOrder = [workOrder];

  return (
    <div className="fo-panel">
      <Button variant="tertiary" onClick={() => navigate("/service/work-orders")} className="fo-link-btn">
        &larr; Back to Work Orders
      </Button>
      {/* H14 -- these two reads used to be dropped entirely (no error, no
          loading) even though useAccount.js/useFirestoreCollection.js
          already exposed them. A denied Account read rendered a blank/
          raw-id customer name with no indication anything failed; a denied
          Technicians read rendered as an empty list, indistinguishable from
          "no technicians exist". Both now render a visible failure instead
          of silently falling back. */}
      {accountError && <FailureState message={accountError} />}
      {locationError && <FailureState message={locationError} />}
      {techniciansError && (
        <FailureState message="You don't have access to the technician list. Some assignment info may be missing." />
      )}
      <WorkOrderDetail
        workOrder={workOrder}
        jobs={jobsForThisWorkOrder}
        role={role}
        technicians={technicians}
        customerName={account?.name}
        locationLabel={location?.name}
      />
      {/* WO Parts Planning. Hosted here rather than inside WorkOrderDetail because this route is the
          admin/dispatcher-gated planning surface (see the gate note above), while WorkOrderDetail is a
          pure presentation component. No refresh prop is needed: useWorkOrder is an onSnapshot
          listener, so a saved plan re-renders from the persisted document rather than from optimistic
          client state. */}
      <WorkOrderPartsPlanEditor workOrder={workOrder} capability={partsPlanCapability} />
    </div>
  );
}

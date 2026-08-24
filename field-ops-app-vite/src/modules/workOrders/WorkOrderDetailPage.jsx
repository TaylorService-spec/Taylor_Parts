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
import { objectListPathWithState, OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import { savedListState } from "../../navigation/listStateMemory.js";
import MetadataRecordPage from "../../metadata/MetadataRecordPage.jsx";
import { workOrderRecordPage } from "../../metadata/definitions/workOrderPage.js";
import { workOrderEntity } from "../../metadata/definitions/workOrder.js";
import { REFERENCE_STATE } from "../../metadata/referenceResolution.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";

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

  /**
   * BACK TO WORK ORDERS — and it now goes there.
   *
   * It navigated to "/service/work-orders", which matches NO route: the Work Orders nav item declares
   * `path: ""` and is therefore the INDEX of /service. An unmatched path fell through to the
   * catch-all, so a control labelled "Back to Work Orders" reliably landed on the Dashboard. The
   * label was telling the truth about intent; the code was not.
   *
   * The path is DERIVED from the nav config rather than typed, so a future move follows
   * automatically. The saved list state rides along, so filters and sort survive the round trip —
   * and deliberately NOT browser history, which would send this control somewhere different
   * depending on where the record happened to be opened from.
   */
  const backToWorkOrders = () => navigate(
    objectListPathWithState(OBJECT_LIST_KEY.WORK_ORDERS, savedListState(OBJECT_LIST_KEY.WORK_ORDERS)),
  );
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
          action={<Button variant="secondary" onClick={backToWorkOrders}>Back to Work Orders</Button>}
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

  // REFERENCES BECOME NAMES, through the resolvers this page already reads.
  //
  // Every one of these ids is a routing key, never content. Where a read failed the page already
  // renders a visible failure above; the field itself says the reference did not resolve rather
  // than printing the key (DECISIONS #106).
  const resolveWorkOrderReference = (fieldId, id) => {
    if (fieldId === "customerId") {
      return account?.name
        ? { state: REFERENCE_STATE.FOUND, label: account.name }
        : { state: REFERENCE_STATE.NOT_FOUND };
    }
    if (fieldId === "locationId") {
      return location?.name
        ? { state: REFERENCE_STATE.FOUND, label: location.name }
        : { state: REFERENCE_STATE.NOT_FOUND };
    }
    if (fieldId === "assignedTechId") {
      // Delegated to the ONE technician vocabulary rather than a `find(...)?.name ?? id` written
      // here -- that fallback is exactly how a raw id reaches a screen.
      const identity = resolveTechnicianIdentity(id, { technicians });
      if (identity.state === "resolved") return { state: REFERENCE_STATE.FOUND, label: identity.name };
      return { state: REFERENCE_STATE.NOT_FOUND };
    }
    return undefined;
  };

  return (
    <div className="fo-panel">
      <Button variant="tertiary" onClick={backToWorkOrders} className="fo-link-btn">
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
      {/* ═══ THE SHARED RECORD SHELL ═══
          The Work Order's own facts, in the same grammar every other core object uses.

          NO PENCILS, and that is derived rather than restrained: there is no field-patch command
          for a Work Order at all. STATUS especially is the OUTPUT of a lifecycle transition --
          transitionWorkOrder takes an ACTION NAME and the engine decides whether it is legal from
          where the record is now. A status dropdown would bypass every guard silently, landing the
          record in a state no transition could have produced. Assignment is the same: it is what a
          Dispatch action DOES, and a patched assignedTechId is an assignment nobody dispatched.

          The lifecycle, execution and parts-planning actions below are untouched. */}
      <MetadataRecordPage
        definition={workOrderRecordPage}
        record={workOrder}
        entityResolver={() => workOrderEntity}
        resolveReference={resolveWorkOrderReference}
      />
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

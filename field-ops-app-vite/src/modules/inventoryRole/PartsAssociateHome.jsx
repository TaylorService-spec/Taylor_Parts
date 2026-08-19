import { useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useReorderRequestsAssignedTo } from "../../hooks/useReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import { RequestCards, AssignedRequestDetail } from "../../shared/reorder/AssociateRequestPanel.jsx";

// Issue #100 PR 3b (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md) -- the
// dedicated /inventory-role/mine surface for an ACTIVE, reciprocally
// linked PARTS_ASSOCIATE technician. Route/nav gating (App.jsx,
// navConfig.js's operationalRoleAccess) already keeps this component from
// ever mounting for admin/dispatcher or an ineligible technician, so no
// role check is repeated here -- same convention PR 1b/2b already
// establish.
//
// Wave 6 -- queue consolidation (Owner directive, Option A). RequestCards + the assigned-
// request detail cards (Start Purchasing / Purchasing In Progress / Ordered / Terminal) are
// now the SAME shared components field-ops-app-vite/src/shared/reorder/AssociateRequestPanel.jsx
// also powers PartsList.jsx's "Parts -> WORK" (My Work) section -- ONE implementation, not
// two independently-maintained copies. Behavior, data sources, and the four governed domain
// functions (startPurchasing/updatePurchasingProgress/recordPurchaseOrder/
// receiveReorderRequest) are UNCHANGED; only the render logic moved.
export default function PartsAssociateHome({ accessVersion } = {}) {
  const { user } = useAuth();
  // OD-3: canonical part-name resolution (fail-closed; degrades to raw partId, never
  // the static-catalog name). Does not gate any operational table below. `accessVersion`
  // is threaded from App so an access change re-runs the read and invalidates the prior
  // name map before the replacement read settles.
  const { resolveName, namesUnavailable } = useCanonicalPartNames({ uid: user?.uid, accessVersion });
  const { data: waiting, loading: waitingLoading, error: waitingError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE
  );
  const { data: inProgress, loading: inProgressLoading, error: inProgressError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS
  );
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  // Focus restoration: the triggering "View" button that opened the
  // inline Request Detail panel, so closing it returns focus there
  // instead of dropping it to <body> -- same convention
  // WarehouseManagerHome.jsx/PartsManagerHome.jsx already establish.
  const lastTriggerRef = useRef(null);

  function handleSelect(requestId, triggerEl) {
    lastTriggerRef.current = triggerEl;
    setSelectedRequestId(requestId);
  }

  function handleCloseDetail() {
    setSelectedRequestId(null);
    lastTriggerRef.current?.focus();
  }

  const context = (
    <ContextBand
      items={[
        { key: "waiting", label: "Waiting", value: waiting.length },
        { key: "inProgress", label: "In Progress", value: inProgress.length },
      ]}
    />
  );

  return (
    <WorkspaceShell title="My Purchasing" context={context}>
      <p className="fo-muted">Reorder Requests currently assigned to you.</p>

      {namesUnavailable && (
        <p className="fo-muted" role="status">Some part names are unavailable; Part IDs are shown.</p>
      )}

      <h3>Waiting</h3>
      <LoadingEmptyState
        loading={waitingLoading}
        failed={!!waitingError}
        isEmpty={waiting.length === 0}
        loadingText="Loading your assigned requests..."
        failedText="Unable to load your assigned requests right now. Try again shortly."
        emptyText="No requests currently waiting on you."
      >
        <RequestCards requests={waiting} resolveName={resolveName} onSelect={handleSelect} />
      </LoadingEmptyState>

      <h3>In Progress</h3>
      <LoadingEmptyState
        loading={inProgressLoading}
        failed={!!inProgressError}
        isEmpty={inProgress.length === 0}
        loadingText="Loading your in-progress purchasing..."
        failedText="Unable to load your in-progress purchasing right now. Try again shortly."
        emptyText="No purchasing currently in progress."
      >
        <RequestCards requests={inProgress} resolveName={resolveName} onSelect={handleSelect} />
      </LoadingEmptyState>

      {selectedRequestId && (
        <AssignedRequestDetail requestId={selectedRequestId} resolveName={resolveName} onClose={handleCloseDetail} />
      )}
    </WorkspaceShell>
  );
}

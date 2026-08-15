import { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { useReorderRequestsByStatus, useReorderRequestsByStatuses, useReviewedRequestsHistory } from "../../hooks/useReorderRequests";
import { useAssignableEmployees } from "../../hooks/useAssignableEmployees";
import { getDisplayQty } from "../../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS, OPERATIONAL_ROLE } from "../../domain/constants";
import InventoryHealthPanel from "../operations/panels/InventoryHealthPanel";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import { formatTimestamp } from "../../domain/displayTimestamp.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import ManagerQueuePanel from "../../shared/reorder/ManagerQueuePanel.jsx";
import AssignedWorkOversightTable from "../../shared/reorder/AssignedWorkOversightTable.jsx";

// Issue #100 PR 1b (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md) -- the
// dedicated /inventory-role/manager surface for an ACTIVE, reciprocally
// linked PARTS_MANAGER technician. Route/nav gating (App.jsx,
// navConfig.js's operationalRoleAccess) already keeps this component from
// ever mounting for admin/dispatcher or an ineligible technician, so no
// role check is repeated here -- same convention PR 2b's
// WarehouseManagerHome.jsx already establishes.
//
// Wave 6 -- queue consolidation (Owner directive, Option A). The Parts Manager Queue
// (with its Assign action) and the Assigned-Work Oversight table are now the SAME shared
// components field-ops-app-vite/src/shared/reorder/{ManagerQueuePanel,
// AssignedWorkOversightTable}.jsx also power PartsList.jsx's "Parts -> WORK" (Team Work)
// section -- ONE implementation, not three independently-maintained copies. Behavior,
// data sources, and role/capability checks are UNCHANGED (same governed
// assignReorderRequest(), same useReorderRequestsByStatus/useReorderRequestsByStatuses
// reads); only the render logic moved.
//
// Assignee-name resolution for the oversight table reuses the SAME already-scoped
// useAssignableEmployees() result this surface already loads for the Assign picker --
// NOT the unscoped useEmployeeDirectory() PartsList.jsx's own admin/dispatcher-audience
// caller uses. An assignee not found in that lookup renders "Unknown assignee", never a
// raw uid.
function resolveAssigneeDisplayFromAssignable(userId, employeesByUserId) {
  if (!userId) return "—";
  return employeesByUserId.get(userId)?.displayName ?? "Unknown assignee";
}

const HISTORY_STATUS_LABEL = {
  [REORDER_REQUEST_STATUS.CANCELLED]: "Cancelled",
  [REORDER_REQUEST_STATUS.VOIDED]: "Voided",
  [REORDER_REQUEST_STATUS.RECEIVED]: "Received",
  [REORDER_REQUEST_STATUS.REJECTED]: "Rejected",
};

const OVERSIGHT_STATUSES = [REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE, REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS];

export default function PartsManagerHome({ accessVersion } = {}) {
  const { user } = useAuth();
  // OD-3: canonical part-name resolution (fail-closed; degrades to raw partId, never
  // the static-catalog name). Does not gate any operational table below. `accessVersion`
  // is threaded from App so an access change re-runs the read and invalidates the prior
  // name map before the replacement read settles.
  const { resolveName, namesUnavailable } = useCanonicalPartNames({ uid: user?.uid, accessVersion });
  const { healthEntries, loading: healthLoading, error: healthError } = useInventoryLedger();
  const { data: queue, loading: queueLoading, error: queueError } = useReorderRequestsByStatus(REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER);
  const { data: oversight, loading: oversightLoading, error: oversightError } = useReorderRequestsByStatuses(OVERSIGHT_STATUSES);
  const { data: history, loading: historyLoading, error: historyError } = useReviewedRequestsHistory(user?.uid);
  // Used only to resolve assignee display names in the oversight table below --
  // EmployeeAssignmentPicker (inside ManagerQueuePanel's AssignPanel) loads its own,
  // independent copy of this same query for the picker itself.
  const {
    employees: assignableEmployees,
    loading: assigneesLoading,
    error: assigneesError,
  } = useAssignableEmployees({ requiredOperationalRole: OPERATIONAL_ROLE.PARTS_ASSOCIATE });

  const employeesByUserId = useMemo(() => {
    const map = new Map();
    for (const employee of assignableEmployees) {
      if (employee.userId) map.set(employee.userId, employee);
    }
    return map;
  }, [assignableEmployees]);

  const context = (
    <ContextBand
      items={[
        { key: "queue", label: "Queue", value: queue.length },
        { key: "oversight", label: "Assigned", value: oversight.length },
      ]}
    />
  );

  return (
    <WorkspaceShell title="Parts Manager" context={context}>
      {namesUnavailable && (
        <p className="fo-muted" role="status">Some part names are unavailable; Part IDs are shown.</p>
      )}

      <p className="fo-muted">
        Parts ranked by urgency, from the same analytics used by the Operations dashboard's Inventory Health panel.
        Read-only -- Reorder Requests for these analytics-computed recommendations are submitted by Purchasing, not
        here.
      </p>
      {healthError ? (
        <p className="fo-muted">Unable to load inventory health right now. Try again shortly.</p>
      ) : (
        <LoadingEmptyState loading={healthLoading} isEmpty={false} loadingText="Loading inventory health..." emptyText="">
          <InventoryHealthPanel healthEntries={healthEntries} resolveName={resolveName} />
        </LoadingEmptyState>
      )}

      <ManagerQueuePanel queue={queue} resolveName={resolveName} loading={queueLoading} error={queueError} />

      {assigneesLoading && <p className="fo-muted" role="status">Loading assignee names...</p>}
      {assigneesError && (
        <p className="fo-muted" role="alert">
          Assignee names are unavailable right now. Assigned work remains visible with unknown assignee labels.
        </p>
      )}
      <AssignedWorkOversightTable
        requests={oversight}
        resolveName={resolveName}
        resolveAssigneeDisplay={(userId) => resolveAssigneeDisplayFromAssignable(userId, employeesByUserId)}
        loading={oversightLoading}
        error={oversightError}
        title="Assigned-Work Oversight"
        description="Every Reorder Request currently assigned to a Parts Associate, regardless of who assigned it."
      />

      <h3>Relevant History</h3>
      <p className="fo-muted">Reorder Requests you personally approved, rejected, or assigned, now at a terminal status.</p>
      {historyError ? (
        <p className="fo-muted" role="alert">Unable to load Relevant History right now. Try again shortly.</p>
      ) : (
        <LoadingEmptyState
          loading={historyLoading}
          isEmpty={history.length === 0}
          loadingText="Loading Relevant History..."
          emptyText="No terminal Reorder Requests you reviewed or assigned yet."
        >
          <table className="fo-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {history.map((request) => (
                <tr key={request.id}>
                  <td>{resolveName(request.partId)}</td>
                  <td>{getDisplayQty(request)}</td>
                  <td className="fo-muted">{HISTORY_STATUS_LABEL[request.status] ?? request.status}</td>
                  <td className="fo-muted">{formatTimestamp(request.createdAt, { unknown: "—" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LoadingEmptyState>
      )}
    </WorkspaceShell>
  );
}

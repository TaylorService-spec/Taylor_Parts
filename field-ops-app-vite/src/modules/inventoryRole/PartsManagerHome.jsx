import { useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { useReorderRequestsByStatus, useReorderRequestsByStatuses, useReviewedRequestsHistory } from "../../hooks/useReorderRequests";
import { useAssignableEmployees } from "../../hooks/useAssignableEmployees";
import { assignReorderRequest, getDisplayQty } from "../../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS, OPERATIONAL_ROLE } from "../../domain/constants";
import InventoryHealthPanel from "../operations/panels/InventoryHealthPanel";
import EmployeeAssignmentPicker from "../../shared/assignment/EmployeeAssignmentPicker";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import { formatAssignmentAge } from "../inventory/PartsList";
import { formatTimestamp } from "../../domain/displayTimestamp.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import OperationalCard, { OperationalCardGrid } from "../../shared/ui/OperationalCard.jsx";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone.js";

// Issue #100 PR 1b (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md) -- the
// dedicated /inventory-role/manager surface for an ACTIVE, reciprocally
// linked PARTS_MANAGER technician. Route/nav gating (App.jsx,
// navConfig.js's operationalRoleAccess) already keeps this component from
// ever mounting for admin/dispatcher or an ineligible technician, so no
// role check is repeated here -- same convention PR 2b's
// WarehouseManagerHome.jsx already establishes.
//
// Reuses, unchanged: useInventoryLedger()/InventoryHealthPanel.jsx
// (read-only here -- catalog/health visibility is this surface's only
// stock-related capability; "Needs Planning / manual reorder" is scoped
// to WAREHOUSE_MANAGER's own surface per the Specification's §1/§2 split,
// not repeated here even though the underlying Rules helper also admits
// PARTS_MANAGER), useReorderRequestsByStatus(READY_FOR_PARTS_MANAGER)
// (Parts Manager Queue), useReorderRequestsByStatuses([ASSIGNED_TO_
// PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS]) (assigned-work oversight),
// EmployeeAssignmentPicker/useAssignableEmployees({ requiredOperationalRole:
// PARTS_ASSOCIATE }) (Assign), and assignReorderRequest() (the existing,
// unmodified domain function PartDetail.jsx's own Assign action already
// calls). New: useReviewedRequestsHistory(uid) (hooks/useReorderRequests.js).
//
// Assignee-name resolution for the oversight table reuses the SAME
// already-scoped useAssignableEmployees() result this surface already
// loads for the Assign picker -- not useEmployeeDirectory()'s unscoped
// read. An assignee not found in that lookup renders "Unknown assignee",
// never a raw uid, matching PartsList.jsx's own resolveAssigneeDisplay()
// convention in spirit (a separate, local function here, since that one
// is built on useEmployeeDirectory() specifically -- reusing it would
// reintroduce the exact unscoped read this Specification's design
// deliberately avoids).
function resolveAssigneeDisplayFromAssignable(userId, employeesByUserId) {
  if (!userId) return "—";
  return employeesByUserId.get(userId)?.displayName ?? "Unknown assignee";
}

function AssignPanel({ request, resolveName, onAssigned, onClose }) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const partName = resolveName(request.partId);

  function handleEmployeeSelect(employee) {
    setSelectedEmployeeId(employee.employeeId);
    setAssignedToUserId(employee.userId);
  }

  async function handleAssign(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await assignReorderRequest(request.id, { assignedToUserId });
      onAssigned();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-card">
      <div className="fo-workspace-header">
        <h3 className="fo-workspace-header-title">Assign -- {partName}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <form className="fo-form" onSubmit={handleAssign}>
        {error && <p className="fo-muted">{error}</p>}
        <EmployeeAssignmentPicker
          requiredOperationalRole={OPERATIONAL_ROLE.PARTS_ASSOCIATE}
          selectedEmployeeId={selectedEmployeeId}
          onSelect={handleEmployeeSelect}
          disabled={submitting}
          label="Assign to Parts Associate"
          placeholder="Search employees by name..."
        />
        <div className="disp-board-toolbar">
          <button type="submit" disabled={submitting || !assignedToUserId}>
            {submitting ? "Assigning..." : "Assign"}
          </button>
        </div>
      </form>
    </div>
  );
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
  // Used only to resolve assignee display names in the oversight table
  // below -- EmployeeAssignmentPicker (inside AssignPanel) loads its own,
  // independent copy of this same query for the picker itself.
  const {
    employees: assignableEmployees,
    loading: assigneesLoading,
    error: assigneesError,
  } = useAssignableEmployees({ requiredOperationalRole: OPERATIONAL_ROLE.PARTS_ASSOCIATE });
  const [assigningRequestId, setAssigningRequestId] = useState(null);
  // Focus restoration: the triggering "Assign" button that opened the
  // inline Assign panel, so closing it (button or after a successful
  // assign) returns focus there instead of dropping it to <body> -- same
  // convention WarehouseManagerHome.jsx's Part Activity panel already
  // establishes.
  const lastTriggerRef = useRef(null);

  const employeesByUserId = useMemo(() => {
    const map = new Map();
    for (const employee of assignableEmployees) {
      if (employee.userId) map.set(employee.userId, employee);
    }
    return map;
  }, [assignableEmployees]);

  const assigningRequest = queue.find((r) => r.id === assigningRequestId) ?? null;

  function handleCloseAssignPanel() {
    setAssigningRequestId(null);
    lastTriggerRef.current?.focus();
  }

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

      <h3>Parts Manager Queue</h3>
      <p className="fo-muted">Reorder Requests approved by Inventory review, awaiting assignment to a Parts Associate.</p>
      <LoadingEmptyState
        loading={queueLoading}
        isEmpty={queue.length === 0}
        loadingText="Loading Parts Manager Queue..."
        emptyText={queueError ? "Unable to load the Parts Manager Queue right now. Try again shortly." : "No requests awaiting assignment."}
      >
        {/* A short, browseable "awaiting assignment" queue of bounded peer objects (one
            Reorder Request each) -- an OperationalCard grid, not a dense scan-to-compare
            table. `actions` mode keeps the existing "Assign {name}" button (its exact
            aria-label is a test hook) as its own element outside the card wrapper. */}
        <OperationalCardGrid aria-label="Parts Manager Queue">
          {queue.map((request) => (
            <li key={request.id}>
              <OperationalCard
                title={resolveName(request.partId)}
                status={
                  request.urgency
                    ? { tone: inventoryUrgencyTone(request.urgency), label: request.urgency }
                    : { tone: "unknown", label: "Needs planning" }
                }
                metadata={[
                  { key: "qty", label: "Qty", value: getDisplayQty(request) },
                  { key: "approved", label: "Approved", value: formatTimestamp(request.reviewedAt, { unknown: "—" }) },
                ]}
                actions={
                  <button
                    type="button"
                    aria-label={`Assign ${resolveName(request.partId)}`}
                    onClick={(e) => {
                      lastTriggerRef.current = e.currentTarget;
                      setAssigningRequestId(request.id);
                    }}
                  >
                    Assign
                  </button>
                }
              />
            </li>
          ))}
        </OperationalCardGrid>
      </LoadingEmptyState>

      {assigningRequest && (
        <AssignPanel
          request={assigningRequest}
          resolveName={resolveName}
          onAssigned={handleCloseAssignPanel}
          onClose={handleCloseAssignPanel}
        />
      )}

      <h3>Assigned-Work Oversight</h3>
      <p className="fo-muted">Every Reorder Request currently assigned to a Parts Associate, regardless of who assigned it.</p>
      {assigneesLoading && <p className="fo-muted" role="status">Loading assignee names...</p>}
      {assigneesError && (
        <p className="fo-muted" role="alert">
          Assignee names are unavailable right now. Assigned work remains visible with unknown assignee labels.
        </p>
      )}
      {oversightError ? (
        <p className="fo-muted" role="alert">Unable to load assigned-work oversight right now. Try again shortly.</p>
      ) : (
        <LoadingEmptyState
          loading={oversightLoading}
          isEmpty={oversight.length === 0}
          loadingText="Loading assigned-work oversight..."
          emptyText="No requests are currently assigned to anyone."
        >
          <div className="fo-table-scroll">
            <table className="fo-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Qty</th>
                  <th>Urgency</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {oversight.map((request) => (
                  <tr key={request.id}>
                    <td>{resolveName(request.partId)}</td>
                    <td>{getDisplayQty(request)}</td>
                    <td>
                      {request.urgency ? (
                        <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={request.urgency} />
                      ) : (
                        <StatusPill tone="unknown" label="Needs planning" />
                      )}
                    </td>
                    <td className="fo-muted">
                      {request.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS ? "In Progress" : "Waiting"}
                    </td>
                    <td className="fo-muted">{resolveAssigneeDisplayFromAssignable(request.assignedToUserId, employeesByUserId)}</td>
                    <td className="fo-muted">{formatAssignmentAge(request.assignedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LoadingEmptyState>
      )}

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

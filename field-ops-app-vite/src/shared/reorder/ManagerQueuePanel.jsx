import { useEffect, useRef, useState } from "react";
import { assignReorderRequest, getDisplayQty } from "../../domain/inventoryReorderRequests.js";
import { OPERATIONAL_ROLE } from "../../domain/constants.js";
import EmployeeAssignmentPicker from "../assignment/EmployeeAssignmentPicker.jsx";
import LoadingEmptyState from "../ui/LoadingEmptyState.jsx";
import OperationalCard, { OperationalCardGrid } from "../ui/OperationalCard.jsx";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone.js";
import { formatTimestamp } from "../../domain/displayTimestamp.js";
import { Button } from "../ui/primitives/index.js";

// Wave 6 -- queue consolidation (Owner directive, Option A: Parts -> WORK becomes the
// primary actionable Parts workspace; extract/reuse the existing actionable components
// rather than a third independently-maintained copy). Extracted from PartsManagerHome.jsx's
// own "Parts Manager Queue" section + AssignPanel, UNCHANGED behavior -- same governed
// assignReorderRequest() call PartDetail.jsx's own Assign action already uses, same
// EmployeeAssignmentPicker(requiredOperationalRole: PARTS_ASSOCIATE) eligibility scoping.
// Reused by PartsManagerHome.jsx (unchanged persona/scope) AND PartsList.jsx's Parts ->
// WORK "Team Work" section (admin/dispatcher, who already hold `reorder.request.assign`
// unconditionally -- see compatibilityRoles.ts's SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS
// -- so making this actionable there widens no capability, it only reuses one already
// granted). The server-side trusted command is the SAME either way; this component invokes
// no new write path.
function AssignPanel({ request, resolveName, onAssigned, onClose }) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const partName = resolveName(request.partId);
  // Mobile-queue repair: the panel now mounts inline beneath the selected card, which on a
  // long queue can still sit below the fold of wherever the user tapped. Bring it into view
  // and put focus in the picker so the tap visibly did something. Guarded: jsdom implements
  // neither scrollIntoView nor a layout to scroll.
  const panelRef = useRef(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    panel.querySelector('[role="combobox"]')?.focus();
  }, []);

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
    <div className="fo-card" ref={panelRef}>
      <div className="fo-workspace-header">
        <h3 className="fo-workspace-header-title">Assign -- {partName}</h3>
        <Button type="button" variant="tertiary" onClick={onClose}>
          Close
        </Button>
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
          <Button type="submit" loading={submitting} disabled={!assignedToUserId}>
            Assign
          </Button>
        </div>
      </form>
    </div>
  );
}

// `queue`: READY_FOR_PARTS_MANAGER requests. `title`/`description`: caller-supplied copy
// (PartsManagerHome and Parts WORK use slightly different framing for the same queue).
export default function ManagerQueuePanel({
  queue,
  resolveName,
  loading,
  error,
  title = "Parts Manager Queue",
  description = "Reorder Requests approved by Inventory review, awaiting assignment to a Parts Associate.",
}) {
  const [assigningRequestId, setAssigningRequestId] = useState(null);
  // Focus restoration: the triggering "Assign" button that opened the inline Assign panel.
  const lastTriggerRef = useRef(null);

  function handleCloseAssignPanel() {
    setAssigningRequestId(null);
    lastTriggerRef.current?.focus();
  }

  return (
    <>
      <h3>{title}</h3>
      <p className="fo-muted">{description}</p>
      <LoadingEmptyState
        loading={loading}
        failed={!!error}
        isEmpty={queue.length === 0}
        loadingText={`Loading ${title}...`}
        failedText={`Unable to load the ${title} right now. Try again shortly.`}
        emptyText="No requests awaiting assignment."
      >
        <OperationalCardGrid aria-label={title}>
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
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Assign ${resolveName(request.partId)}`}
                    onClick={(e) => {
                      lastTriggerRef.current = e.currentTarget;
                      setAssigningRequestId(request.id);
                    }}
                  >
                    Assign
                  </Button>
                }
              />
              {/* Mobile-queue repair: the panel renders INSIDE the selected request's list
                  item, directly beneath its card — on a long queue the old after-the-grid
                  placement opened it far below the viewport, so tapping Assign appeared to
                  do nothing. One panel at a time by construction (single assigningRequestId);
                  errors/empty states now appear beside the card they belong to. */}
              {assigningRequestId === request.id && (
                <AssignPanel
                  request={request}
                  resolveName={resolveName}
                  onAssigned={handleCloseAssignPanel}
                  onClose={handleCloseAssignPanel}
                />
              )}
            </li>
          ))}
        </OperationalCardGrid>
      </LoadingEmptyState>
    </>
  );
}

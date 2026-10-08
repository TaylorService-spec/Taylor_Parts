import LoadingEmptyState from "../ui/LoadingEmptyState.jsx";
import StatusPill from "../ui/StatusPill.jsx";
import { REORDER_REQUEST_STATUS } from "../../domain/constants.js";
import { getDisplayQty } from "../../domain/inventoryReorderRequests.js";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone.js";
import { formatAge } from "../../domain/displayTimestamp.js";
import { useMemo } from "react";
import { statusLabel } from "../display/displayLabels.js";
import SortableHeader from "../ui/sorting/SortableHeader.jsx";
import { useTableSort } from "../ui/sorting/useTableSort.js";

const URGENCY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const workStatusLabel = (request) =>
  request.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS ? "In Progress" : "Waiting";

// Wave 6 -- queue consolidation, safe mechanical dedup (Owner directive §12). The SAME
// read-only oversight table PartsList.jsx's "All Assigned Work" and PartsManagerHome.jsx's
// "Assigned-Work Oversight" independently re-implemented -- identical purpose (cross-user
// visibility into every Reorder Request currently assigned to a Parts Associate), identical
// data shape, zero action on either side. ONE implementation now, reused by both callers.
//
// `resolveAssigneeDisplay(userId)` is INJECTED, not hardcoded here -- PartsList.jsx (admin/
// dispatcher audience) and PartsManagerHome.jsx (a PARTS_MANAGER-scoped technician) each
// resolve assignee names from a DIFFERENT, deliberately-scoped source (the former the
// unscoped employee directory already visible to admin/dispatcher elsewhere; the latter only
// the assignable-employees set it already loads for its own Assign picker, matching this
// surface's standing "no new unscoped read" rule). Sharing the render logic must never force
// either caller onto the other's data-visibility scope -- this is exactly the "no role gains
// an action/visibility it lacked before" requirement.
export function formatAssignmentAge(assignedAtMs, nowMs = Date.now()) {
  return formatAge(assignedAtMs, nowMs, { unknown: "—" });
}

export default function AssignedWorkOversightTable({
  requests,
  resolveName,
  resolveAssigneeDisplay,
  loading,
  error,
  title = "All Assigned Work",
  description = "Every Reorder Request currently assigned to a Parts Associate, regardless of who it's assigned to -- oversight only, no action control here.",
}) {
  // Client-side sort over the loaded requests (item C); the caller's order is the default.
  const sortColumns = useMemo(() => ({
    part: { value: (r) => resolveName(r.partId) },
    qty: { value: (r) => getDisplayQty(r) },
    urgency: { value: (r) => (r.urgency ? URGENCY_RANK[r.urgency] ?? 4 : 5) },
    status: { value: (r) => workStatusLabel(r) },
    assignee: { value: (r) => resolveAssigneeDisplay(r.assignedEmployeeId ?? r.assignedToUserId) },
    // Ascending age = most recently assigned first.
    age: { value: (r) => {
      const ms = typeof r.assignedAt === "number" ? r.assignedAt : r.assignedAt?.toMillis?.() ?? null;
      return ms === null ? null : -ms;
    } },
  }), [resolveName, resolveAssigneeDisplay]);
  const { sort, toggle, sorted } = useTableSort({ rows: requests, columns: sortColumns });

  const statusMessage = error
    ? `Unable to load ${title} (${error}).`
    : loading
      ? `Loading ${title}...`
      : requests.length === 0
        ? "No requests are currently assigned to anyone."
        : `${title}: ${requests.length} request${requests.length === 1 ? "" : "s"} loaded.`;

  return (
    <>
      <h3>{title} ({requests.length})</h3>
      <p className="fo-muted">{description}</p>
      <p role="status" className="fo-sr-only">{statusMessage}</p>
      <LoadingEmptyState
        loading={loading}
        failed={!!error}
        isEmpty={requests.length === 0}
        loadingText={`Loading ${title}...`}
        failedText={`Unable to load ${title} (${error}).`}
        emptyText="No requests are currently assigned to anyone."
      >
        <div className="fo-table-scroll">
          <table className="fo-table fo-table--stack">
            <thead>
              <tr>
                <SortableHeader columnKey="part" label="Part" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="qty" label="Qty" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="urgency" label="Urgency" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="status" label="Status" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="assignee" label="Assignee" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="age" label="Age" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((request) => (
                <tr key={request.id}>
                  <td>{resolveName(request.partId)}</td>
                  <td>{getDisplayQty(request)}</td>
                  <td>
                    {request.urgency ? (
                      <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={statusLabel(request.urgency)} />
                    ) : (
                      <StatusPill tone="unknown" label="Needs Planning" />
                    )}
                  </td>
                  <td className="fo-muted">
                    {workStatusLabel(request)}
                  </td>
                  <td className="fo-muted">{resolveAssigneeDisplay(request.assignedEmployeeId ?? request.assignedToUserId)}</td>
                  <td className="fo-muted">{formatAssignmentAge(request.assignedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LoadingEmptyState>
    </>
  );
}

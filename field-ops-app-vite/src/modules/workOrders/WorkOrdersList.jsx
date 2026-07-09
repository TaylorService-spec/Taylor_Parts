import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import GlobalSearch from "../../shared/search/GlobalSearch";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";

// Sprint 2.0.3 -- Work Order Experience. The real Service > Work
// Orders screen, replacing the placeholder-adjacent legacy Jobs.jsx
// that previously sat at this nav slot (Jobs.jsx is relocated to
// Service > Job Assignments -- see navConfig.js). Column conventions
// (woNumber/status/customer/type/age) follow WorkOrderQueue.jsx's
// existing choices, but this is a new, simpler component -- rows are
// real <Link> navigations to /service/work-orders/:workOrderId, not a
// selection-driven inline-preview pane (WorkOrderQueue.jsx stays
// exactly as it is, serving DispatcherBoard.jsx's different layout).
//
// Epic 9 -- Platform Workspace Framework: header/toolbar, status-group
// filter bar, and loading/empty-state now come from shared/ui/ instead
// of a locally-hand-rolled copy. No behavior change -- the filter bar
// previously reused fo-nav-btn (tuned for the dark header nav); it now
// uses FilterBar's own light-panel-appropriate styling instead.
const STATUS_GROUPS = [
  { key: "ALL", label: "All", statuses: null },
  { key: "OPEN", label: "Open", statuses: ["CREATED", "READY_TO_DISPATCH", "SCHEDULED"] },
  { key: "ACTIVE", label: "Active", statuses: ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"] },
  { key: "DONE", label: "Done", statuses: ["COMPLETED", "CLOSED"] },
  { key: "CANCELLED", label: "Cancelled", statuses: ["CANCELLED"] },
];

function formatAge(createdAt) {
  if (!createdAt?.toMillis) return null;
  const ms = Date.now() - createdAt.toMillis();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function WorkOrdersList() {
  const { data: workOrders, loading } = useWorkOrders();
  const [statusGroup, setStatusGroup] = useState("ALL");

  const groupCounts = useMemo(() => {
    const counts = {};
    for (const group of STATUS_GROUPS) {
      counts[group.key] = group.statuses ? workOrders.filter((wo) => group.statuses.includes(wo.status)).length : workOrders.length;
    }
    return counts;
  }, [workOrders]);

  const filteredWorkOrders = useMemo(() => {
    const group = STATUS_GROUPS.find((g) => g.key === statusGroup);
    if (!group?.statuses) return workOrders;
    return workOrders.filter((wo) => group.statuses.includes(wo.status));
  }, [workOrders, statusGroup]);

  const filterOptions = STATUS_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    count: groupCounts[group.key] ?? 0,
  }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Work Orders">
        <GlobalSearch providerKeys={["workOrders"]} context={{ workOrders }} placeholder="Search work orders..." />
        <Link to="/service/work-orders/new">
          <button type="button">+ New Work Order</button>
        </Link>
      </WorkspaceHeader>

      <FilterBar options={filterOptions} activeKey={statusGroup} onChange={setStatusGroup} />

      <LoadingEmptyState
        loading={loading}
        isEmpty={filteredWorkOrders.length === 0}
        loadingText="Loading work orders..."
        emptyText="No work orders in this group."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>WO #</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {filteredWorkOrders.map((wo) => (
              <tr key={wo.id}>
                <td>
                  <Link to={`/service/work-orders/${wo.id}`}>{wo.woNumber ?? wo.id}</Link>
                </td>
                <td>
                  <span className={`wo-status wo-${wo.status.toLowerCase()}`}>{wo.status}</span>
                </td>
                <td className="fo-muted">{wo.customerId}</td>
                <td className="fo-muted">{wo.type}</td>
                <td className="fo-muted">{formatAge(wo.createdAt) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>
    </div>
  );
}

// Epic 7 Step 5 -- Dispatcher Insight Layer, read-only. Pure renderer;
// all computation already done by Operations.jsx via
// analytics/executionAnalyticsService.ts's getInventoryConsumptionSnapshot()
// and getTechnicianVolumeBreakdown(). Consistent with Operations'
// existing role (rule 8, docs/CLAUDE_CONTEXT.md): read-only executive/
// monitoring, explicitly not a second dispatcher tool -- no action
// buttons here, ever.
//
// GOVERNED (Work Order cutover completion pass, 2026-09-30): both figures come from the PostgreSQL Work Order
// aggregates over the active Work Order set. Technicians are EOS Employees, named by the server's display name
// (never a fieldops technician document); "used" is recorded execution actuals, not stock movement. When the
// aggregates could not be read, `failure` says WHICH of the four outcomes it was (domain/workOrderOutcome.js) --
// the rest of the Operations dashboard is unaffected.
import { loadErrorMessage } from "../../../domain/loadErrorMessage.js";
import { classifyWorkOrderOutcome, WORK_ORDER_OUTCOME } from "../../../domain/workOrderOutcome.js";
import { useMemo } from "react";
import SortableHeader from "../../../shared/ui/sorting/SortableHeader.jsx";
import { useTableSort } from "../../../shared/ui/sorting/useTableSort.js";

// Client-side sort over the top-five rows already computed (item C); the ranking is the default order.
const TECHNICIAN_SORT_COLUMNS = {
  technician: { value: (t) => t.displayName },
  completed: { value: (t) => t.completedCount },
  open: { value: (t) => t.activeCount },
};

export default function ExecutionInsightsPanel({ consumptionSnapshot, technicianVolume, resolveName, failure = null }) {
  const topParts = useMemo(() => consumptionSnapshot?.parts?.slice(0, 5) ?? [], [consumptionSnapshot]);
  const topTechnicians = useMemo(() => (technicianVolume ?? []).slice(0, 5), [technicianVolume]);
  const partSortColumns = useMemo(() => ({
    part: { value: (p) => resolveName(p.partId) },
    totalUsed: { value: (p) => p.totalQuantityUsed },
    workOrders: { value: (p) => p.frequency },
  }), [resolveName]);
  const partSort = useTableSort({ rows: topParts, columns: partSortColumns });
  const technicianSort = useTableSort({ rows: topTechnicians, columns: TECHNICIAN_SORT_COLUMNS });

  if (failure) {
    const kind = classifyWorkOrderOutcome(failure).kind;
    return (
      <div className="fo-card">
        <h3>Execution Insights</h3>
        <p className="fo-muted" role={kind === WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED ? "status" : "alert"} data-work-order-outcome={kind}>
          {loadErrorMessage(failure, { entity: "execution insights" })}
        </p>
      </div>
    );
  }

  return (
    <div className="fo-card">
      <h3>Execution Insights</h3>
      <p className="fo-muted">Parts used are the technicians' recorded usage on Work Orders; no stock movement is implied.</p>

      <h4>Top Consumed Parts</h4>
      {topParts.length === 0 ? (
        <p className="fo-muted">No parts usage recorded yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="part" label="Part" sort={partSort.sort} onSort={partSort.toggle} />
              <SortableHeader columnKey="totalUsed" label="Total Used" sort={partSort.sort} onSort={partSort.toggle} />
              <SortableHeader columnKey="workOrders" label="Work Orders" sort={partSort.sort} onSort={partSort.toggle} />
            </tr>
          </thead>
          <tbody>
            {partSort.sorted.map((p) => (
              <tr key={p.partId}>
                <td>{resolveName(p.partId)}</td>
                <td>{p.totalQuantityUsed}</td>
                <td>{p.frequency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Busiest Technicians</h4>
      {topTechnicians.length === 0 ? (
        <p className="fo-muted">No assigned Work Orders recorded yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="technician" label="Technician" sort={technicianSort.sort} onSort={technicianSort.toggle} />
              <SortableHeader columnKey="completed" label="Completed" sort={technicianSort.sort} onSort={technicianSort.toggle} />
              {/* "Active vocabulary" note: this is the 5th (Work Order
                  in-progress) sense, and a THIRD distinct population
                  from WorkOrdersList's "Dispatched+" tab and
                  TechnicianCapacityCard's "In Progress" count -- it
                  counts all non-terminal statuses (8), not 5 or 1. See
                  docs/architecture/ADR-012-persona-authority-composition-and-scope.md */}
              <SortableHeader columnKey="open" label="Open Work Orders" sort={technicianSort.sort} onSort={technicianSort.toggle} />
            </tr>
          </thead>
          <tbody>
            {technicianSort.sorted.map((t) => (
              <tr key={t.employeeId}>
                <td>{t.displayName ?? "Name unavailable"}</td>
                <td>{t.completedCount}</td>
                <td>{t.activeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

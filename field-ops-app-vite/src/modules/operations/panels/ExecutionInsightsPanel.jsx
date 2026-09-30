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

export default function ExecutionInsightsPanel({ consumptionSnapshot, technicianVolume, resolveName, failure = null }) {
  const topParts = consumptionSnapshot?.parts?.slice(0, 5) ?? [];
  const topTechnicians = (technicianVolume ?? []).slice(0, 5);

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
              <th>Part</th>
              <th>Total Used</th>
              <th>Work Orders</th>
            </tr>
          </thead>
          <tbody>
            {topParts.map((p) => (
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
              <th>Technician</th>
              <th>Completed</th>
              {/* "Active vocabulary" note: this is the 5th (Work Order
                  in-progress) sense, and a THIRD distinct population
                  from WorkOrdersList's "Dispatched+" tab and
                  TechnicianCapacityCard's "In Progress" count -- it
                  counts all non-terminal statuses (8), not 5 or 1. See
                  docs/architecture/ADR-012-persona-authority-composition-and-scope.md */}
              <th>Open Work Orders</th>
            </tr>
          </thead>
          <tbody>
            {topTechnicians.map((t) => (
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

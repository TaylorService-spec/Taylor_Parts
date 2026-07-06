import { getCatalogItem } from "../../../data/partsCatalog";

// Epic 7 Step 5 -- Dispatcher Insight Layer, read-only. Pure renderer;
// all computation already done by Operations.jsx via
// analytics/executionAnalyticsService.ts's getInventoryConsumptionSnapshot()
// and getTechnicianVolumeBreakdown(). Consistent with Operations'
// existing role (rule 8, docs/CLAUDE_CONTEXT.md): read-only executive/
// monitoring, explicitly not a second dispatcher tool -- no action
// buttons here, ever.
export default function ExecutionInsightsPanel({ consumptionSnapshot, technicianVolume, technicianName }) {
  const topParts = consumptionSnapshot?.parts.slice(0, 5) ?? [];
  const topTechnicians = (technicianVolume ?? []).slice(0, 5);

  return (
    <div className="fo-card">
      <h3>Execution Insights</h3>

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
                <td>{getCatalogItem(p.partId)?.name ?? p.partId}</td>
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
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {topTechnicians.map((t) => (
              <tr key={t.technicianId}>
                <td>{technicianName(t.technicianId)}</td>
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

import { getCatalogItem } from "../../../data/partsCatalog";

// Epic 3 Analytics -- pure renderer, all computation already done by
// Operations.jsx (domain/inventoryAnalyticsEngine.ts). Only shows parts
// with at least one ledger transaction (i.e. actually in play), sorted
// riskiest-first, so this doesn't become a 200-row wall of untouched
// catalog parts.
const URGENCY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export default function InventoryHealthPanel({ healthEntries }) {
  const sorted = [...healthEntries].sort(
    (a, b) => URGENCY_ORDER[a.recommendation.urgency] - URGENCY_ORDER[b.recommendation.urgency]
  );

  return (
    <div className="fo-card">
      <h3>Inventory Health</h3>
      {sorted.length === 0 ? (
        <p className="fo-muted">No ledger activity yet -- nothing to forecast.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Available</th>
              <th>Avg Daily Usage</th>
              <th>Days Remaining</th>
              <th>Risk</th>
              <th>Recommended Reorder Qty</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ partId, stock, usage, recommendation }) => (
              <tr key={partId}>
                <td>{getCatalogItem(partId)?.name ?? partId}</td>
                <td>{stock.availableStock}</td>
                <td>{usage.avgDailyUsage.toFixed(2)}</td>
                <td>{Number.isFinite(usage.avgDailyUsage) && recommendation.daysRemaining !== Infinity ? recommendation.daysRemaining.toFixed(1) : "—"}</td>
                <td>
                  <span className={`fo-badge fo-badge-${recommendation.urgency.toLowerCase()}`}>
                    {recommendation.urgency}
                  </span>
                </td>
                <td>{Math.ceil(recommendation.recommendedOrderQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

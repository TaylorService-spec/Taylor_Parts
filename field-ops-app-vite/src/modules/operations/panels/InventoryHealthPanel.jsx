import { getCatalogItem } from "../../../data/partsCatalog";
import { URGENCY_ORDER } from "../../../domain/inventoryAnalyticsEngine";

// Epic 3 Analytics -- pure renderer, all computation already done by
// Operations.jsx (domain/inventoryAnalyticsEngine.ts). Only shows parts
// with at least one ledger transaction (i.e. actually in play), sorted
// riskiest-first, so this doesn't become a 200-row wall of untouched
// catalog parts.
//
// Sprint 2.1.2 -- `title` is optional (defaults to "Inventory Health",
// this component's original and only heading) so the Inventory
// workspace's "Needs Reorder" queue can reuse this exact renderer with
// its own heading instead of building a second, duplicate table for
// the same data shape. Single source of truth: this is now the only
// place inventory health rows are rendered, in both Operations and the
// Inventory workspace.
export default function InventoryHealthPanel({ healthEntries, title = "Inventory Health" }) {
  const sorted = [...healthEntries].sort(
    (a, b) => URGENCY_ORDER[a.recommendation.urgency] - URGENCY_ORDER[b.recommendation.urgency]
  );

  return (
    <div className="fo-card">
      <h3>{title}</h3>
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

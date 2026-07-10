import { getCatalogItem } from "../../../data/partsCatalog";
import { URGENCY_ORDER, hasUsageHistory } from "../../../domain/inventoryAnalyticsEngine";

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
//
// Sprint 2.1.3 -- `onRequestReorder`/`requestedPartIds` are both
// optional and undefined by default. Operations.jsx's call site does
// NOT pass them, so no action column ever renders there -- Operations
// is a read-only executive/monitoring layer (CLAUDE_CONTEXT.md Rule 8)
// and must never grow an "act on this" affordance. Only PartsList.jsx
// (Inventory workspace) opts in, by passing both props.
//
// Bug fix (post-2.1.7) -- `submittingPartId` (also optional, undefined
// by default) disables the button and shows "Requesting..." for the
// one row currently in flight, so a slow or failed request can't be
// double-clicked into a duplicate create.
export default function InventoryHealthPanel({
  healthEntries,
  title = "Inventory Health",
  onRequestReorder,
  requestedPartIds,
  submittingPartId,
}) {
  // recommendation.urgency is null for NEEDS_PLANNING entries (no
  // usage history -- see domain/inventoryAnalyticsEngine.ts). Ranking
  // them after every real risk level here is a minimal, defensive
  // fallback so this sort never produces NaN -- proper grouping of
  // NEEDS_PLANNING into its own visible section is PR 3's job (see
  // docs/implementation-plans/inventory-zero-history-reorder-behavior.md),
  // not decided here.
  const sorted = [...healthEntries].sort(
    (a, b) =>
      (a.recommendation.urgency ? URGENCY_ORDER[a.recommendation.urgency] : URGENCY_ORDER.LOW + 1) -
      (b.recommendation.urgency ? URGENCY_ORDER[b.recommendation.urgency] : URGENCY_ORDER.LOW + 1)
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
              {onRequestReorder && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ partId, stock, usage, recommendation }) => {
              const hasHistory = hasUsageHistory(usage);
              return (
              <tr key={partId}>
                <td>{getCatalogItem(partId)?.name ?? partId}</td>
                <td>{stock.availableStock}</td>
                <td>{hasHistory ? usage.avgDailyUsage.toFixed(2) : <span className="fo-muted">Insufficient usage history</span>}</td>
                <td>{hasHistory && recommendation.daysRemaining !== Infinity ? recommendation.daysRemaining.toFixed(1) : "—"}</td>
                <td>
                  {hasHistory ? (
                    <span className={`fo-badge fo-badge-${recommendation.urgency.toLowerCase()}`}>
                      {recommendation.urgency}
                    </span>
                  ) : (
                    <span className="fo-badge">Needs planning</span>
                  )}
                </td>
                <td>{hasHistory ? Math.ceil(recommendation.recommendedOrderQty) : <span className="fo-muted">Insufficient usage history</span>}</td>
                {onRequestReorder && (
                  <td>
                    {requestedPartIds?.has(partId) ? (
                      <span className="fo-muted">Requested</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRequestReorder(partId, recommendation)}
                        disabled={submittingPartId === partId}
                      >
                        {submittingPartId === partId ? "Requesting..." : "Request Reorder"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

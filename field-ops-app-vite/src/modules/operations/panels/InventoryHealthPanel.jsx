import { URGENCY_ORDER, hasUsageHistory } from "../../../domain/inventoryAnalyticsEngine";
import { inventoryUrgencyTone } from "../../../domain/inventoryUrgencyTone";
import RequestReorderControl from "../../../shared/inventory/RequestReorderControl";
import StatusPill from "../../../shared/ui/StatusPill.jsx";

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
//
// Zero-history reorder behavior sprint, PR 3 -- the action cell now
// renders shared/inventory/RequestReorderControl.jsx instead of a
// plain button, so a NEEDS_PLANNING recommendation gets the
// eligibility-gated manual-quantity entry (a READY recommendation's
// one-click submit is unchanged). `onRequestReorder(partId,
// recommendation, manualQty)` gains a third argument, undefined on the
// READY path.
export default function InventoryHealthPanel({
  healthEntries,
  // M-OPS-1: count of parts with recorded bin-level stock but zero ledger transaction
  // history -- computeAvailableStockByPart (domain/inventoryAnalyticsEngine.ts) builds its
  // map by iterating transactions only, so such a part never gets a StockSnapshot and never
  // appears in healthEntries at all. Optional/undefined default so callers that don't pass
  // it (or don't have the comparison available) render exactly as before -- no disclosure,
  // not a false "0 omitted" claim.
  omittedBinStockCount,
  title = "Inventory Health",
  // OD-3: governed canonical partId -> display name resolver supplied by the parent (each of
  // the four parents owns one canonical read and passes a fail-closed resolver). Defaults to
  // the raw partId so this shared component NEVER falls back to a static-catalog name and
  // never crashes if a caller omits it -- fail-closed by construction.
  resolveName = (partId) => partId,
  onRequestReorder,
  requestedPartIds,
  submittingPartId,
  // Inventory Health / Parts Catalog separation (PR B, docs/specifications/
  // inventory-operational-queue.md) -- optional, defaults to the original
  // string so Operations.jsx's own call site (no filter tabs, no
  // queueFilter concept) renders byte-identically to before. PartsList.jsx's
  // two remaining Inventory Health tabs (Critical & High, Needs Planning)
  // each pass their own filter-specific message, since "No ledger activity
  // yet" was misleading when it actually meant "nothing matches this tab."
  emptyText = "No ledger activity yet -- nothing to forecast.",
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
      {omittedBinStockCount > 0 && (
        <p className="fo-muted" role="status">
          {omittedBinStockCount} part{omittedBinStockCount === 1 ? "" : "s"} with recorded bin stock but no
          ledger transaction history {omittedBinStockCount === 1 ? "is" : "are"} not shown below -- this view
          only covers parts with at least one ledger movement.
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="fo-muted">{emptyText}</p>
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
                <td>{resolveName(partId)}</td>
                <td>{stock.availableStock}</td>
                <td>{hasHistory ? usage.avgDailyUsage.toFixed(2) : <span className="fo-muted">Insufficient usage history</span>}</td>
                <td>{hasHistory && recommendation.daysRemaining !== Infinity ? recommendation.daysRemaining.toFixed(1) : "—"}</td>
                <td>
                  {hasHistory ? (
                    <StatusPill tone={inventoryUrgencyTone(recommendation.urgency)} label={recommendation.urgency} />
                  ) : (
                    <StatusPill tone="unknown" label="Needs planning" />
                  )}
                </td>
                <td>{hasHistory ? Math.ceil(recommendation.recommendedOrderQty) : <span className="fo-muted">Insufficient usage history</span>}</td>
                {onRequestReorder && (
                  <td>
                    <RequestReorderControl
                      recommendation={recommendation}
                      onSubmit={(manualQty) => onRequestReorder(partId, recommendation, manualQty)}
                      submitting={submittingPartId === partId}
                      alreadyRequested={requestedPartIds?.has(partId)}
                    />
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

import { URGENCY_ORDER, hasUsageHistory } from "../../../domain/inventoryAnalyticsEngine";
import { inventoryUrgencyTone } from "../../../domain/inventoryUrgencyTone";
import RequestReorderControl from "../../../shared/inventory/RequestReorderControl";
import StatusPill from "../../../shared/ui/StatusPill.jsx";
import { LEDGER_UNAVAILABLE_TEXT } from "../../../domain/ledgerRowIntegrity.js";
import { useMemo } from "react";
import { statusLabel } from "../../../shared/display/displayLabels.js";
import SortableHeader from "../../../shared/ui/sorting/SortableHeader.jsx";
import { useTableSort } from "../../../shared/ui/sorting/useTableSort.js";

// Sortable values of one health row (item C). A part without usage history has no rate, no days
// remaining and no recommended qty -- those sort as empty (last), never as zero.
const riskRank = (urgency) => (urgency ? URGENCY_ORDER[urgency] : URGENCY_ORDER.LOW + 1);

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
  title = "Inventory Health",
  // OD-3: governed canonical partId -> display name resolver supplied by the parent (each of
  // the four parents owns one canonical read and passes a fail-closed resolver). Defaults to
  // the raw partId so this shared component NEVER falls back to a static-catalog name and
  // never crashes if a caller omits it -- fail-closed by construction.
  resolveName = (partId) => partId,
  onRequestReorder,
  requestedPartIds,
  submittingPartId,
  // WORKSTREAM 2B -- the governed Warehouse the caller's selector is currently on. This panel
  // does not choose it, does not remember it and does not default it; it forwards it to each
  // row's control and the control hands it straight back on submit, so one page-level choice
  // reaches the write unchanged. Absent means every row's button is off, which is the correct
  // state for a queue whose warehouse has not been stated.
  reorderWarehouseId = null,
  // Inventory Health / Parts Catalog separation (PR B, docs/specifications/
  // inventory-operational-queue.md) -- optional, defaults to the original
  // string so Operations.jsx's own call site (no filter tabs, no
  // queueFilter concept) renders byte-identically to before. PartsList.jsx's
  // two remaining Inventory Health tabs (Critical & High, Needs Planning)
  // each pass their own filter-specific message, since "No ledger activity
  // yet" was misleading when it actually meant "nothing matches this tab."
  emptyText = "No ledger activity yet -- nothing to forecast.",
  // DQ-027: parts whose figures cannot be derived because a ledger record for them cannot be read.
  // They are LISTED, as unavailable rows -- never dropped from the table and never shown as zero.
  unavailablePartIds = [],
  // DQ-027: an unreadable ledger record that names NO part -- no figure in this panel can be trusted.
  ledgerUnavailable = false,
}) {
  // recommendation.urgency is null for NEEDS_PLANNING entries (no
  // usage history -- see domain/inventoryAnalyticsEngine.ts). Ranking
  // them after every real risk level here is a minimal, defensive
  // fallback so this sort never produces NaN -- proper grouping of
  // NEEDS_PLANNING into its own visible section is PR 3's job (see
  // docs/implementation-plans/inventory-zero-history-reorder-behavior.md),
  // not decided here.
  const riskOrdered = useMemo(() => [...healthEntries].sort(
    (a, b) => riskRank(a.recommendation.urgency) - riskRank(b.recommendation.urgency)
  ), [healthEntries]);
  // Header sorting over the rows already loaded; riskiest-first stays the default order. Unavailable
  // (unreadable-ledger) rows are not sortable data and always stay listed after the sorted rows.
  const sortColumns = useMemo(() => ({
    part: { value: (e) => resolveName(e.partId) },
    available: { value: (e) => e.stock?.availableStock },
    avgDailyUsage: { value: (e) => (hasUsageHistory(e.usage) ? e.usage.avgDailyUsage : null) },
    daysRemaining: { value: (e) => (hasUsageHistory(e.usage) && e.recommendation.daysRemaining !== Infinity ? e.recommendation.daysRemaining : null) },
    risk: { value: (e) => (hasUsageHistory(e.usage) ? riskRank(e.recommendation.urgency) : URGENCY_ORDER.LOW + 1) },
    recommendedQty: { value: (e) => (hasUsageHistory(e.usage) ? Math.ceil(e.recommendation.recommendedOrderQty) : null) },
  }), [resolveName]);
  const { sort, toggle, sorted } = useTableSort({ rows: riskOrdered, columns: sortColumns });

  return (
    <div className="fo-card">
      <h3>{title}</h3>
      {ledgerUnavailable ? (
        <p className="fo-warning" role="status">
          Inventory health is unavailable: a ledger record cannot be read or attributed to a part.
        </p>
      ) : null}
      {!ledgerUnavailable && unavailablePartIds.length > 0 && (
        <p className="fo-warning" role="status">
          Incomplete: {unavailablePartIds.length} part{unavailablePartIds.length === 1 ? "" : "s"} cannot be forecast because a
          ledger record for {unavailablePartIds.length === 1 ? "it" : "them"} cannot be read. The other figures are unaffected.
        </p>
      )}
      {ledgerUnavailable ? null : sorted.length === 0 && unavailablePartIds.length === 0 ? (
        <p className="fo-muted">{emptyText}</p>
      ) : (
        // Above the phone breakpoint this still needs a scroll container: it was the one table in
        // the app with none at all, so at tablet widths it was clipped rather than scrollable.
        <div className="fo-table-scroll">
        <table className="fo-table fo-table--stack">
          <thead>
            <tr>
              <SortableHeader columnKey="part" label="Part" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="available" label="Available" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="avgDailyUsage" label="Avg Daily Usage" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="daysRemaining" label="Days Remaining" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="risk" label="Risk" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="recommendedQty" label="Recommended Reorder Qty" sort={sort} onSort={toggle} />
              {onRequestReorder && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ partId, stock, usage, recommendation }) => {
              const hasHistory = hasUsageHistory(usage);
              return (
              <tr key={partId}>
                <td data-label="Part">{resolveName(partId)}</td>
                <td data-label="Available">{stock.availableStock}</td>
                <td data-label="Avg Daily Usage">{hasHistory ? usage.avgDailyUsage.toFixed(2) : <span className="fo-muted">Insufficient usage history</span>}</td>
                <td data-label="Days Remaining">{hasHistory && recommendation.daysRemaining !== Infinity ? recommendation.daysRemaining.toFixed(1) : "—"}</td>
                <td data-label="Risk">
                  {hasHistory ? (
                    <StatusPill tone={inventoryUrgencyTone(recommendation.urgency)} label={statusLabel(recommendation.urgency)} />
                  ) : (
                    <StatusPill tone="unknown" label="Needs Planning" />
                  )}
                </td>
                <td data-label="Recommended Qty">{hasHistory ? Math.ceil(recommendation.recommendedOrderQty) : <span className="fo-muted">Insufficient usage history</span>}</td>
                {onRequestReorder && (
                  <td>
                    <RequestReorderControl
                      recommendation={recommendation}
                      onSubmit={(manualQty, warehouseId) =>
                        onRequestReorder(partId, recommendation, manualQty, warehouseId)
                      }
                      submitting={submittingPartId === partId}
                      alreadyRequested={requestedPartIds?.has(partId)}
                      warehouseId={reorderWarehouseId}
                    />
                  </td>
                )}
              </tr>
              );
            })}
            {unavailablePartIds.map((partId) => (
              <tr key={`unavailable-${partId}`} data-integrity="unavailable">
                <td data-label="Part">{resolveName(partId)}</td>
                <td data-label="Available" colSpan={onRequestReorder ? 6 : 5}>
                  <span className="fo-muted">{LEDGER_UNAVAILABLE_TEXT}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

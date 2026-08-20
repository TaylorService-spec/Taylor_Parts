import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { warehouseEntity, warehouseIndexList } from "../../metadata/definitions/warehouse.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";

// Inventory > Warehouses -- S-INV-WAREHOUSES. Migrated onto the metadata list runtime
// (useMetadataList + MetadataListGrid over warehouseIndexList/warehouseEntity,
// src/metadata/definitions/warehouse.js), replacing the hand-written table that used to
// read via useWarehouses/operationsQueries.fetchWarehousesPage and shape rows through
// domain/warehousesView.js's buildWarehousesView.
//
// ONE READ, NOT TWO. useMetadataList is now the surface's only live read. The old
// useWarehouses hook is left in place (out of this lane's writeScope — src/hooks/**) but
// is no longer imported here; nothing in this module double-reads the collection.
//
// A DEFECT THIS MIGRATION REMOVES WITHOUT TOUCHING THE FILE THAT HAD IT.
// domain/warehousesView.js's buildWarehousesView fell back to the document id
// (`typeof w.name === "string" && w.name ? w.name : w.id`) whenever a warehouse document
// had no `name` — a DECISIONS #106 violation (a document id reaching the screen as
// content). This surface no longer calls that function at all: cellValue()
// (listPresentation.js) has no such fallback for a STRING column — an absent `name`
// renders blank, never the id. warehousesView.js itself is untouched (out of writeScope);
// the fallback still exists there for any future caller, and is reported as a gap below.
//
// WHAT COULD NOT BE PRESERVED, AND WHY — reported rather than silently dropped, the same
// restraint X-ACCOUNT-TAG-CATALOG already applies to the Customers tag facet:
//
// The hand-written surface showed a "total / active / inactive" summary and an
// "N ungoverned" warning computed by reading the FULL bounded page (cap 200,
// fetchWarehousesPage) every time, regardless of which filter tab was selected — those
// numbers were an unlabelled claim about "all warehouses" even though the read itself was
// already capped at 200 with truncation silently undisclosed (a second, pre-existing gap
// this migration also closes: see "TRUNCATION" below). Warehouse counts have no governed
// server-side aggregate (the same shape gap recorded for S-DASH-OPERATIONS /
// X-INVENTORY-ANALYTICS-AGGREGATE), so an EXACT "whole book" total is not obtainable
// honestly from this surface alone. This migration keeps the summary and the ungoverned
// warning, but computes them ONLY over the rows the list runtime has actually loaded so
// far (accumulated across "Load more"), and visibly qualifies the wording with "loaded so
// far" whenever more rows remain (`hasMore`) rather than asserting a hard total that may
// be wrong. In the realistic case (a company's warehouse count is well under the list's
// pageSize of 50), this renders identically to the old copy.
//
// TRUNCATION. The old read silently capped at 200 with its own `truncated` flag never
// read by the surface — a real, live "Truncation must be disclosed" gap. The metadata
// list runtime does not have this problem for an INDEX surface: it never hard-truncates,
// it pages via cursor and `hasMore`, and MetadataListGrid renders an honest "Load more"
// affordance whenever more rows exist. This migration removes the old truncation defect
// rather than reproducing it.
//
// FILTERING STAYS CLIENT-SIDE, DELIBERATELY. warehouseIndexList declares a server-side
// `status` filter, but routing the three filter tabs (All/Active/Inactive) through it
// would mean a fresh live read on every tab click AND would break the "ungoverned"
// bucket and the cross-tab counts (a server EQUALS/IN filter can only select rows that
// carry the exact enum value; it cannot express "no status at all", so a server-filtered
// Active/Inactive tab could never repopulate an All-tab ungoverned count without a second
// read). Filtering the SAME already-loaded rows in memory — exactly what the hand-written
// surface already did — preserves instant tab switching, preserves the "ungoverned"
// bucket, and does not add a second read.
//
// STYLING. The old fo-wh-status colour pill is not reproduced: MetadataListGrid renders
// `cell.value` as plain text for every column (column.renderer is resolved by
// listPresentation.js's resolveColumns() but never consumed by MetadataListGrid.jsx —
// an X-UNCONSUMED-DECLARATION-PATTERN instance, reported below, outside this module's
// writeScope). The status TEXT itself ("Active"/"Inactive") is unchanged and carries the
// same information the pill did; only the colour-coding is lost, which is decorative, not
// functional or accessibility-bearing (the pill always carried its own text label; no
// information was colour-only).
//
// NO DOCUMENT ID AS CONTENT. warehouseIndexList declares no `warehouseId`/id column, and
// the row key used for `MetadataListGrid`'s internal keying is never rendered into a
// cell. There is no row navigation (warehouseIndexList declares no rowNavigationTo, and
// there is no per-warehouse route to navigate to), matching the hand-written surface,
// which never made a row clickable either.
export default function Warehouses({ accessVersion }) {
  const { presentation, loadMore, retry } = useMetadataList(warehouseIndexList, warehouseEntity, {});
  const [filterKey, setFilterKey] = useState("all");

  // accessVersion is threaded so the read re-runs on any access change (the inventory
  // convention every other migrated inventory surface follows) — but `retry` is a fresh
  // function identity on every render (useMetadataList does not memoize it), so it is read
  // through a ref rather than placed in the effect's own dependency array, which would
  // otherwise refire on every render.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const firstAccessVersionRef = useRef(accessVersion);
  useEffect(() => {
    if (accessVersion === firstAccessVersionRef.current) return;
    firstAccessVersionRef.current = accessVersion;
    retryRef.current();
  }, [accessVersion]);

  const statusOf = (row) => row.cells.find((c) => c.fieldId === "status")?.value ?? null;

  // Computed once over whatever the runtime has loaded so far (never a second read) —
  // used for the summary line, the ungoverned warning, and the per-tab counts.
  const summary = useMemo(() => {
    if (presentation.state !== "READY") return null;
    let active = 0;
    let inactive = 0;
    let ungoverned = 0;
    for (const row of presentation.rows) {
      const status = statusOf(row);
      if (status === "Active") active += 1;
      else if (status === "Inactive") inactive += 1;
      else ungoverned += 1;
    }
    return { total: presentation.rows.length, active, inactive, ungoverned };
  }, [presentation]);

  // The grid presentation: the SAME model useMetadataList produced, with the active tab's
  // filter applied to its already-loaded rows. Non-READY states (LOADING/DENIED/
  // UNAVAILABLE/EMPTY) pass through untouched -- filtering a failure or an empty result
  // makes no sense and would only relabel one honest state as another.
  const gridPresentation = useMemo(() => {
    if (presentation.state !== "READY" || filterKey === "all") return presentation;
    const wanted = filterKey === "active" ? "Active" : "Inactive";
    const rows = presentation.rows.filter((row) => statusOf(row) === wanted);
    if (rows.length === presentation.rows.length) return presentation;
    if (rows.length === 0) {
      return { ...presentation, state: "FILTERED", rows: [], emptyMessage: "No warehouses match this filter." };
    }
    return { ...presentation, rows };
  }, [presentation, filterKey]);

  const filterOptions = [
    { key: "all", label: "All", count: summary?.total },
    { key: "active", label: "Active", count: summary?.active },
    { key: "inactive", label: "Inactive", count: summary?.inactive },
  ];

  const intro = (
    <p className="fo-muted">
      The company's warehouses and their governed status. <strong>Active</strong> warehouses are eligible to receive
      inventory — the receiving service makes the final check.
    </p>
  );

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Warehouses" />
      {intro}

      {summary && summary.total > 0 && (
        <p className="fo-muted" role="status">
          {summary.total} warehouse{summary.total === 1 ? "" : "s"}
          {presentation.hasMore ? " loaded so far" : ""} · {summary.active} active
          {summary.inactive > 0 ? ` · ${summary.inactive} inactive` : ""}.
        </p>
      )}
      {summary && filterKey === "all" && summary.ungoverned > 0 && (
        <p className="fo-warning" role="alert">
          {summary.ungoverned} warehouse{summary.ungoverned === 1 ? "" : "s"}{" "}
          {summary.ungoverned === 1 ? "has" : "have"} no governed status
          {presentation.hasMore ? " among those loaded so far" : ""} — the receiving service will not accept{" "}
          {summary.ungoverned === 1 ? "it" : "them"} until governed. Report this if it persists.
        </p>
      )}

      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      <MetadataListGrid presentation={gridPresentation} caption="Warehouses" onLoadMore={loadMore} onRetry={retry} />

      <p className="fo-muted fo-wh-footnote">
        For bin-level stock and reconciliation, see the <Link to="/dashboard/operations">Operations overview</Link>.
      </p>
    </div>
  );
}

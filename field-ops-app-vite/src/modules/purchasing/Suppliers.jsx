import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supplierEntity, supplierIndexList } from "../../metadata/definitions/supplier.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";

// Purchasing > Suppliers -- S-INV-SUPPLIERS. Migrated onto the metadata list runtime
// (useMetadataList + MetadataListGrid over supplierIndexList/supplierEntity,
// src/metadata/definitions/supplier.js), replacing the hand-written table that used to
// read via useSuppliers/operationsQueries.fetchSuppliersPage and shape rows through
// domain/suppliersView.js's buildSuppliersView.
//
// SAME PATTERN AS WAREHOUSES, NOT MANUFACTURERS. supplierEntity declares
// `readVia: "CLIENT_DIRECT"` (a plain Rules-gated Firestore collection, same as
// warehouse — unlike manufacturer's unbounded, unregistered CALLABLE read), so
// useMetadataList's own dispatch (selectListSource in useMetadataList.js) routes it
// straight through fetchFirestorePage with no special-casing needed. There is also a
// real composite index already declared for exactly this query
// (firestore.indexes.json: collectionGroup "suppliers", status ASC + name ASC), so the
// list's declared `status` filter is servable, not merely aspirational.
//
// ONE READ, NOT TWO. useMetadataList is now the surface's only live read. The old
// useSuppliers hook is left in place (out of this lane's writeScope -- src/hooks/**) but
// is no longer imported here; nothing in this module double-reads the collection.
//
// A DEFECT THIS MIGRATION REMOVES WITHOUT TOUCHING THE FILE THAT HAD IT.
// domain/suppliersView.js's buildSuppliersView falls back to the document id
// (`name: str(s.name) ?? s.id`) whenever a supplier document has no `name` -- a
// DECISIONS #106 violation (a document id reaching the screen as content), the exact
// class of defect the last two migrations (Warehouses, Manufacturers) each found and
// removed in their own hand-written surfaces. This surface no longer calls
// buildSuppliersView at all: cellValue() (listPresentation.js) has no such fallback for
// a STRING column -- an absent `name` renders blank, never the id. suppliersView.js
// itself is untouched (out of writeScope -- src/domain/**); the fallback still exists
// there for any future caller (supplierPicker.js, etc.), and is reported as a gap below.
//
// NO DOCUMENT ID AS CONTENT. supplierIndexList declares no `supplierId` column (the
// entity DOES declare a `supplierId` field of type ID, but the list view does not
// include it among its columns), and the row key MetadataListGrid uses internally is
// never rendered into a cell. There is no row navigation (supplierIndexList declares no
// rowNavigationTo, and there is no per-supplier detail route to navigate to), matching
// the hand-written surface, which never made a row clickable either.
//
// STATUS FILTERING STAYS CLIENT-SIDE, DELIBERATELY -- same reasoning as Warehouses.
// supplierIndexList declares a server-side `status` EQUALS/IN filter, but routing the
// four filter tabs (All/Active/Inactive/Ungoverned) through it would mean a fresh live
// read on every tab click AND would break the "ungoverned" bucket and the cross-tab
// counts: a server EQUALS/IN filter can only select rows carrying an exact enum value,
// it cannot express "no status field at all", so a server-filtered Active/Inactive tab
// could never repopulate an All-tab ungoverned count without a second read. Filtering
// the SAME already-loaded rows in memory -- exactly what the hand-written surface
// already did via domain/suppliersView.js's filterSuppliers -- preserves instant tab
// switching, preserves the "ungoverned" bucket, and does not add a second read.
//
// TRUNCATION. The old read (useSuppliers -> fetchSuppliersPage) was already bounded and
// DID surface its own `truncated` flag -- but the hand-written Suppliers.jsx never read
// `read.truncated` anywhere, so it was computed and silently dropped, the same live gap
// Warehouses' migration found and closed. The metadata list runtime does not have this
// problem for an INDEX surface: it never hard-truncates, it pages via cursor and
// `hasMore`, and MetadataListGrid renders an honest "Load more" affordance whenever more
// rows exist.
//
// WHAT COULD NOT BE MATCHED EXACTLY, AND WHY -- reported rather than silently dropped.
// The hand-written surface showed a single merged "Contact" column (email, else phone,
// else contactName -- domain/suppliersView.js's contactLine, in that preference order).
// supplierIndexList declares `phone` and `email` as separate columns but does NOT
// declare `contactName` as a column at all (it IS a declared FIELD on supplierEntity,
// just not included in supplierIndexList.columns) -- and supplier.js is out of this
// lane's writeScope (explicitly listed as not-to-be-edited), so a `contactName` column
// cannot be added here. For the two more common cases (a supplier with email and/or
// phone on file) this migration shows STRICTLY MORE information than before (both raw
// fields, not one merged pick); for the narrow case of a supplier with ONLY
// `contactName` set and neither `email` nor `phone`, the old merged column would have
// shown the contact name and this list shows blank in both the Phone and Email columns.
// Reported as REGISTRATION_PENDING against supplier.js below rather than worked around
// downstream.
export default function Suppliers({ accessVersion }) {
  const { presentation, loadMore, retry } = useMetadataList(supplierIndexList, supplierEntity, {});
  const [filterKey, setFilterKey] = useState("all");

  // accessVersion is threaded so the read re-runs on any access change (the inventory/
  // purchasing convention every other migrated surface follows) -- but `retry` is a
  // fresh function identity on every render (useMetadataList does not memoize it), so it
  // is read through a ref rather than placed in the effect's own dependency array, which
  // would otherwise refire on every render.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const firstAccessVersionRef = useRef(accessVersion);
  useEffect(() => {
    if (accessVersion === firstAccessVersionRef.current) return;
    firstAccessVersionRef.current = accessVersion;
    retryRef.current();
  }, [accessVersion]);

  const statusOf = (row) => row.cells.find((c) => c.fieldId === "status")?.value ?? null;

  // Computed once over whatever the runtime has loaded so far (never a second read) --
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

  // The grid presentation: the SAME model useMetadataList produced, with the active
  // tab's filter applied to its already-loaded rows. Non-READY states (LOADING/DENIED/
  // UNAVAILABLE/EMPTY) pass through untouched -- filtering a failure or an empty result
  // makes no sense and would only relabel one honest state as another.
  const gridPresentation = useMemo(() => {
    if (presentation.state !== "READY" || filterKey === "all") return presentation;
    const rows = presentation.rows.filter((row) => {
      const status = statusOf(row);
      if (filterKey === "active") return status === "Active";
      if (filterKey === "inactive") return status === "Inactive";
      // "ungoverned" -- neither governed state.
      return status !== "Active" && status !== "Inactive";
    });
    if (rows.length === presentation.rows.length) return presentation;
    if (rows.length === 0) {
      return { ...presentation, state: "FILTERED", rows: [], emptyMessage: "No suppliers match this filter." };
    }
    return { ...presentation, rows };
  }, [presentation, filterKey]);

  const filterOptions = [
    { key: "all", label: "All", count: summary?.total },
    { key: "active", label: "Active", count: summary?.active },
    { key: "inactive", label: "Inactive", count: summary?.inactive },
    { key: "ungoverned", label: "Ungoverned", count: summary?.ungoverned },
  ];

  const intro = (
    <p className="fo-muted">
      The company's governed suppliers and their status. <strong>Active</strong> suppliers are selectable for
      purchasing; <strong>inactive</strong> ones are retained for history but not selectable.
    </p>
  );

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Suppliers" />
      {intro}

      {summary && summary.total > 0 && (
        <p className="fo-muted" role="status">
          {summary.total} supplier{summary.total === 1 ? "" : "s"}
          {presentation.hasMore ? " loaded so far" : ""} · {summary.active} active
          {summary.inactive > 0 ? ` · ${summary.inactive} inactive` : ""}.
        </p>
      )}
      {summary && filterKey === "all" && summary.ungoverned > 0 && (
        <p className="fo-warning" role="alert">
          {summary.ungoverned} supplier{summary.ungoverned === 1 ? "" : "s"}{" "}
          {summary.ungoverned === 1 ? "has" : "have"} no governed status
          {presentation.hasMore ? " among those loaded so far" : ""} (legacy record
          {summary.ungoverned === 1 ? "" : "s"} predating Supplier Master) — not selectable for governed purchasing
          until governed. Use the "Ungoverned" filter to review.
        </p>
      )}

      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      <MetadataListGrid presentation={gridPresentation} caption="Suppliers" onLoadMore={loadMore} onRetry={retry} />

      <p className="fo-muted fo-sup-footnote">
        Purchase orders placed with these suppliers appear under <Link to="/dashboard/purchasing">Purchase Orders</Link>.
      </p>
    </div>
  );
}

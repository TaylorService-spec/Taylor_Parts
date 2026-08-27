import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supplierEntity, supplierIndexList } from "../../metadata/definitions/supplier.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
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

  // THE READ IS COMPLETE, OR IT IS NOT — and every count on this page turns on that one fact.
  //
  // These four numbers are tallied from the LOADED rows. While there are more pages outstanding
  // that is a claim about a screenful presented as a claim about the business, which is precisely
  // the reason the Work Order status chips gave up their counts (Lists P2 §3, board 2k: per-bucket
  // counts on a bounded list need a governed aggregate, and suppliers has none).
  //
  // But `hasMore === false` is not a guess. It means the cursor is exhausted: the loaded rows ARE
  // every row the query returns, so a tally over them is exact. So the counts are not deleted, they
  // are CONDITIONAL — present and true on a complete read, absent rather than approximate on a
  // partial one. That is a better answer than the blanket removal Work Orders needed, and it is
  // available here only because this collection is small enough to finish.
  //
  // No aggregate query was added to rescue the partial case. That would be creating a read to make
  // the family look complete.
  const complete = presentation.state === "READY" && !presentation.hasMore;
  const bucketCount = (n) => (complete ? n : undefined);

  const filterOptions = [
    { key: "all", label: "All", count: bucketCount(summary?.total) },
    { key: "active", label: "Active", count: bucketCount(summary?.active) },
    { key: "inactive", label: "Inactive", count: bucketCount(summary?.inactive) },
    { key: "ungoverned", label: "Ungoverned", count: bucketCount(summary?.ungoverned) },
  ];

  const intro = (
    <p className="fo-muted">
      The company's governed suppliers and their status. <strong>Active</strong> suppliers are selectable for
      purchasing; <strong>inactive</strong> ones are retained for history but not selectable.
    </p>
  );

  return (
    <WorkspaceIdentity
      crumb="Purchasing → Suppliers"
      title="Suppliers"
      // The header count is the SAME conditional truth the tabs use: exact when the cursor is
      // exhausted, absent while pages are outstanding. The primitive renders nothing for a null.
      count={complete ? summary?.total ?? null : null}
      countLabel={summary?.total === 1 ? "supplier" : "suppliers"}
      // The one fact worth acting on, when it is knowable. Ungoverned suppliers are legacy records
      // that cannot be selected for governed purchasing, so their number is the reason somebody
      // opens this page rather than a decoration — and it is omitted entirely, never zeroed, when
      // the read cannot support it.
      summaryItems={
        complete && summary?.ungoverned > 0
          ? [{ key: "ungoverned", label: `${summary.ungoverned} without governed status`, tone: "attention" }]
          : []
      }
      // NO CREATE ACTION, and it is P2's third treatment rather than an omission: `suppliers` is
      // Admin-SDK-write-only, so there is no client write path to offer. A disabled button would
      // describe a permission boundary; the truth is that this object is not created from the app.
    >
      {intro}

      {/* THE SUMMARY LINE, WITHOUT ITS "loaded so far" HEDGE — because it now only renders when
          there is nothing left to load. The hedge was honest and it was also the tell: a sentence
          that has to explain that its own numbers might be partial is a sentence carrying numbers
          it should not have. On a partial read the line is absent, and the grid's Load more says
          what is true instead. */}
      {complete && summary && summary.total > 0 && (
        <p className="fo-muted" role="status">
          {summary.active} active
          {summary.inactive > 0 ? ` · ${summary.inactive} inactive` : ""}.
        </p>
      )}
      {complete && filterKey === "all" && summary.ungoverned > 0 && (
        <p className="fo-warning" role="alert">
          {summary.ungoverned} supplier{summary.ungoverned === 1 ? "" : "s"}{" "}
          {summary.ungoverned === 1 ? "has" : "have"} no governed status (legacy record
          {summary.ungoverned === 1 ? "" : "s"} predating Supplier Master) — not selectable for governed purchasing
          until governed. Use the "Ungoverned" filter to review.
        </p>
      )}

      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      <MetadataListGrid presentation={gridPresentation} caption="Suppliers" onLoadMore={loadMore} onRetry={retry} />

      <p className="fo-muted fo-sup-footnote">
        Purchase orders placed with these suppliers appear under <Link to="/purchasing">Purchase Orders</Link>.
      </p>
    </WorkspaceIdentity>
  );
}

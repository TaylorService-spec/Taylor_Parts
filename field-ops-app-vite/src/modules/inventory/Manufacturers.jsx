// Manufacturer administration workspace (catalog reference object). Closes the referential gap Part
// write created (parts.manufacturerId -> a manageable/readable Manufacturer).
//
// READ via services/manufacturerQueries.fetchManufacturerList -> the trusted `getManufacturerCatalog`
// callable (capability `inventory.catalog.read`). Part 11 reconciliation (2026-08-15): this surface
// used to read the `manufacturers` collection DIRECTLY over the client SDK -- always permission-denied,
// since that collection is Rules-closed (`allow read, write: if false`) for every principal. Revalidated
// rather than repeating that stale blocker: the governed read that already serves the Parts picker
// surfaces now also carries the `version` field this workspace's write actions need for optimistic
// concurrency, so it is reused here as-is -- no new capability, no Rules change, no parallel read path.
//
// READ-ONLY (Firebase exit PR-B, 2026-10-15). The create / rename / status affordances, their write hook
// (useManufacturerWrite), the createManufacturer / updateManufacturer / changeManufacturerStatus callable
// client and the MANUFACTURER_WRITE_READY flag were removed: the flag was false in every environment, so no
// write was ever attempted from here. Manufacturer administration returns on EOS Core (the PostgreSQL writer,
// functions/src/catalogMaster/postgresManufacturerWriter.ts, once it is routed), never on these callables.
// See docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md.
//
// S-INV-MANUFACTURERS -- the list itself now renders through the metadata list runtime
// (manufacturerIndexList/manufacturerEntity, definitions/manufacturer.js), the same
// column/state/cell contract every other migrated INDEX surface uses
// (AccountsList.jsx/MetadataListGrid.jsx), rather than a hand-rolled <table>.
//
// NOT THROUGH useMetadataList/buildQueryDescriptor. getManufacturerCatalog is a single
// UNBOUNDED read of the whole catalog with no `limit`/`cursor` parameters and an envelope
// shape ({status, manufacturers, excludedCount}) callableListSource.js's CALLABLE_SOURCES
// registry does not (and, being outside this lane's writeScope -- src/metadata/** -- could
// not) declare. Routing this surface's fetch through useMetadataList would either silently
// ignore the descriptor's bound/cursor (dishonest) or throw at every load ("no known
// response mapping for readCallable"). So the EXISTING fetchManufacturerList() read is kept
// exactly as-is (ONE read, unchanged), and its result is reshaped in memory into the same
// `{rows, hasMore}` page shape buildListPresentation expects -- the identical "inject a
// listRenderer over data already flowing instead of issuing a second read" pattern
// definitions/accountPageComponents.js's buildAccountRelatedListPresentation established
// for Contacts/Locations. See buildManufacturersPresentation below, and the handoff notes
// for the exact registration gap this leaves in callableListSource.js (out of writeScope,
// reported rather than worked around).
//
// DECISIONS #106 FIX (X-MANUFACTURER-ID-AS-COLUMN class defect, live in this file until
// now): the table used to render `m.manufacturerId` (the Firestore document id) as its own
// visible "ID" column, and both the Rename and Change Status dialog headers echoed it back
// as `${panel.m.manufacturerId}`. manufacturerEntity declares `identity.nameField: "name"`
// and `referenceField: null` -- there is no business reference, and a missing one is not
// permission to show a record id instead (manufacturer.js's own header makes the same call
// for manufacturerIndexList's columns). All three instances are fixed here: the ID column is
// dropped entirely (manufacturerIndexList declares none), and both dialog headers now read
// the manufacturer's `name`. manufacturerId is still used -- as the row's routing/keying
// value -- but never as displayed content.
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";
import { manufacturerEntity, manufacturerIndexList } from "../../metadata/definitions/manufacturer.js";
import { buildListPresentation } from "../../metadata/listPresentation.js";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { sortRows } from "../../shared/ui/sorting/useTableSort.js";
import { statusLabel } from "../../shared/display/displayLabels.js";

// The status column's sort value. The cell itself renders through cellValue's ENUM branch, using
// manufacturerEntity's declared enumLabels, same as every other migrated list's status column.
const STATUS_WORDS = manufacturerEntity.fields.find((f) => f.id === "status")?.enumLabels ?? {};

// UI corrections item C: header sorting. getManufacturerCatalog returns the WHOLE catalog, so ordering the rows in
// memory orders the complete result (no page boundary to misrepresent). Values are what the person reads.
const MANUFACTURER_SORT_COLUMNS = Object.freeze({
  name: { value: (row) => row.name ?? null },
  status: { value: (row) => (row.status ? statusLabel(row.status, STATUS_WORDS) : null) },
});

// Preserves this workspace's own, more specific copy over buildListPresentation's generic
// per-state defaults (emptyMessageFor, listPresentation.js) -- overriding is the same
// explicitly-supported "own copy" choice buildAccountRelatedListPresentation exercises.
const EMPTY_MESSAGE = "No manufacturers are recorded yet.";
const DENIED_MESSAGE = "You do not have access to Manufacturers. Contact an administrator if you believe this is an error.";
const UNAVAILABLE_MESSAGE = "Manufacturers are currently unavailable. Try again later.";

/**
 * Reshape this workspace's own load state into a metadata list presentation, without a
 * second read. `state.manufacturers` (when phase === "ready") is the SAME
 * fetchManufacturerList() result the workspace already holds -- reused, not re-fetched.
 */
export function buildManufacturersPresentation(state, sort = null) {
  const loading = state.phase === "loading";
  const errorStatus = state.phase === "denied" ? "denied" : state.phase === "error" ? "unavailable" : null;
  const manufacturers = state.phase === "ready" ? state.manufacturers ?? [] : [];
  // `id` is the routing/keying field ONLY -- it is never among the declared columns
  // (manufacturerIndexList: name, status), so cellValue never has a chance to render it.
  const rows = sortRows(
    manufacturers.map((m) => ({ id: m.manufacturerId, name: m.name, status: m.status })),
    sort,
    MANUFACTURER_SORT_COLUMNS,
  );
  // getManufacturerCatalog returns the WHOLE catalog, unbounded -- there is no truncation
  // to disclose here (unlike a capped RELATED section), so hasMore is always false.
  const presentation = buildListPresentation({
    def: manufacturerIndexList,
    entity: manufacturerEntity,
    page: { rows, hasMore: false },
    loading,
    errorStatus,
    filtersActive: false,
  });
  const emptyMessage =
    presentation.state === "EMPTY" ? EMPTY_MESSAGE :
    presentation.state === "DENIED" ? DENIED_MESSAGE :
    presentation.state === "UNAVAILABLE" ? UNAVAILABLE_MESSAGE :
    presentation.emptyMessage;
  return { ...presentation, emptyMessage };
}

export default function Manufacturers() {
  const [state, setState] = useState({ phase: "loading" });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    fetchManufacturerList().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ phase: r.code === "permission-denied" ? "denied" : "error" });
      else setState({ phase: "ready", manufacturers: r.manufacturers, invalidCount: r.invalidCount });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);

  // Header sort state ({ key, direction } | null = the catalog's default order), in the grid's criteria shape.
  const [headerSort, setHeaderSort] = useState(null);
  const presentation = useMemo(() => buildManufacturersPresentation(state, headerSort), [state, headerSort]);
  const sorting = useMemo(() => ({
    entity: manufacturerEntity,
    criteria: { sort: headerSort ? [{ fieldId: headerSort.key, direction: headerSort.direction === "desc" ? "DESC" : "ASC" }] : [] },
    onSort: (fieldId, direction) => setHeaderSort(fieldId ? { key: fieldId, direction: direction === "DESC" ? "desc" : "asc" } : null),
  }), [headerSort]);

  // THE COUNT IS EXACT HERE, AND ONLY BECAUSE THE READ IS COMPLETE.
  //
  // getManufacturerCatalog returns the WHOLE collection in one call — no `limit`, no cursor, no
  // `truncated` flag. That is a scale problem recorded elsewhere (R7), and on this one question it
  // is a licence: a count over every row IS the collection count, so it is a governed total rather
  // than a page tally dressed up as one. Every other list on this grammar must earn its header
  // count from a server-side aggregate for exactly the reason this one does not need to.
  //
  // Null on any unsettled read. A "0 manufacturers" printed over a denial states that the business
  // has no manufacturers when the truth is that this reader may not see them.
  const total = state.phase === "ready" ? (state.manufacturers?.length ?? null) : null;

  return (
    <WorkspaceIdentity
      crumb="Inventory → Manufacturers"
      title="Manufacturers"
      count={total}
      countLabel={total === 1 ? "manufacturer" : "manufacturers"}
      // The malformed-record count is the one operational fact this page can state truthfully, and
      // it belongs here rather than buried in the paragraph below: it is the reason somebody would
      // act. Omitted entirely when there are none — never "0 excluded", which would read as a
      // reassurance the page has not earned on a denied or failed read.
      summaryItems={
        state.phase === "ready" && state.invalidCount > 0
          ? [{ key: "invalid", label: `${state.invalidCount} malformed record${state.invalidCount === 1 ? "" : "s"} excluded`, tone: "attention" }]
          : []
      }
    >
      <p className="fo-mfr__hint">
        Governed manufacturer reference records that Parts link to. This page is read-only.
        {state.phase === "ready" && state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>

      {/* NO onLoadMore, AND NO FOOTER — Owner ruling, Lists P2 tranche 1.
          getManufacturerCatalog reads the whole collection in one unbounded call. There is no
          cursor, no page boundary and no total-pages, so any control implying one would be a
          boundary invented by the interface. `buildManufacturersPresentation` already pins
          `hasMore: false`, and the grid renders Load more only when hasMore AND onLoadMore are
          both present — so this is guarded in two places rather than by this line alone.
          NO ROW NAVIGATION either: there is no Manufacturer record route, and one is not invented
          to make rows clickable. */}
      <MetadataListGrid presentation={presentation} sorting={sorting} caption="Manufacturers" onRetry={load} />
    </WorkspaceIdentity>
  );
}

// INV-EQ-P1b, migrated under S-INV-EQUIPMENT -- the Customer Equipment tab
// (default). A cross-customer, cursor-paginated list of installed Equipment,
// now RENDERED through the shared metadata list runtime (buildListPresentation +
// MetadataListGrid, over equipmentIndexList/equipmentEntity --
// src/metadata/definitions/equipment.js) instead of a hand-written <ul>. Per the
// final Owner filtering decision this tab carries ONLY customer and location
// filters (catalog-style search/status live on the Available tab). They are
// optional LOADED-only filters, not query prerequisites and not a global search;
// the note below states that plainly. Each row navigates to Equipment Detail.
//
// ONE READ, NOT TWO. This migration does NOT switch to useMetadataList (the hook
// every other migrated list surface uses) -- that hook issues its OWN live read
// via buildQueryDescriptor/fetchFirestorePage, which would be a SECOND live read
// of the `equipment` collection sitting alongside this tab's existing bounded
// cursor-paginated read (useInstalledEquipmentPage). Per this lane's explicit
// "do not double-read" instruction, the pre-existing hook stays the tab's ONLY
// read; what changes is how its rows are RENDERED -- through buildListPresentation
// (src/metadata/listPresentation.js) and MetadataListGrid.jsx, called directly
// with the real equipmentIndexList / equipmentEntity, instead of through
// useMetadataList's own read+render bundle. This is the literal scope this lane
// was given: "rendering the same rows through the shared runtime inside the same
// tab" without redrawing what is read or how.
//
// REFERENCE COLUMNS: RESOLVED FROM DATA ALREADY IN HAND, NO NEW READ.
// equipmentIndexList declares `accountId` and `locationId` as REFERENCE columns.
// cellValue() (listPresentation.js) renders a REFERENCE column via an optional
// `resolveReference(fieldId, id, row)` callback; omitting it renders the honest
// literal "Unresolved reference" for every row, never blank and never the raw id.
// This tab CAN supply one honestly: useInstalledEquipmentPage already resolves
// account/location names via its own bounded batched reads (<=10 ids per query,
// scoped to only the ids present in loaded pages) and returns them as
// `accountNames`/`locationNames` Maps. resolveReference below is a pure lookup
// into those two Maps already in memory -- no additional read, no N+1 per row.
//
// A DEFECT THIS MIGRATION REMOVES WITHOUT TOUCHING THE FILE THAT HAD IT.
// domain/installedEquipmentListView.js's `resolveName` falls back to the raw id
// (`nameMap.get(id) ?? id`) whenever a name has not (yet) resolved -- a DECISIONS
// #106 violation (a document id reaching the screen as content), the same class
// of defect Warehouses' and Suppliers' migrations each found and removed in their
// own hand-written surfaces. This tab no longer calls `composeEquipmentRows` (the
// function that used `resolveName`) at all: resolveReference below returns
// `undefined` for an unresolved id, which cellValue turns into the explicit
// "Unresolved reference" label, never the id. installedEquipmentListView.js
// itself is untouched (out of this lane's writeScope -- src/domain/**); the
// id-fallback still exists there for any other caller, and is reported as a gap
// in this lane's handoff rather than fixed here.
//
// FILTERING STAYS CLIENT-SIDE (LOADED-ONLY), UNCHANGED. equipmentIndexList
// declares `accountId` as a real server EQUALS filter, but this tab does not
// route the Customer/Location selectors through it -- same reasoning as
// Warehouses/Suppliers: no firestore.indexes.json entries exist for `equipment`
// at all yet (a net-new index demand, not a live capability -- see
// REGISTRATION_PENDING in this program's handoff), and a server-filtered read
// would mean a fresh live read on every selection change, on top of already
// requiring account/location NAMES this tab has no server-side facet for. The
// existing LOADED-only filtering (domain/installedEquipmentListView.js's
// `applyLoadedFilters`, unchanged, same function the pre-migration tab called via
// `buildInstalledEquipmentRows`) stays exactly as it was: it narrows and sorts
// whatever has been loaded so far, never issues a read of its own.
//
// NO DOCUMENT ID AS CONTENT. equipmentIndexList's columns (name, status,
// accountId, locationId, manufacturer, model) never include the equipment
// document id; MetadataListGrid keys rows by `row.key` (the id) but never
// renders it into a cell. Row navigation uses the list definition's own
// `rowNavigationTo` ("/equipment/:equipmentId") via `buildRowHref`, matching
// MetadataRecordPage.jsx's identical pattern -- the id routes the row, it is
// never a label.
//
// WHAT COULD NOT BE MATCHED EXACTLY, AND WHY -- reported rather than silently
// dropped:
//   - equipmentIndexList does NOT declare a `serialNumber` column (only name,
//     status, accountId, locationId, manufacturer, model), even though
//     `serialNumber` IS a declared FIELD on equipmentEntity. The pre-migration
//     tab showed "S/N <value>" inline when present. equipment.js is out of this
//     lane's writeScope (explicitly listed as not-to-be-edited), so a
//     `serialNumber` column cannot be added here. Reported as
//     REGISTRATION_PENDING against equipment.js below rather than worked around
//     downstream -- the exact shape of the gap Suppliers' migration reported for
//     `contactName`.
//   - Retry on an UNAVAILABLE (first-page load failure) is not wired.
//     useInstalledEquipmentPage exposes no manual "reload first page" callable
//     (only `loadMore`, and an accessVersion-keyed effect) -- adding one would be
//     a src/hooks/** change, out of this lane's writeScope. The pre-migration tab
//     had no retry affordance either, so this is unchanged, not a new gap.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInstalledEquipmentPage } from "../../hooks/useInstalledEquipmentPage";
import {
  applyLoadedFilters,
  collectAccountIds,
  collectLocationIds,
  LOADED_ONLY_FILTER_NOTE,
} from "../../domain/installedEquipmentListView";
import { normalizeEquipmentStatus } from "../../domain/equipment.js";
import { equipmentEntity, equipmentIndexList } from "../../metadata/definitions/equipment.js";
import { buildListPresentation, buildRowHref } from "../../metadata/listPresentation.js";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";

export default function CustomerEquipment({ accessVersion, usePage = useInstalledEquipmentPage }) {
  const navigate = useNavigate();
  const { docs, accountNames, locationNames, loading, error, denied, partialError, hasMore, loadMore } = usePage(accessVersion);

  const [accountId, setAccountId] = useState("");
  const [locationId, setLocationId] = useState("");
  const filtersApplied = accountId !== "" || locationId !== "";

  // Filter options are built from the LOADED docs only (consistent with the note
  // below) -- unchanged from the pre-migration tab.
  const accountOptions = useMemo(
    () => collectAccountIds(docs).map((id) => ({ id, name: accountNames.get(id) || id })).sort((a, b) => a.name.localeCompare(b.name)),
    [docs, accountNames],
  );
  const locationOptions = useMemo(
    () => collectLocationIds(docs).map((id) => ({ id, name: locationNames.get(id) || id })).sort((a, b) => a.name.localeCompare(b.name)),
    [docs, locationNames],
  );

  // Filter + sort the LOADED docs (unchanged function/semantics), then normalize
  // `status` the same way composeEquipmentRows used to (an unrecognized status
  // renders as absent, never a raw stored value cellValue's ENUM branch cannot
  // label) before handing raw docs to the shared presentation builder.
  const filteredDocs = useMemo(() => {
    const filtered = applyLoadedFilters(docs, { accountId: accountId || null, locationId: locationId || null });
    return filtered.map((d) => ({ ...d, status: normalizeEquipmentStatus(d.status) }));
  }, [docs, accountId, locationId]);

  // Resolve accountId/locationId REFERENCE columns from the Maps the existing
  // read already populated -- no new read, never falls back to the raw id (see
  // the file header).
  const resolveReference = (fieldId, id) => {
    if (fieldId === "accountId") return accountNames.get(id) ?? undefined;
    if (fieldId === "locationId") return locationNames.get(id) ?? undefined;
    return undefined;
  };

  const errorStatus = denied ? "denied" : error ? "unavailable" : null;

  const presentation = useMemo(
    () =>
      buildListPresentation({
        def: equipmentIndexList,
        entity: equipmentEntity,
        page: errorStatus ? null : { rows: filteredDocs, hasMore },
        loading,
        errorStatus,
        filtersActive: filtersApplied,
        resolveReference,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredDocs, hasMore, loading, errorStatus, filtersApplied, accountNames, locationNames],
  );

  const onRowClick = (key) => {
    const href = buildRowHref(equipmentIndexList.rowNavigationTo, key);
    if (href) navigate(href);
  };

  return (
    <div className="fo-panel">
      <h3>Customer Equipment</h3>
      <p className="fo-muted" id="ce-filter-note">{LOADED_ONLY_FILTER_NOTE}</p>

      <div className="fo-filters" role="group" aria-label="Equipment filters" aria-describedby="ce-filter-note">
        <label>
          Customer
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All loaded customers</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All loaded locations</option>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>

      <MetadataListGrid
        presentation={presentation}
        caption="Installed equipment"
        onRowClick={onRowClick}
        onLoadMore={loadMore}
      />

      {/* Non-destructive: the equipment page itself already loaded; only a later
          page's NAME lookup failed. Rows stay visible above (state stays READY),
          this is an additional notice layered on top -- the same "partial" shape
          the pre-migration tab rendered, which buildListPresentation's own state
          machine has no equivalent for (it distinguishes LOADING/DENIED/
          UNAVAILABLE/EMPTY/FILTERED/READY, not a rows-plus-warning state). */}
      {!errorStatus && partialError && filteredDocs.length > 0 && (
        <p className="fo-warning" role="status">
          {typeof partialError === "string" ? partialError : "Couldn’t load more Equipment."} Already-loaded rows are shown.
        </p>
      )}
    </div>
  );
}

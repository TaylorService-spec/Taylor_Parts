// INV-EQ-P1b -- the Customer Equipment tab (default). A cross-customer, cursor-
// paginated list of installed Equipment. Per the final Owner filtering decision this
// tab carries ONLY customer and location filters (catalog-style search/status live on
// the Available tab). They are optional LOADED-only filters, not query prerequisites
// and not a global search; the note below states that plainly. Each row links to
// Equipment Detail. All data logic lives in the injected hook
// (useInstalledEquipmentPage) + the pure view-model (installedEquipmentListView).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInstalledEquipmentPage } from "../../hooks/useInstalledEquipmentPage";
import {
  buildInstalledEquipmentRows,
  deriveListState,
  validEquipmentDocs,
  collectAccountIds,
  collectLocationIds,
  LIST_STATE,
  LOADED_ONLY_FILTER_NOTE,
} from "../../domain/installedEquipmentListView";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

export default function CustomerEquipment({ accessVersion, usePage = useInstalledEquipmentPage }) {
  const { docs, accountNames, locationNames, loading, error, denied, partialError, hasMore, loadMore } = usePage(accessVersion);

  const [accountId, setAccountId] = useState("");
  const [locationId, setLocationId] = useState("");

  const filters = useMemo(
    () => ({ accountId: accountId || null, locationId: locationId || null }),
    [accountId, locationId],
  );

  const { rows } = useMemo(
    () => buildInstalledEquipmentRows(docs, { filters, accountNames, locationNames }),
    [docs, filters, accountNames, locationNames],
  );

  const docsCount = useMemo(() => validEquipmentDocs(docs).length, [docs]);
  const state = deriveListState({ loading, denied, error: !!error, docsCount, filteredCount: rows.length, partialError: !!partialError });

  // Filter options are built from the LOADED docs only (consistent with the note).
  const accountOptions = useMemo(
    () => collectAccountIds(docs).map((id) => ({ id, name: accountNames.get(id) || id })).sort((a, b) => a.name.localeCompare(b.name)),
    [docs, accountNames],
  );
  const locationOptions = useMemo(
    () => collectLocationIds(docs).map((id) => ({ id, name: locationNames.get(id) || id })).sort((a, b) => a.name.localeCompare(b.name)),
    [docs, locationNames],
  );

  const filtersApplied = accountId !== "" || locationId !== "";

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

      {state === LIST_STATE.LOADING && <LoadingState>Loading equipment…</LoadingState>}

      {state === LIST_STATE.DENIED && (
        <FailureState title="Equipment unavailable" message="You are not able to view the Equipment list." />
      )}

      {state === LIST_STATE.UNAVAILABLE && (
        <FailureState title="Couldn’t load Equipment" message={typeof error === "string" ? error : "The Equipment list is temporarily unavailable. Please try again."} />
      )}

      {state === LIST_STATE.EMPTY && (
        <EmptyState
          title={filtersApplied ? "No matching Equipment" : "No installed Equipment"}
          message={filtersApplied ? "No loaded Equipment matches these filters. Clear filters or use Load more to fetch more." : "No installed Equipment has been loaded."}
        />
      )}

      {(state === LIST_STATE.READY || state === LIST_STATE.PARTIAL) && (
        <>
          <ul className="fo-list" aria-label="Installed equipment">
            {rows.map((row) => (
              <li key={row.id}>
                <Link to={row.id}>{row.displayName}</Link>
                <span className="fo-muted">
                  {" — "}
                  {row.accountName}
                  {row.locationName ? ` · ${row.locationName}` : ""}
                  {row.status ? ` · ${row.status}` : ""}
                  {row.serialNumber ? ` · S/N ${row.serialNumber}` : ""}
                </span>
              </li>
            ))}
          </ul>

          {state === LIST_STATE.PARTIAL && (
            <p className="fo-warning" role="status">
              {typeof partialError === "string" ? partialError : "Couldn’t load more Equipment."} Already-loaded rows are shown.
            </p>
          )}

          {hasMore && (
            <button type="button" onClick={() => loadMore()}>
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}

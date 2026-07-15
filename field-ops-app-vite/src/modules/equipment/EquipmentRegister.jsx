import { useMemo, useState } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { ACCOUNTS_COLLECTION, EQUIPMENT_STATUS } from "../../domain/constants";
import { useEquipmentForAccount } from "../../hooks/useEquipment";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { searchEquipment, equipmentDisplayName, equipmentSummary } from "../../domain/equipment";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

// Issue #232 unit E5 -- the Equipment register (Spec §7).
//
// SCOPED BY ACCOUNT, ON PURPOSE. §7 defines the register as search/filter over a
// "bounded Account/Location-scoped set", and E2 (#282) deliberately ships no
// unbounded Equipment hook. So the Account picker is not a convenience filter -- it
// is what BOUNDS the query. Until an Account is chosen there is nothing to read, and
// the page says so rather than reading the whole collection. (E3's Rules would in
// fact permit an admin/dispatcher collection read; the bound is a product decision
// from §7, not something Rules force on us.)
//
// Everything below the subscription is pure and client-side over that already-bounded
// set (§7 explicitly authorizes this): search, Location filter, status filter, count,
// and ordering all run through the E1 domain helpers. No per-record query loop.

const STATUS_FILTERS = [
  // `value: null` is "All statuses" and is the ONLY correct spelling of it.
  // searchEquipment treats an explicitly supplied unknown status -- including "" --
  // as a real filter that matches nothing, so the conventional
  // <option value="">All</option> sentinel would silently show zero rows. Passing
  // null (or omitting the key) is what means "no status filter".
  { key: "all", label: "All statuses", value: null },
  { key: "active", label: "Active", value: EQUIPMENT_STATUS.ACTIVE },
  { key: "inactive", label: "Inactive", value: EQUIPMENT_STATUS.INACTIVE },
  { key: "retired", label: "Retired", value: EQUIPMENT_STATUS.RETIRED },
];

export default function EquipmentRegister() {
  const { data: accounts, loading: accountsLoading, error: accountsError } = useFirestoreCollection(ACCOUNTS_COLLECTION);
  const [accountId, setAccountId] = useState("");
  const [term, setTerm] = useState("");
  const [locationId, setLocationId] = useState("");
  const [statusKey, setStatusKey] = useState("all");

  const { data: equipment, loading, error } = useEquipmentForAccount(accountId || null);
  const { data: locations } = useLocationsForAccount(accountId || null);

  const statusValue = useMemo(
    () => STATUS_FILTERS.find((s) => s.key === statusKey)?.value ?? null,
    [statusKey]
  );

  // One call, one already-bounded array. Options are built explicitly rather than
  // spread from state so a stray key can never reach searchEquipment -- it rejects an
  // unknown option key by returning nothing, which would read as "no results" rather
  // than as the caller bug it is.
  const results = useMemo(
    () => searchEquipment(equipment, { term, locationId: locationId || null, status: statusValue }),
    [equipment, term, locationId, statusValue]
  );

  const filtersApplied = term.trim() !== "" || locationId !== "" || statusValue !== null;
  const accountChosen = accountId !== "";

  const resetFilters = () => {
    setTerm("");
    setLocationId("");
    setStatusKey("all");
  };

  return (
    <section className="fo-workspace fo-equipment-register">
      <WorkspaceHeader title="Equipment">
        <label className="fo-field-inline" htmlFor="equipment-account">
          <span>Customer</span>
          <select
            id="equipment-account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              // A Location belongs to ONE Account (Spec §4), so a Location chosen for
              // the previous Account can never be valid for the new one. Clearing it
              // avoids a filter that silently matches nothing.
              setLocationId("");
            }}
          >
            <option value="">Select a customer…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
      </WorkspaceHeader>

      {accountsLoading ? (
        <LoadingState>Loading customers…</LoadingState>
      ) : accountsError ? (
        <FailureState message={loadErrorMessage(accountsError, { entity: "customers" })} />
      ) : !accountChosen ? (
        // Not an empty database and not a failure -- nothing has been asked for yet.
        // §9 requires these be distinguishable; mislabelling this as "no equipment"
        // would assert something we have not looked up.
        <EmptyState
          variant="database"
          title="Choose a customer"
          message="Select a customer to see the equipment installed at their locations."
        />
      ) : loading ? (
        <LoadingState>Loading equipment…</LoadingState>
      ) : error ? (
        // Terminal read failure -- safe categorized copy only, never the raw code,
        // path, or document id. The content branch is not reached, so no stale rows.
        <FailureState message={error} />
      ) : equipment.length === 0 ? (
        <EmptyState
          variant="database"
          title="No equipment yet"
          message="No equipment is recorded for this customer."
        />
      ) : (
        <>
          <div className="fo-portfolio-filters">
            <label className="fo-field-inline" htmlFor="equipment-search">
              <span>Search</span>
              <input
                id="equipment-search"
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Name, asset tag, serial, manufacturer, model"
              />
            </label>

            <label className="fo-field-inline" htmlFor="equipment-location">
              <span>Location</span>
              <select id="equipment-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>

            <div className="fo-filter-group" role="group" aria-label="Filter by status">
              <span className="fo-filter-label">Status:</span>
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`fo-filter-chip${statusKey === s.key ? " fo-filter-chip-active" : ""}`}
                  aria-pressed={statusKey === s.key}
                  onClick={() => setStatusKey(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {filtersApplied && (
              <button type="button" className="fo-filter-reset" onClick={resetFilters}>
                Clear filters
              </button>
            )}
          </div>

          {/* §7: the result count is a live region, so a filter change is announced
              rather than only being visible. */}
          <p className="fo-result-count" role="status" aria-live="polite">
            {results.length} {results.length === 1 ? "item" : "items"}
          </p>

          {results.length === 0 ? (
            // FILTERED-empty, not database-empty: the customer has equipment, this
            // search does not match any of it. §9 requires the two be distinct, and
            // the remedy differs -- clear the filters vs add a record.
            <EmptyState
              variant="filtered"
              title="No matching equipment"
              message="No equipment matches the current search and filters."
              action={<button type="button" onClick={resetFilters}>Clear filters</button>}
            />
          ) : (
            <table className="fo-table fo-equipment-table">
              <caption className="fo-sr-only">Equipment for the selected customer</caption>
              <thead>
                <tr>
                  <th scope="col">Equipment</th>
                  <th scope="col">Location</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((e) => (
                  <tr key={e.id} data-equipment-row={e.id}>
                    <td>
                      {/* §8: the display name is the human reference -- never a raw
                          id. equipmentSummary disambiguates duplicate names (which are
                          legal) using manufacturer/model/serial, so two "Rooftop Unit"
                          rows stay tellable apart without exposing an id. */}
                      <span className="fo-equipment-name">{equipmentDisplayName(e)}</span>
                      <span className="fo-equipment-summary fo-muted">{equipmentSummary(e)}</span>
                    </td>
                    <td>{locationName(locations, e.locationId)}</td>
                    <td>
                      <span className={`fo-badge fo-badge-${String(e.status ?? "").toLowerCase()}`}>
                        {statusLabel(e.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

// A Location that cannot be resolved is reported as unknown rather than rendered as
// its raw id (§8). This is reachable in practice: the Locations subscription and the
// Equipment subscription settle independently.
function locationName(locations, id) {
  return locations.find((l) => l.id === id)?.name ?? "Unknown location";
}

const STATUS_LABEL = {
  [EQUIPMENT_STATUS.ACTIVE]: "Active",
  [EQUIPMENT_STATUS.INACTIVE]: "Inactive",
  [EQUIPMENT_STATUS.RETIRED]: "Retired",
};

function statusLabel(status) {
  return STATUS_LABEL[status] ?? "Unknown";
}

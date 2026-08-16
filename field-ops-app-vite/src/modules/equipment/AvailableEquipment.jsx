// INV-EQ-P1b -- the Available Equipment tab. A VISIBLE second tab that reads Serialized Assets
// available for assignment through the governed `getAvailableEquipment` read (Wave 7:
// hooks/useAvailableEquipmentSource.js -> services/serializedAssetReadCallableClient.js ->
// functions/src/serializedAsset/serializedAssetReadService.ts). When a READY source supplies assets,
// it offers a Parts-catalog-style search/filter composition over GOVERNED available-asset fields
// (internal identifier, condition/status, location) -- with NO customer filter, since Available is
// company inventory. All logic lives in the pure view-model + the merged P1a selector; no persistence.
//
// Sandbox-fidelity fix (Part 3): this tab previously defaulted to `inertSerializedAssetSource` and
// told the user the Serialized Asset registry "is not available yet" -- stale copy once Wave 7 shipped
// the identity contract, the governed read, and SERIAL receiving. The default source is now the real
// governed hook; `inertSerializedAssetSource` is test-only (see access/serializedAssetSource.js).
// `inventory.serializedAsset.read` is registered `active:false` / granted to no Role as of this build,
// so this surface fails closed to the DENIED state in every environment until a later, separately
// authorized grant + activation -- that is expected, not a bug (see the hook's own header).
//
// LOCATION: the governed read returns only the raw, authoritative `currentLocationId` scalar -- no
// resolved display label and no `{type, locationId}` reference (Location descriptive authority is a
// separate, unread authority). See domain/availableEquipmentGovernedProjection.js's header for the
// full callout. Rows show that raw id as their location field rather than inventing a friendly label.
import { useMemo, useState } from "react";
import { readSerializedAssetSource } from "../../access/serializedAssetSource";
import { useAvailableEquipmentSource } from "../../hooks/useAvailableEquipmentSource";
import {
  AVAILABLE_FILTER_NOTE,
  AVAILABLE_STATE,
  applyAvailableFilters,
  buildAvailableFilterOptions,
  composeAvailableRows,
  deriveAvailableState,
  anyAvailableFilterActive,
} from "../../domain/availableEquipmentCatalogView";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import LoadingState from "../../shared/ui/LoadingState";

const EMPTY_FILTERS = { term: "", category: "", manufacturer: "", model: "", status: "", location: "" };

export default function AvailableEquipment() {
  const liveSource = useAvailableEquipmentSource();
  const { status: sourceStatus, assets } = readSerializedAssetSource(liveSource);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const options = useMemo(() => buildAvailableFilterOptions(assets), [assets]);
  const totalAvailable = useMemo(() => composeAvailableRows(assets).length, [assets]);
  const rows = useMemo(() => applyAvailableFilters(assets, filters), [assets, filters]);
  const state = deriveAvailableState({ sourceStatus, totalAvailable, filteredCount: rows.length });

  if (state === AVAILABLE_STATE.LOADING) {
    return <LoadingState>Loading Available Equipment…</LoadingState>;
  }

  if (state === AVAILABLE_STATE.DENIED) {
    return (
      <FailureState
        title="Available Equipment unavailable"
        message="You are not able to view available Serialized Assets."
      />
    );
  }

  if (state === AVAILABLE_STATE.UNAVAILABLE) {
    // Honest failure surface -- the governed read could not be completed (a transient failure, not a
    // denial). Visible, never blank, never a silent fallback to a fabricated or stale "doesn't exist" claim.
    return (
      <FailureState
        title="Available Equipment temporarily unavailable"
        message="The Available Equipment read could not be completed. Try again later."
      />
    );
  }

  const setField = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const filtersActive = anyAvailableFilterActive(filters);

  const select = (key, label, values) => (
    <label>
      {label}
      <select value={filters[key]} onChange={setField(key)}>
        <option value="">All</option>
        {values.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="fo-panel">
      <h3>Available Equipment</h3>
      <p className="fo-muted" id="ae-filter-note">{AVAILABLE_FILTER_NOTE}</p>

      <div className="fo-filters" role="group" aria-label="Available Equipment filters" aria-describedby="ae-filter-note">
        <label>
          Search
          <input
            type="text"
            value={filters.term}
            onChange={setField("term")}
            placeholder="Internal ID, serial, model, manufacturer…"
          />
        </label>
        {select("category", "Type / category", options.categories)}
        {select("manufacturer", "Manufacturer", options.manufacturers)}
        {select("model", "Model", options.models)}
        {select("status", "Condition / status", options.statuses)}
        {select("location", "Location", options.locations)}
        {filtersActive && (
          <button type="button" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      <p className="fo-muted" role="status" aria-live="polite">
        {rows.length} of {totalAvailable} available
      </p>

      {state === AVAILABLE_STATE.EMPTY ? (
        <EmptyState
          title="No available Equipment"
          message={filtersActive ? "No available inventory matches these filters." : "No serialized assets are currently available for assignment."}
        />
      ) : (
        <ul className="fo-list" aria-label="Available serialized assets">
          {rows.map((r) => (
            <li key={r.serialNo}>
              <span>{r.internalIdentifier || r.serialNo}</span>
              <span className="fo-muted">
                {" — S/N "}{r.serialNo}
                {r.manufacturer ? ` · ${r.manufacturer}` : ""}
                {r.model ? ` ${r.model}` : ""}
                {r.status ? ` · ${r.status}` : ""}
                {r.location ? ` · ${r.location}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

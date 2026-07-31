// INV-EQ-P1b -- the Available Equipment tab. A VISIBLE second tab that reads
// Serialized Assets available for assignment through an injected source. Until the
// Enterprise Inventory Serialized Asset registry exists, the default source is inert
// and this renders an HONEST "not yet connected" state -- never a blank panel and
// never fabricated inventory. When a READY source supplies assets, it offers a
// Parts-catalog-style search/filter composition over GOVERNED available-asset fields
// (internal identifier, category, manufacturer, model, condition/status, warehouse/
// truck location) -- with NO customer filter, since Available is company inventory.
// All logic lives in the pure view-model + the merged P1a selector; no persistence.
import { useMemo, useState } from "react";
import {
  inertSerializedAssetSource,
  readSerializedAssetSource,
} from "../../access/serializedAssetSource";
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

const EMPTY_FILTERS = { term: "", category: "", manufacturer: "", model: "", status: "", location: "" };

export default function AvailableEquipment({ source = inertSerializedAssetSource }) {
  const { status: sourceStatus, assets } = readSerializedAssetSource(source);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const options = useMemo(() => buildAvailableFilterOptions(assets), [assets]);
  const totalAvailable = useMemo(() => composeAvailableRows(assets).length, [assets]);
  const rows = useMemo(() => applyAvailableFilters(assets, filters), [assets, filters]);
  const state = deriveAvailableState({ sourceStatus, totalAvailable, filteredCount: rows.length });

  if (state === AVAILABLE_STATE.DENIED) {
    return (
      <FailureState
        title="Available Equipment unavailable"
        message="You are not able to view available Serialized Assets."
      />
    );
  }

  if (state === AVAILABLE_STATE.UNAVAILABLE) {
    // Honest not-yet-connected surface (registry not built). Visible, never blank.
    return (
      <div className="fo-panel" role="status">
        <h3>Available Equipment</h3>
        <p className="fo-muted">
          Available Equipment lists serialized inventory units ready to assign to a customer. This tab
          is connected to the governed Serialized Asset registry, which is not available yet — no
          inventory is shown until that backend ships and is verified. Nothing here is simulated.
        </p>
      </div>
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

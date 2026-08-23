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
// LOCATION: the governed Serialized Asset read returns only the raw, authoritative
// `currentLocationId` scalar -- no resolved display label and no `{type, locationId}` reference
// (see domain/availableEquipmentGovernedProjection.js's header for the full callout). PART 11A adds
// a SEPARATE trusted resolver (hooks/useLocationDisplaySource.js -> the governed getLocationDisplay
// read) that turns the distinct raw ids on the fetched rows into a WAREHOUSE/MOBILE display label
// where one is governedly resolvable; an id neither authority recognizes stays UNRESOLVED and the
// row keeps rendering its raw id (composeAvailableRow's existing fallback) -- never a guessed type.
// `inventory.location.display.read` is registered `active:false` / granted to no Role as of this
// build, so in every environment today the location column still shows the raw id (the resolver
// itself fails closed to DENIED) -- this wiring is repo-only until a later, separately authorized
// grant + activation, exactly like the Available Equipment read itself at its own introduction.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { readSerializedAssetSource } from "../../access/serializedAssetSource";
import { useEquipmentInstallCapability } from "../../access/useEquipmentInstallCapability";
import { useAccountPicker } from "../../hooks/useAccountPicker";
import { useWholeUnitParts } from "../../hooks/useWholeUnitParts";
import {
  composeWholeUnitAssetRows,
  countAvailableByLine,
  groupRowsByLine,
  LINE_LABEL,
  LINE_OF_BUSINESS,
} from "../../domain/wholeUnitAssetDisplay";
import InstallAtCustomer from "./InstallAtCustomer";
import { useAvailableEquipmentSource } from "../../hooks/useAvailableEquipmentSource";
import { useLocationDisplaySource } from "../../hooks/useLocationDisplaySource";
import {
  AVAILABLE_FILTER_NOTE,
  AVAILABLE_STATE,
  applyAvailableFilters,
  buildAvailableFilterOptions,
  composeAvailableRows,
  deriveAvailableState,
  anyAvailableFilterActive,
} from "../../domain/availableEquipmentCatalogView";
import { distinctLocationIds, applyLocationDisplay } from "../../domain/locationDisplayProjection";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import LoadingState from "../../shared/ui/LoadingState";
import { Button } from "../../shared/ui/primitives";

const EMPTY_FILTERS = { term: "", category: "", manufacturer: "", model: "", status: "", location: "" };

export default function AvailableEquipment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const liveSource = useAvailableEquipmentSource();
  const { status: sourceStatus, assets: rawAssets } = readSerializedAssetSource(liveSource);

  const requestedLocationIds = useMemo(() => distinctLocationIds(rawAssets), [rawAssets]);
  const { displayMap } = useLocationDisplaySource(requestedLocationIds);
  const assets = useMemo(() => applyLocationDisplay(rawAssets, displayMap), [rawAssets, displayMap]);

  // PRODUCT WORDS. The governed read returns ids; the Part is where the canonical equipmentModelId
  // lives, and manufacturer / model / business line are derived from that one identity rather than
  // from a second field that could disagree with it.
  const { parts: wholeUnitParts } = useWholeUnitParts();
  const unitRows = useMemo(() => composeWholeUnitAssetRows(assets, wholeUnitParts), [assets, wholeUnitParts]);
  const availableByLine = useMemo(() => countAvailableByLine(unitRows), [unitRows]);

  // Install is gated on the capability, resolved through the trusted feed and fail-closed while it
  // loads. The server checks again inside its transaction; this only decides what to render.
  const { canInstall } = useEquipmentInstallCapability(user);
  // The app's EXISTING bounded customer picker, not a fresh read of the accounts collection.
  // `options` is already truncated and ordered by that hook, and its truncation notice is the one
  // users see everywhere else a customer is chosen.
  const { options: accountOptions, message: accountsMessage } = useAccountPicker();
  const [installing, setInstalling] = useState(null);   // the unit whose dialog is open

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

  // The filtered set, re-expressed as display rows and grouped. Filtering stays on the existing
  // catalog view so the search/filter behaviour is unchanged; only the RENDERING is new.
  const visibleSerials = new Set(rows.map((r) => r.serialNo));
  const visibleGroups = groupRowsByLine(unitRows.filter((r) => visibleSerials.has(r.serialNo)));

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
          <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
        )}
      </div>

      <p className="fo-muted" role="status" aria-live="polite">
        {rows.length} of {totalAvailable} available
        {" — "}
        {/* The two lines are counted SEPARATELY and always both named, including at zero. A single
            combined total would hide that one business has nothing to sell. */}
        {LINE_LABEL[LINE_OF_BUSINESS.TAYLOR]}: {availableByLine[LINE_OF_BUSINESS.TAYLOR]}
        {" · "}
        {LINE_LABEL[LINE_OF_BUSINESS.VENTANA]}: {availableByLine[LINE_OF_BUSINESS.VENTANA]}
        {availableByLine[LINE_OF_BUSINESS.UNKNOWN] > 0
          ? ` · ${LINE_LABEL[LINE_OF_BUSINESS.UNKNOWN]}: ${availableByLine[LINE_OF_BUSINESS.UNKNOWN]}`
          : ""}
      </p>

      {installing ? (
        <InstallAtCustomer
          unit={installing}
          accounts={accountOptions}
          canInstall={canInstall}
          onClose={() => setInstalling(null)}
          onInstalled={(equipmentId) => navigate(`/equipment/${equipmentId}`)}
        />
      ) : null}
      {installing && accountsMessage ? <p className="fo-muted">{accountsMessage}</p> : null}

      {state === AVAILABLE_STATE.EMPTY ? (
        <EmptyState
          title="No available Equipment"
          message={filtersActive ? "No available inventory matches these filters." : "No serialized assets are currently available for assignment."}
        />
      ) : (
        // GROUPED BY BUSINESS LINE, because "which of these is a Taylor machine" is the first
        // question anyone asks of this list and a flat list of serials does not answer it.
        visibleGroups.map((group) => (
          <section key={group.lineOfBusiness} aria-label={`${group.label} available equipment`}>
            <h4>{group.label} <span className="fo-muted">({group.rows.length})</span></h4>
            {/* The label KEEPS the phrase the previous flat list used, prefixed by the line. Existing
                queries for "available serialized assets" still match, and each group is now named
                rather than there being one anonymous list. */}
            <ul className="fo-list" aria-label={`${group.label} available serialized assets`}>
              {group.rows.map((r) => (
                <li key={r.serialNo}>
                  {/* THE PRODUCT IS THE LABEL. The serial identifies the individual machine and
                      belongs beside it, not in place of it. */}
                  <span>{r.title}</span>
                  <span className="fo-muted">
                    {" — S/N "}{r.serialNo}
                    {r.category ? ` · ${r.category}` : ""}
                    {r.lifecycleState ? ` · ${r.lifecycleState}` : ""}
                    {r.location ? ` · ${r.location}` : ""}
                    {/* An unresolved location renders its raw id, and says so, rather than
                        presenting an id as if it were a place name. */}
                    {r.location && !r.locationResolved ? " (unresolved id)" : ""}
                  </span>
                  {canInstall ? (
                    <Button variant="secondary" onClick={() => setInstalling(r)} disabled={!r.available}>
                      Install / Assign to Customer
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

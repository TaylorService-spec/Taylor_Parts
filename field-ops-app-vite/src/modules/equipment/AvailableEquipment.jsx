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
//
// ════════════ A STALE AUTHORITY CLAIM, CORRECTED (Equipment North Star P1v2.1) ════════════
//
// Two paragraphs here used to assert that `inventory.serializedAsset.read` and
// `inventory.location.display.read` were "granted to no Role as of this build", and concluded that
// this surface "fails closed to the DENIED state in EVERY environment". Both halves were true when
// written and neither is true now, measured rather than assumed:
//
//   * `access/governedBusinessRoles.ts` grants `inventory.serializedAsset.read` to eight governed
//     Roles, and `inventory.location.display.read` to the least-privilege lookup Role.
//   * `config/environments.json` lists BOTH in the sandbox `capabilityActivationOverrides`.
//
// The catalog's `active: false` is the PRODUCTION posture, not a universal one. So DENIED is ONE of
// five possible runtime states here, not the condition of the surface -- which is exactly what the
// locked design corrected as EQ-G1/EQ-G2, and why `deriveAvailableState` models all five. A comment
// is not an authority; nothing about the read, the gating or the fail-closed default changed with
// this correction.
//
// LOCATION: the governed Serialized Asset read returns only the raw, authoritative
// `currentLocationId` scalar -- no resolved display label and no `{type, locationId}` reference
// (see domain/availableEquipmentGovernedProjection.js's header for the full callout). PART 11A adds
// a SEPARATE trusted resolver (hooks/useLocationDisplaySource.js -> the governed getLocationDisplay
// read) that turns the distinct raw ids on the fetched rows into a WAREHOUSE/MOBILE display label
// where one is governedly resolvable. An id neither authority recognizes is an ABSENCE -- the row
// renders "Location unavailable" and never the raw key, and never a guessed type (EQ-G2). The
// resolver still fails closed to DENIED, which reaches the reader as that same absence.
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
// `availableUnitFields` (domain/structuredFields.js) is NOT dropped by this migration -- it is still
// what the handheld/scanner surfaces render a unit through, and its absence rule is the one this
// table now states in its own cells. `availableRowCells` is the table's four-cell composition and
// applies the identical rule (`locationResolved === false` is an absence, never the raw key), which
// is why they agree by construction rather than by coincidence.
import { availableRowCells } from "../../domain/equipmentNorthStar";

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
      {/* NO "Available Equipment" HEADING. The selected tab above already says it, and the tabpanel
          carries `aria-labelledby="eq-tab-available"`, so the accessible name is unchanged. */}
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
            <h4 className="ns-group__heading">
              {group.label} <span className="fo-muted">({group.rows.length})</span>
            </h4>
            {/* THE LOCKED 1b TABLE — Serial · Model · Condition · Location, four fields and four
                cells. This was an `<ul>` of stacked field cards, which stated the same facts
                honestly but could not be scanned down a column: "which of these Taylor units is at
                Main warehouse" took a read of every card. The row grammar is the shared `ns-table`
                one every other North Star collection renders, so nothing family-local is invented.

                SIX ATTRIBUTES STAYED SIX FIELDS through both treatments, and that is the property
                being preserved rather than the markup. The row before either of them was one line —
                "Taylor C161 — S/N CW-C161-0001 · AVAILABLE · wh-main (unresolved id)" — which
                exposed none of them and put a raw location key in front of a person twice.

                `ns-table--cards` + `data-label`: at phone widths each row becomes a labelled card
                rather than something you drag sideways, which is the same answer the metadata grid
                gives and the reason this table opts in. */}
            <div className="ns-table-wrap">
              <table className="ns-table ns-table--cards">
                <caption className="fo-sr-only">{group.label} available serialized assets</caption>
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">Serial</th>
                    <th scope="col">Model</th>
                    <th scope="col">Condition</th>
                    <th scope="col">Location</th>
                    {canInstall ? <th scope="col" className="fo-sr-only">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => {
                    const cells = availableRowCells(r);
                    return (
                      <tr key={r.serialNo} data-available-serial={r.serialNo}>
                        {/* The PRODUCT — what this machine is. Never an id: `title`'s own fallback
                            chain ends at a visible admission that the Part join failed. */}
                        <td data-label="Unit">{cells.unit}</td>
                        <td data-label="Serial">{cells.serial}</td>
                        {/* The MODEL NUMBER, derived from the canonical equipmentModelId, and only
                            that. A unit whose whole-unit Part did not join says so rather than
                            borrowing the product label — see availableRowCells' header. */}
                        <td data-label="Model">
                          {cells.model ?? <span className="ns-state--na">Model unavailable</span>}
                        </td>
                        <td data-label="Condition">
                          {cells.condition ?? <span className="ns-state--na">Not recorded</span>}
                        </td>
                        {/* AN UNRESOLVED LOCATION IS AN ABSENCE, never the raw key: showing the id
                            teaches people to memorise internal identifiers and gives them nothing
                            they can search by (EQ-G2). */}
                        <td data-label="Location">
                          {cells.location ?? <span className="ns-state--na">{cells.locationAbsence}</span>}
                        </td>
                        {canInstall ? (
                          <td data-label="Actions">
                            <Button variant="secondary" onClick={() => setInstalling(r)} disabled={!r.available}>
                              Install at customer
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

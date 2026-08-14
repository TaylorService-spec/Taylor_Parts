// EI-P1d-1 -- the visible Truck Inventory workspace at /inventory/truck-inventory.
//
// READ-ONLY and FAIL-CLOSED. It reads ONLY the injected Truck Inventory source
// (access/truckInventorySource) -- never operationsQueries or any Firestore collection --
// and composes render-ready view-models via the pure domain/truckInventoryView. Until a
// governed Truck Inventory view is connected, the default source is INERT and this renders
// an HONEST "not connected" surface: visible, never blank, never fabricated inventory.
//
//   * accessVersion is the BOUNDARY KEY: a READY source tagged for a prior access version
//     becomes LOADING synchronously, so prior-scope fleet/detail data disappears at once and
//     cannot reappear until a source for the current version is supplied.
//   * Loading and (sanitized, message-less) error states are rendered explicitly.
//   * Status and Condition are controlled selects driven by GOVERNED injected option sets;
//     an ungoverned row value shows "Unavailable" and is never a selectable option.
//   * It computes no inventory value, on-hand, reserved, available, reorder, or discrepancy.
//   * The scan panel is IDENTIFICATION + REVIEW ONLY: no scanner library, movement disabled.
import { useState } from "react";
import { inertTruckInventorySource, readTruckInventorySource } from "../../access/truckInventorySource";
import { TRUCK_FLEET_STATE, buildTruckFleetView, buildTruckDetailView, buildTruckInventoryOptions, truckAssetStatusTone, truckReorderTone, truckFleetStatusTone } from "../../domain/truckInventoryView";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import TruckFleetCard from "./TruckFleetCard.jsx";
import CreateTruckModal from "./truckManagement/CreateTruckModal";
import ManageTruckDrawer from "./truckManagement/ManageTruckDrawer";
import { indexManagementRecords } from "../../domain/truckManagement.js";

const EMPTY_FILTERS = { q: "", technician: "", warehouse: "", status: "", discrepancy: "" };
const TABS = [
  { id: "inventory", label: "Inventory" },
  { id: "manifest", label: "Load Manifest" },
  { id: "activity", label: "Activity" },
  { id: "reconciliation", label: "Reconciliation" },
];
const SCAN_OUTCOMES = [
  { id: "success", label: "Identified", message: "Item matched to a governed Asset/Part. Review the action before it happens." },
  { id: "unknown", label: "Unknown item", message: "This code isn’t registered to any Part or Asset — it can’t be moved." },
  { id: "wrong", label: "Wrong truck", message: "This asset belongs to another truck. Confirm the correct truck first." },
  { id: "duplicate", label: "Duplicate scan", message: "Already scanned in this session — no second movement is created." },
  { id: "missing", label: "Flagged missing", message: "This asset is flagged missing here. Locating it clears the discrepancy after review." },
];
const dash = (v) => (v == null ? "—" : v);
// Governed status/condition display: an ungoverned/absent value reads "Unavailable".
const gov = (v) => (v == null ? "Unavailable" : v);

// Fail-closed default: with no management prop the workspace is the pre-existing
// read-only surface (canManage false -> no Add/Manage controls, no callable seam).
const FAIL_CLOSED_MANAGEMENT = Object.freeze({ canManage: false });

export default function TruckInventory({
  source = inertTruckInventorySource,
  accessVersion,
  management = FAIL_CLOSED_MANAGEMENT,
  managementRecords = [],
  onReconcile,
}) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("inventory");
  const [scan, setScan] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // Fail-closed access invalidation: on any access-boundary change, synchronously drop the
  // selected truck, filters, any open scan panel, and any open management surface (the
  // READY *data* is separately invalidated by the accessVersion boundary key passed to
  // readTruckInventorySource).
  const [loadedVersion, setLoadedVersion] = useState(accessVersion);
  if (loadedVersion !== accessVersion) {
    setLoadedVersion(accessVersion);
    setFilters(EMPTY_FILTERS);
    setSelectedId(null);
    setScan(null);
    setShowCreate(false);
    setManageOpen(false);
  }

  const canManage = management.canManage === true;
  const recordsById = indexManagementRecords(managementRecords);

  const read = readTruckInventorySource(source, accessVersion);
  const options = buildTruckInventoryOptions(read);
  const fleet = buildTruckFleetView(read);

  if (fleet.state === TRUCK_FLEET_STATE.DENIED) {
    return <FailureState title="Truck Inventory unavailable" message="You are not able to view Truck Inventory." />;
  }
  if (fleet.state === TRUCK_FLEET_STATE.ERROR) {
    // Sanitized, generic failure -- never a raw error object/message.
    return <FailureState title="Truck Inventory couldn’t be loaded" message="Something went wrong loading Truck Inventory. Please try again." />;
  }
  if (fleet.state === TRUCK_FLEET_STATE.LOADING) {
    return (
      <WorkspaceShell title="Truck Inventory">
        <p className="fo-muted" role="status" aria-live="polite">Loading truck inventory…</p>
      </WorkspaceShell>
    );
  }
  if (fleet.state === TRUCK_FLEET_STATE.UNAVAILABLE) {
    return (
      <WorkspaceShell title="Truck Inventory">
        <p className="fo-muted" role="status">
          Truck Inventory shows the serialized equipment and parts carried on each service truck, with load
          manifests and warehouse&nbsp;→&nbsp;truck&nbsp;→&nbsp;customer reconciliation. This workspace is
          connected to the governed Truck Inventory view, which is not available yet — no trucks or inventory
          are shown until that backend ships and is verified. Nothing here is simulated.
        </p>
      </WorkspaceShell>
    );
  }

  const scanModal = scan && (
    <div className="fo-modal-overlay" role="presentation" onClick={() => setScan(null)}>
      <div className="fo-panel" role="dialog" aria-modal="true" aria-label="Scan review" style={{ maxWidth: 480, margin: "10vh auto" }} onClick={(e) => e.stopPropagation()}>
        <h3>Scan review</h3>
        <p className="fo-muted">A scan <b>identifies</b> an item and opens this review — it never moves inventory on its own. Movement isn’t wired in this workspace.</p>
        <div className="fo-chip-row" role="group" aria-label="Scan outcomes">
          {SCAN_OUTCOMES.map((o) => (
            <button key={o.id} type="button" className="fo-chip" aria-pressed={scan === o.id} onClick={() => setScan(o.id)}>{o.label}</button>
          ))}
        </div>
        <p role="status" aria-live="polite">{SCAN_OUTCOMES.find((o) => o.id === scan)?.message}</p>
        <div className="fo-btn-row">
          <button type="button" className="fo-btn-secondary" onClick={() => setScan(null)}>Close</button>
          <button type="button" disabled title="Movement is not available in this workspace">Confirm (not available)</button>
        </div>
      </div>
    </div>
  );

  if (selectedId) {
    const detail = buildTruckDetailView(read, selectedId);
    if (!detail.truck) {
      return (
        <WorkspaceShell
          title="Truck Inventory"
          actions={<ActionRail start={<button type="button" className="fo-back-link" onClick={() => setSelectedId(null)}>← All trucks</button>} />}
        >
          <EmptyState title="Truck not available" message="This truck is no longer in the connected view." />
        </WorkspaceShell>
      );
    }
    // Management (admin/dispatcher) can open the Manage drawer for this truck, provided a
    // governed management record (with a version for optimistic concurrency) exists.
    const record = recordsById.get(detail.truck.id);
    const onManage = canManage && record ? () => setManageOpen(true) : null;
    return (
      <>
        <TruckDetail key={detail.truck.id} truck={detail.truck} options={options} tab={tab} setTab={setTab} onBack={() => { setManageOpen(false); setSelectedId(null); }} onScan={() => setScan("success")} scanModal={scanModal} onManage={onManage} />
        {manageOpen && canManage && record && (
          <ManageTruckDrawer
            record={record}
            driverName={detail.truck.technician}
            commands={management.commands}
            writeReady={management.writeReady}
            isAdmin={management.isAdmin === true}
            useDriverOptions={management.useDriverOptions}
            useWarehouseOptions={management.useWarehouseOptions}
            onClose={() => setManageOpen(false)}
            onReconcile={onReconcile}
          />
        )}
      </>
    );
  }

  // Fleet view (READY or EMPTY). Technician/warehouse filters derive from rows (free
  // identifiers); Status uses the GOVERNED fleetStatus option set (never row-derived).
  const distinct = (key) => [...new Set(fleet.trucks.map((t) => t[key]).filter(Boolean))].sort();
  const rows = fleet.trucks.filter((t) => {
    const f = filters;
    if (f.q && !(t.id.toLowerCase().includes(f.q.toLowerCase()) || (t.technician || "").toLowerCase().includes(f.q.toLowerCase()))) return false;
    if (f.technician && t.technician !== f.technician) return false;
    if (f.warehouse && t.homeWarehouse !== f.warehouse) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.discrepancy === "yes" && !(t.metrics.discrepancies > 0)) return false;
    if (f.discrepancy === "no" && t.metrics.discrepancies !== 0) return false;
    return true;
  });
  const setField = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const discrepancyTrucks = fleet.trucks.filter((t) => t.metrics.discrepancies > 0).length;
  const actions = (
    <ActionRail
      primary={canManage ? (
        <button
          type="button"
          className="fo-btn-primary"
          onClick={() => setShowCreate(true)}
          disabled={!management.writeReady}
          title={management.writeReady ? "Add a truck" : "Truck management is not yet enabled"}
          data-testid="add-truck"
        >
          + Add truck{management.writeReady ? "" : " (not yet enabled)"}
        </button>
      ) : null}
      secondary={<button type="button" className="fo-btn-secondary" onClick={() => setScan("success")}>▣ Scan</button>}
    />
  );
  const context = (
    <ContextBand
      items={[
        { key: "trucks", label: "Trucks", value: fleet.trucks.length },
        { key: "discrepancies", label: "With discrepancies", value: discrepancyTrucks },
        { key: "showing", label: "Showing", value: rows.length },
      ]}
    />
  );

  return (
    <WorkspaceShell title="Truck Inventory" actions={actions} context={context}>
      <p className="fo-muted">Serialized equipment and parts carried on each service truck. Read-only. Values shown are provided by the governed view — nothing is calculated here.</p>

      <div className="fo-filters" role="group" aria-label="Truck filters">
        <label>Truck<input type="text" value={filters.q} onChange={setField("q")} placeholder="Truck # or technician…" /></label>
        <label>Technician<select value={filters.technician} onChange={setField("technician")}><option value="">All</option>{distinct("technician").map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Warehouse<select value={filters.warehouse} onChange={setField("warehouse")}><option value="">All</option>{distinct("homeWarehouse").map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={setField("status")}><option value="">All</option>{options.fleetStatus.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Discrepancy<select value={filters.discrepancy} onChange={setField("discrepancy")}><option value="">All</option><option value="yes">With discrepancies</option><option value="no">Clean</option></select></label>
      </div>

      {fleet.state === TRUCK_FLEET_STATE.EMPTY ? (
        <EmptyState title="No trucks recorded" message="The governed Truck Inventory view is connected but reports no trucks yet." />
      ) : rows.length === 0 ? (
        <EmptyState variant="filtered" title="No trucks match" message="No trucks match these filters." />
      ) : (
        <ul className="fo-card-grid" aria-label="Truck fleet">
          {rows.map((t) => (
            <li key={t.id}>
              <TruckFleetCard truck={t} onOpen={() => { setSelectedId(t.id); setTab("inventory"); }} />
            </li>
          ))}
        </ul>
      )}
      {scanModal}
      {showCreate && canManage && (
        <CreateTruckModal
          commands={management.commands}
          writeReady={management.writeReady}
          useDriverOptions={management.useDriverOptions}
          useWarehouseOptions={management.useWarehouseOptions}
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </WorkspaceShell>
  );
}

// The ONE status treatment for asset/manifest/reconciliation rows — a StatusPill fed by the truck domain's
// tone map. An absent value reads as "Unavailable" text (unknown tone), never a coloured pill.
function StatusBadge({ value }) {
  if (!value) return <StatusPill tone="unknown" asText label="Unavailable" />;
  return <StatusPill tone={truckAssetStatusTone(value)} label={value.replace(/_/g, " ")} />;
}

function TruckDetail({ truck, options, tab, setTab, onBack, onScan, scanModal, onManage }) {
  const actions = (
    <ActionRail
      start={<button type="button" className="fo-back-link" onClick={onBack}>← All trucks</button>}
      primary={onManage ? <button type="button" className="fo-btn-primary" onClick={onManage} data-testid="manage-truck">Manage truck</button> : null}
      secondary={<button type="button" className="fo-btn-secondary" onClick={onScan}>▣ Scan</button>}
    />
  );
  const context = (
    <ContextBand
      items={[
        { key: "status", label: "Status", value: truck.status == null ? <StatusPill tone="unknown" asText label="Unavailable" /> : <StatusPill tone={truckFleetStatusTone(truck.status)} label={truck.status} /> },
        { key: "tech", label: "Technician", value: truck.technician || "Unassigned" },
        { key: "loc", label: "Location", value: truck.location || "—" },
        { key: "home", label: "Home warehouse", value: truck.homeWarehouse || "—" },
      ]}
    />
  );
  return (
    <WorkspaceShell title={truck.id} actions={actions} context={context}>
      <div role="tablist" aria-label="Truck views" className="fo-tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="fo-btn-secondary" style={tab === t.id ? { fontWeight: 700 } : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === "inventory" && <InventoryTab truck={truck} options={options} />}
        {tab === "manifest" && <ManifestTab manifest={truck.manifest} />}
        {tab === "activity" && <ActivityTab activity={truck.activity} />}
        {tab === "reconciliation" && <ReconciliationTab reconciliation={truck.reconciliation} />}
      </div>
      {scanModal}
    </WorkspaceShell>
  );
}

function InventoryTab({ truck, options }) {
  const [condition, setCondition] = useState("");
  const equipment = condition ? truck.serializedEquipment.filter((e) => e.condition === condition) : truck.serializedEquipment;
  return (
    <>
      <div className="fo-btn-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h4>Serialized Equipment</h4>
        <label>Condition<select value={condition} onChange={(e) => setCondition(e.target.value)}><option value="">All</option>{options.equipmentCondition.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>
      {truck.serializedEquipment.length === 0 ? (
        <EmptyState title="No serialized equipment" message="No serialized units are reported on this truck." />
      ) : equipment.length === 0 ? (
        <EmptyState variant="filtered" title="No equipment matches" message="No serialized units match this condition." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead><tr><th>Asset ID</th><th>Internal SKU</th><th>Manufacturer / Model</th><th>Serial</th><th>Condition</th><th>Status</th><th>Destination</th><th>Current location</th></tr></thead>
            <tbody>
              {equipment.map((e, i) => (
                <tr key={e.assetId || e.serial || i}>
                  <td>{dash(e.assetId)}</td><td>{dash(e.internalSku)}</td>
                  <td>{e.manufacturer || e.model ? `${e.manufacturer || ""}${e.manufacturer && e.model ? " · " : ""}${e.model || ""}` : "—"}</td>
                  <td>{dash(e.serial)}</td><td>{gov(e.condition)}</td><td><StatusBadge value={e.status} /></td>
                  <td>{dash(e.destination)}</td><td>{dash(e.currentLocation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h4>Stocked Parts</h4>
      {truck.parts.length === 0 ? (
        <EmptyState title="No stocked parts" message="No parts are reported on this truck." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead><tr><th>Internal SKU</th><th>Description</th><th>Bin</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Reorder</th></tr></thead>
            <tbody>
              {truck.parts.map((p, i) => (
                <tr key={p.internalSku || i}>
                  <td>{p.internalSku}</td><td>{dash(p.description)}</td><td>{dash(p.bin)}</td>
                  <td>{dash(p.onHand)}</td><td>{dash(p.reserved)}</td><td>{dash(p.available)}</td>
                  <td>{p.reorderStatus ? <StatusPill tone={truckReorderTone(p.reorderStatus)} label={p.reorderStatus} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ManifestTab({ manifest }) {
  if (!manifest || manifest.lines.length === 0) {
    return <EmptyState title="No active load manifest" message="There are no planned warehouse → truck transfers reported for this truck." />;
  }
  return (
    <div className="fo-panel">
      <h4>Load Manifest {manifest.order ? `· ${manifest.order}` : ""} {manifest.status ? <StatusBadge value={manifest.status} /> : null}</h4>
      {manifest.fromWarehouse ? <p className="fo-muted">From {manifest.fromWarehouse}</p> : null}
      <div className="fo-table-scroll">
        <table className="fo-table">
          <thead><tr><th>Item</th><th>Internal SKU</th><th>Serial</th><th>State</th></tr></thead>
          <tbody>
            {manifest.lines.map((l, i) => (
              <tr key={(l.internalSku || "") + (l.serial || "") + i}><td>{dash(l.label)}</td><td>{dash(l.internalSku)}</td><td>{dash(l.serial)}</td><td><StatusBadge value={l.state} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityTab({ activity }) {
  if (activity.length === 0) return <EmptyState title="No activity" message="No scans, loads, transfers, or adjustments are reported for this truck." />;
  return (
    <ul className="fo-activity-list">
      {activity.map((a, i) => (
        <li key={i}><b>{dash(a.type)}</b> <span className="fo-muted">{dash(a.time)}</span><div>{dash(a.message)}</div></li>
      ))}
    </ul>
  );
}

function ReconciliationTab({ reconciliation }) {
  const r = reconciliation;
  if (!r) return <EmptyState title="No reconciliation" message="Expected-vs-scanned reconciliation is not reported for this truck." />;
  return (
    <div className="fo-panel">
      <h4>Expected vs Scanned</h4>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <div><dt className="fo-muted">Serialized expected</dt><dd style={{ margin: 0 }}>{dash(r.expectedSerialized)}</dd></div>
        <div><dt className="fo-muted">Serialized scanned</dt><dd style={{ margin: 0 }}>{dash(r.scannedSerialized)}</dd></div>
        <div><dt className="fo-muted">Parts expected</dt><dd style={{ margin: 0 }}>{dash(r.expectedParts)}</dd></div>
        <div><dt className="fo-muted">Parts scanned</dt><dd style={{ margin: 0 }}>{dash(r.scannedParts)}</dd></div>
      </dl>
      <h4>Missing</h4>
      {r.missing.length === 0 ? <p className="fo-muted">None reported.</p> : (
        <ul className="fo-list">{r.missing.map((m, i) => <li key={m.assetId || m.serial || i}><StatusPill tone="critical" label="Missing" /> {dash(m.label)} · {dash(m.serial)} <span className="fo-muted">— last seen {dash(m.lastSeen)}; expected {dash(m.expected)}; actual {dash(m.actual)}</span></li>)}</ul>
      )}
      <h4>Unexpected</h4>
      {r.unexpected.length === 0 ? <p className="fo-muted">None reported.</p> : (
        <ul className="fo-list">{r.unexpected.map((u, i) => <li key={u.assetId || u.serial || i}><StatusPill tone="info" label="Unexpected" /> {dash(u.label)} · {dash(u.serial)}{u.note ? <span className="fo-muted"> — {u.note}</span> : null}</li>)}</ul>
      )}
    </div>
  );
}

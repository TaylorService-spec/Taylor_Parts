import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWarehouses } from "../../hooks/useWarehouses";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import {
  buildWarehousesView,
  WAREHOUSE_FILTERS,
  DEFAULT_WAREHOUSE_FILTER,
  filterWarehouses,
  countForWarehouseFilter,
  warehouseStatusLabel,
  warehouseStatusTone,
} from "../../domain/warehousesView";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// Inventory > Warehouses -- the first-class workspace for the warehouse (inventory-location)
// capability: the registry of the company's warehouses with their GOVERNED status (ACTIVE/INACTIVE)
// and receiving-eligibility. READ-ONLY (warehouses is Admin-SDK-write-only; no client/deployed write
// path). It REUSES the shared read (useWarehouses -> operationsQueries.fetchWarehouses) and the pure
// domain view (warehousesView.js), which mirrors the I-LA receiving-eligibility resolver -- so
// "receiving-eligible" here means exactly what the Receiving workspace accepts.
//
// Deliberately NON-DUPLICATIVE: bin-level stock and reconciliation live in the Operations
// dashboard's WarehousePanel and are NOT re-rendered here (this workspace links there instead);
// WarehouseManagerHome remains the WAREHOUSE_MANAGER persona surface, untouched. Access: the
// Inventory > Warehouses nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES), matching the
// warehouses read rule's common path; a denied read fails closed. No Rules/deploy/grant/production.
export default function Warehouses({ accessVersion }) {
  const read = useWarehouses(accessVersion);
  const { rows, summary } = useMemo(() => buildWarehousesView(read.warehouses), [read.warehouses]);
  const [filterKey, setFilterKey] = useState(DEFAULT_WAREHOUSE_FILTER);

  const intro = <p className="fo-muted">The company's warehouses and their governed status. <strong>Active</strong> warehouses are eligible to receive inventory — the receiving service makes the final check.</p>;

  if (read.loading) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Warehouses" />
        {intro}
        <LoadingState>Loading warehouses…</LoadingState>
      </div>
    );
  }
  if (read.error) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Warehouses" />
        {intro}
        <FailureState title="Warehouses unavailable" message={loadErrorMessage({ code: read.error }, { entity: "warehouses" })} />
      </div>
    );
  }

  const visibleRows = filterWarehouses(rows, filterKey);
  const filterOptions = WAREHOUSE_FILTERS.map((f) => ({ key: f.key, label: f.label, count: countForWarehouseFilter(rows, f.key) }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Warehouses" />
      {intro}
      {summary.total > 0 && (
        <p className="fo-muted" role="status">
          {summary.total} warehouse{summary.total === 1 ? "" : "s"} · {summary.active} active
          {summary.inactive > 0 ? ` · ${summary.inactive} inactive` : ""}.
        </p>
      )}
      {summary.ungoverned > 0 && (
        <p className="fo-warning" role="alert">
          {summary.ungoverned} warehouse{summary.ungoverned === 1 ? "" : "s"} {summary.ungoverned === 1 ? "has" : "have"} no governed status — the receiving service will not accept {summary.ungoverned === 1 ? "it" : "them"} until governed. Report this if it persists.
        </p>
      )}
      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      {rows.length === 0 ? (
        <EmptyState
          variant="database"
          title="No warehouses"
          message="No warehouses are recorded yet."
          guidance="Warehouses are the stocking locations inventory is received into and issued from. They are set up outside this read-only screen, and a warehouse must be Active to be eligible to receive."
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState variant="filtered" title="No matching warehouses" message="No warehouses match this filter." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Warehouses">
            <thead>
              <tr>
                <th scope="col">Warehouse</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>
                    <span className={`fo-wh-status fo-wh-status--${warehouseStatusTone(row.status)}`}>
                      {warehouseStatusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="fo-muted fo-wh-footnote">
        For bin-level stock and reconciliation, see the <Link to="/dashboard/operations">Operations overview</Link>.
      </p>
    </div>
  );
}

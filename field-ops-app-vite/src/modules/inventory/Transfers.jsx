import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTransferOrders } from "../../hooks/useTransferOrders";
import { buildTransferOrdersView } from "../operations/transferOrdersViewModel";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import {
  TRANSFER_FILTERS,
  DEFAULT_TRANSFER_FILTER,
  filterTransfers,
  countForFilter,
  summarizeTransfers,
  transferStatusLabel,
  transferStatusTone,
} from "../../domain/transfersView";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// Inventory > Transfers -- the first-class workspace for the inventory-transfer capability
// (movement of stock between locations). It is READ-ONLY: transfer_orders is Admin-SDK-write-only
// (no client/deployed write path), so this surfaces transfers, it does not create/mutate them.
//
// Single source of truth: it REUSES the shared read (useTransferOrders -> operationsQueries) and
// the CANONICAL view-model (buildTransferOrdersView -- the same one the Operations dashboard uses),
// then composes operator-centric status groups + exception surfacing (domain/transfersView.js). It
// adds no parallel read, no re-mapping of raw docs, and no direct Firebase access.
//
// Access: the Inventory > Transfers nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES),
// matching the transfer_orders read rule's common path; a denied read fails closed to a
// FailureState. No Rules/deploy/grant/production is part of this workspace.
function Endpoint({ end }) {
  if (!end) return <span className="fo-muted">—</span>;
  const showType = end.type && end.type !== "WAREHOUSE";
  return (
    <span className="fo-transfer-endpoint">
      {end.label}
      {showType && <span className="fo-transfer-endpoint-type">{end.type.toLowerCase()}</span>}
    </span>
  );
}

export default function Transfers({ accessVersion }) {
  const read = useTransferOrders(accessVersion);
  const { rows, hiddenInvalidCount } = useMemo(
    () => buildTransferOrdersView(read.transferOrderDocs, read.warehouses),
    [read.transferOrderDocs, read.warehouses]
  );
  const summary = useMemo(() => summarizeTransfers(rows), [rows]);
  const [filterKey, setFilterKey] = useState(DEFAULT_TRANSFER_FILTER);

  const intro = <p className="fo-muted">Track inventory moving between locations — what's in transit, where from and to, and for which part.</p>;

  if (read.loading) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Transfers" />
        {intro}
        <LoadingState>Loading transfers…</LoadingState>
      </div>
    );
  }
  if (read.error) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Transfers" />
        {intro}
        <FailureState title="Transfers unavailable" message={loadErrorMessage({ code: read.error }, { entity: "transfers" })} />
      </div>
    );
  }

  const visibleRows = filterTransfers(rows, filterKey);
  const filterOptions = TRANSFER_FILTERS.map((f) => ({ key: f.key, label: f.label, count: countForFilter(rows, f.key) }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Transfers" />
      {intro}
      {summary.inFlight > 0 && (
        <p className="fo-muted" role="status">
          {summary.inFlight} transfer{summary.inFlight === 1 ? "" : "s"} in flight
          {summary.byStatus.IN_TRANSIT > 0 ? ` (${summary.byStatus.IN_TRANSIT} ${transferStatusLabel("IN_TRANSIT").toLowerCase()})` : ""}.
        </p>
      )}
      {hiddenInvalidCount > 0 && (
        <p className="fo-warning" role="alert">
          {hiddenInvalidCount} transfer record{hiddenInvalidCount === 1 ? "" : "s"} couldn't be displayed due to a data issue — report this if it persists.
        </p>
      )}
      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      {rows.length === 0 ? (
        <EmptyState variant="database" title="No transfers yet" message="Inventory transfers between locations will appear here." />
      ) : visibleRows.length === 0 ? (
        <EmptyState variant="filtered" title="No matching transfers" message="No transfers match this filter." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Transfers">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">From</th>
                <th scope="col" aria-hidden="true"></th>
                <th scope="col">To</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.transferOrderId}>
                  <td>{row.partId ? <Link to={`/inventory/${row.partId}`}>{row.partId}</Link> : <span className="fo-muted">—</span>}</td>
                  <td><Endpoint end={row.origin} /></td>
                  <td className="fo-transfer-arrow" aria-hidden="true">→</td>
                  <td><Endpoint end={row.destination} /></td>
                  <td>
                    <span className={`fo-transfer-status fo-transfer-status--${transferStatusTone(row.status)}`}>
                      {transferStatusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

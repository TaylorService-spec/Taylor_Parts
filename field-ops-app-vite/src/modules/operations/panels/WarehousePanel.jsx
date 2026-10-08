// Warehouse -- pure renderer.
//
// BIN-P2R removed this panel's bin-stock table and its Reconciliation section. Both were fed by
// `stock_locations`, which Decision #160 / ADR-014 retired: nothing ever wrote it, and where it was
// seeded it disagreed with the ledger in both directions. Rendering its quantities to an operator
// was the visible half of that defect.
//
// The reconciliation section was DELETED rather than emptied. Its M15 scope guard only fires when
// bin stock is present, so passing an empty array would have flipped the panel from an honest
// CANNOT_EVALUATE to "No discrepancies" -- a clean bill of health for a check that never ran, which
// is precisely the defect M15 exists to prevent.
//
// Bin-level quantity returns only when BIN-P6 establishes governed bin-level custody. Until then
// there is no truthful number to show here, and showing none is the honest answer.
//
// The Transfer Orders table below is unaffected: it is a read-only, location-aware view of the
// CURRENT governed transfer authority, whose rows come from the pure buildTransferOrdersView.
import { buildTransferOrdersView } from "../transferOrdersViewModel.js";
import { useMemo } from "react";
import StatusPill from "../../../shared/ui/StatusPill.jsx";
import { statusLabel, titleCase } from "../../../shared/display/displayLabels.js";
import SortableHeader from "../../../shared/ui/sorting/SortableHeader.jsx";
import { useTableSort } from "../../../shared/ui/sorting/useTableSort.js";

// One transfer endpoint cell: a WAREHOUSE shows its resolved name; every
// other location type shows a type badge plus the raw locationId (no
// governed label authority exists for trucks/vendors/customers yet).
function TransferEndpoint({ endpoint }) {
  if (endpoint.type === "WAREHOUSE") return <>{endpoint.label}</>;
  return (
    <>
      <StatusPill tone="neutral" label={titleCase(endpoint.type)} /> {endpoint.locationId}
    </>
  );
}

// The sortable text of one endpoint: the warehouse name, or the location type + id it renders.
const endpointSortValue = (endpoint) => (endpoint.type === "WAREHOUSE" ? endpoint.label : `${titleCase(endpoint.type)} ${endpoint.locationId ?? ""}`.trim());

export default function WarehousePanel({ warehouses, transferOrderDocs, resolveName }) {
  const { rows: transferRows, hiddenInvalidCount } = useMemo(
    () => buildTransferOrdersView(transferOrderDocs, warehouses),
    [transferOrderDocs, warehouses]
  );
  // Client-side sort over the loaded transfer rows (item C); the view-model's order is the default.
  const sortColumns = useMemo(() => ({
    part: { value: (t) => resolveName(t.partId) },
    origin: { value: (t) => endpointSortValue(t.origin) },
    destination: { value: (t) => endpointSortValue(t.destination) },
    status: { value: (t) => statusLabel(t.status) },
  }), [resolveName]);
  const { sort, toggle, sorted } = useTableSort({ rows: transferRows, columns: sortColumns });

  return (
    <div className="fo-card">
      <h3>Warehouse</h3>

      <h4>Transfer Orders</h4>
      {hiddenInvalidCount > 0 && (
        <p className="fo-muted" role="status">
          {hiddenInvalidCount} transfer order{hiddenInvalidCount === 1 ? "" : "s"} hidden (invalid or contradictory records).
        </p>
      )}
      {transferRows.length > 0 ? (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <SortableHeader columnKey="part" label="Part" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="origin" label="Origin" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="destination" label="Destination" sort={sort} onSort={toggle} />
                <SortableHeader columnKey="status" label="Status" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.transferOrderId}>
                  <td>{resolveName(t.partId)}</td>
                  <td><TransferEndpoint endpoint={t.origin} /></td>
                  <td><TransferEndpoint endpoint={t.destination} /></td>
                  <td>{statusLabel(t.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        hiddenInvalidCount === 0 && <p className="fo-muted">No transfer orders.</p>
      )}
    </div>
  );
}

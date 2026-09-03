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
import StatusPill from "../../../shared/ui/StatusPill.jsx";

// One transfer endpoint cell: a WAREHOUSE shows its resolved name; every
// other location type shows a type badge plus the raw locationId (no
// governed label authority exists for trucks/vendors/customers yet).
function TransferEndpoint({ endpoint }) {
  if (endpoint.type === "WAREHOUSE") return <>{endpoint.label}</>;
  return (
    <>
      <StatusPill tone="neutral" label={endpoint.type} /> {endpoint.locationId}
    </>
  );
}

export default function WarehousePanel({ warehouses, transferOrderDocs, resolveName }) {
  const { rows: transferRows, hiddenInvalidCount } = buildTransferOrdersView(transferOrderDocs, warehouses);

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
                <th>Part</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transferRows.map((t) => (
                <tr key={t.transferOrderId}>
                  <td>{resolveName(t.partId)}</td>
                  <td><TransferEndpoint endpoint={t.origin} /></td>
                  <td><TransferEndpoint endpoint={t.destination} /></td>
                  <td>{t.status}</td>
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

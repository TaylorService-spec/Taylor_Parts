// Epic 4 Warehouse -- pure renderer. Reconciliation is strictly
// informational (see warehouseReconciliationEngine.ts) -- there is no
// "fix" button anywhere on this panel. The Transfer Orders table is a
// read-only, location-aware view (EI-P1c-2): rows come from the pure
// buildTransferOrdersView, which applies the merged transfer-order
// adapter so invalid/contradictory records are counted, never rendered.
import { buildTransferOrdersView } from "../transferOrdersViewModel.js";

// One transfer endpoint cell: a WAREHOUSE shows its resolved name; every
// other location type shows a type badge plus the raw locationId (no
// governed label authority exists for trucks/vendors/customers yet).
function TransferEndpoint({ endpoint }) {
  if (endpoint.type === "WAREHOUSE") return <>{endpoint.label}</>;
  return (
    <>
      <span className="fo-badge">{endpoint.type}</span> {endpoint.locationId}
    </>
  );
}

export default function WarehousePanel({ warehouses, stockLocations, transferOrderDocs, reconciliationReport, resolveName }) {
  const warehouseName = (id) => warehouses.find((w) => w.id === id)?.name ?? id;
  const { rows: transferRows, hiddenInvalidCount } = buildTransferOrdersView(transferOrderDocs, warehouses);

  return (
    <div className="fo-card">
      <h3>Warehouse</h3>

      {stockLocations.length === 0 ? (
        <p className="fo-muted">No bin-level stock recorded yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Part</th>
              <th>Bin</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {stockLocations.map((loc) => (
              <tr key={loc.id}>
                <td>{warehouseName(loc.warehouseId)}</td>
                <td>{resolveName(loc.partId)}</td>
                <td>{loc.binCode}</td>
                <td>{loc.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Reconciliation</h4>
      {reconciliationReport.totalDiscrepancies === 0 ? (
        <p className="fo-muted">No discrepancies between physical stock and ledger-derived expectation.</p>
      ) : (
        <>
          <p className="fo-muted">
            {reconciliationReport.totalDiscrepancies} discrepancies -- {reconciliationReport.bySeverity.CRITICAL} critical,{" "}
            {reconciliationReport.bySeverity.HIGH} high, {reconciliationReport.bySeverity.MEDIUM} medium,{" "}
            {reconciliationReport.bySeverity.LOW} low.
          </p>
          <table className="fo-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Warehouse</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Variance</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationReport.discrepancies.map((d) => (
                <tr key={`${d.warehouseId}-${d.partId}`}>
                  <td>{resolveName(d.partId)}</td>
                  <td>{warehouseName(d.warehouseId)}</td>
                  <td>{d.expectedQuantity}</td>
                  <td>{d.actualQuantity}</td>
                  <td>{d.variance > 0 ? `+${d.variance}` : d.variance}</td>
                  <td>
                    <span className={`fo-badge fo-badge-${d.severity.toLowerCase()}`}>{d.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4>Transfer Orders</h4>
      {hiddenInvalidCount > 0 && (
        <p className="fo-muted" role="status">
          {hiddenInvalidCount} transfer order{hiddenInvalidCount === 1 ? "" : "s"} hidden (invalid or contradictory records).
        </p>
      )}
      {transferRows.length > 0 ? (
        <div className="fo-table-scroll" style={{ overflowX: "auto" }}>
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

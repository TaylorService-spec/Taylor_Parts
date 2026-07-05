import { getCatalogItem } from "../../../data/partsCatalog";

// Epic 4 Warehouse -- pure renderer. Reconciliation is strictly
// informational (see warehouseReconciliationEngine.ts) -- there is no
// "fix" button anywhere on this panel.
export default function WarehousePanel({ warehouses, stockLocations, transferOrders, reconciliationReport }) {
  const warehouseName = (id) => warehouses.find((w) => w.id === id)?.name ?? id;

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
                <td>{getCatalogItem(loc.partId)?.name ?? loc.partId}</td>
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
                  <td>{getCatalogItem(d.partId)?.name ?? d.partId}</td>
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
      {transferOrders.length === 0 ? (
        <p className="fo-muted">No transfer orders.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>From</th>
              <th>To</th>
              <th>Quantity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transferOrders.map((t) => (
              <tr key={t.id}>
                <td>{getCatalogItem(t.partId)?.name ?? t.partId}</td>
                <td>{warehouseName(t.fromWarehouseId)}</td>
                <td>{warehouseName(t.toWarehouseId)}</td>
                <td>{t.quantity}</td>
                <td>{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

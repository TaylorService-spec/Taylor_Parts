// Epic 4 Warehouse -- pure renderer. Reconciliation is strictly
// informational (see warehouseReconciliationEngine.ts) -- there is no
// "fix" button anywhere on this panel. The Transfer Orders table is a
// read-only, location-aware view (EI-P1c-2): rows come from the pure
// buildTransferOrdersView, which applies the merged transfer-order
// adapter so invalid/contradictory records are counted, never rendered.
import { buildTransferOrdersView } from "../transferOrdersViewModel.js";
import {
  classifyReconciliationRow,
  quantityText,
  varianceText,
  summariseReconciliation,
} from "../../../domain/reconciliationRowHonesty.js";
import { inventoryUrgencyTone } from "../../../domain/inventoryUrgencyTone";
import StatusPill from "../../../shared/ui/StatusPill.jsx";
import { resolveWarehouseIdentity } from "../../../domain/actorDisplayName";

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

export default function WarehousePanel({ warehouses, stockLocations, transferOrderDocs, reconciliationReport, resolveName }) {
  // Shared resolver -- see domain/actorDisplayName.js. Previously fell back to the raw warehouse
  // document id, printing an opaque key where a business name belongs.
  const warehouseName = (id) => resolveWarehouseIdentity(id, { warehouses }).name;
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
      {reconciliationReport.status === "CANNOT_EVALUATE" ? (
        // M15: a structurally-unrunnable check must never render as a clean result. The
        // ledger records what was consumed, not which warehouse it came from, so it cannot
        // be checked against this warehouse's bin-level stock -- this is not "no
        // discrepancies found," it is "the comparison could not be made."
        <p className="fo-muted" role="status">
          Reconciliation cannot run for this warehouse right now: inventory movements aren&rsquo;t currently
          recorded per warehouse, so physical stock here can&rsquo;t be checked against it. This is not a clean
          result -- it means the check didn&rsquo;t run.
        </p>
      ) : reconciliationReport.totalDiscrepancies === 0 ? (
        <p className="fo-muted">No discrepancies between physical stock and ledger-derived expectation.</p>
      ) : (
        <>
          <p className="fo-muted">
            {(() => {
              // Counted from rows that could actually be evaluated. A row whose
              // arithmetic failed is reported as unevaluable, never as critical.
              const s = summariseReconciliation(reconciliationReport.discrepancies);
              return (
                <>
                  {s.evaluated} evaluated discrepanc{s.evaluated === 1 ? "y" : "ies"} -- {s.CRITICAL} critical,{" "}
                  {s.HIGH} high, {s.MEDIUM} medium, {s.LOW} low.
                  {s.unevaluable > 0 && ` ${s.unevaluable} row${s.unevaluable === 1 ? "" : "s"} could not be evaluated (shown below as Unknown).`}
                </>
              );
            })()}
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
                  <td>{quantityText(classifyReconciliationRow(d).expected)}</td>
                  <td>{quantityText(classifyReconciliationRow(d).actual)}</td>
                  <td>{varianceText(classifyReconciliationRow(d).variance)}</td>
                  <td>
                    {(() => {
                      const { severity } = classifyReconciliationRow(d);
                      return <StatusPill tone={inventoryUrgencyTone(severity)} label={severity} />;
                    })()}
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

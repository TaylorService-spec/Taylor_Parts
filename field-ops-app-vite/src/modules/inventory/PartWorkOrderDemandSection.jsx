import { Link } from "react-router-dom";
import { usePartWorkOrderDemand, PART_WORK_ORDER_DEMAND_STATE } from "../../hooks/usePartWorkOrderDemand";
import { buildPartWorkOrderDemand } from "../../domain/partWorkOrderDemand";

// Part -> Work Order Demand (Wave 7 Item 3). Answers "Which Work Orders need this part?" on the Part
// detail surface -- a READ/PROJECTION over the existing fieldops_wos authority (see
// hooks/usePartWorkOrderDemand.js for the query strategy and domain/partWorkOrderDemand.js for the pure
// derivation). This card creates no second demand engine, no planned-quantity duplicate, and no editable
// record: every quantity shown traces directly to the Work Order's own inventorySnapshot, and anything
// this projection cannot confirm is shown as "—" (unknown), never a fabricated zero.
function formatScheduled(ts) {
  if (ts && typeof ts.toDate === "function") return ts.toDate().toLocaleDateString();
  return "—";
}

function formatQty(n) {
  return typeof n === "number" ? n : <span className="fo-muted">Unknown</span>;
}

export default function PartWorkOrderDemandSection({ partId }) {
  const demandRead = usePartWorkOrderDemand(partId);

  return (
    <div className="fo-card">
      <h3>Work Order Demand</h3>

      {demandRead.status === PART_WORK_ORDER_DEMAND_STATE.LOADING && (
        <p className="fo-muted">Loading Work Order demand…</p>
      )}

      {demandRead.status === PART_WORK_ORDER_DEMAND_STATE.DENIED && (
        <p className="fo-muted">You don't have access to Work Order demand for this part.</p>
      )}

      {demandRead.status === PART_WORK_ORDER_DEMAND_STATE.UNAVAILABLE && (
        <p className="fo-muted" role="alert">
          Work Order demand is temporarily unavailable.
        </p>
      )}

      {demandRead.status === PART_WORK_ORDER_DEMAND_STATE.READY && (() => {
        const { rows } = buildPartWorkOrderDemand({ workOrders: demandRead.workOrders, partId });
        const { scannedCount, totalOpenWorkOrders } = demandRead;
        // Honest disclosure ONLY when we actually know the true open-WO population AND the bounded scan
        // didn't cover all of it -- never claim a total the count read didn't confirm, and never disclose
        // a gap that doesn't exist.
        const capped = typeof totalOpenWorkOrders === "number" && totalOpenWorkOrders > scannedCount;

        if (rows.length === 0) {
          return <p className="fo-muted">No open Work Order currently needs this part.</p>;
        }

        return (
          <>
            <table className="fo-table">
              <thead>
                <tr>
                  <th>Work Order</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Scheduled</th>
                  <th>Planned</th>
                  <th>Used</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.workOrderId}>
                    <td>
                      <Link to={`/service/work-orders/${r.workOrderId}`}>{r.woNumber ?? r.workOrderId}</Link>
                    </td>
                    <td>{r.status ?? <span className="fo-muted">Unknown</span>}</td>
                    <td className="fo-muted">{r.customerId ?? "—"}</td>
                    <td className="fo-muted">{formatScheduled(r.scheduledStart)}</td>
                    <td>{formatQty(r.qtyPlanned)}</td>
                    <td>{formatQty(r.qtyUsed)}</td>
                    <td>{formatQty(r.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {capped && (
              <p className="fo-muted">
                Showing the most recent {scannedCount} of {totalOpenWorkOrders} open Work Orders. An older
                open Work Order needing this part may not appear above.
              </p>
            )}
          </>
        );
      })()}
    </div>
  );
}

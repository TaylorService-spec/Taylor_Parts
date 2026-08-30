import { useMemo } from "react";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { Link } from "react-router-dom";
import { usePartWorkOrderDemand, PART_WORK_ORDER_DEMAND_STATE } from "../../hooks/usePartWorkOrderDemand";
import { buildPartWorkOrderDemand } from "../../domain/partWorkOrderDemand";
import { useAccountReferenceResolver } from "../../hooks/useAccountReferenceResolver.js";
import { normalizeReferenceResult } from "../../metadata/referenceResolution.js";

// Part -> Work Order Demand (Wave 7 Item 3). Answers "Which Work Orders need this part?" on the Part
// detail surface -- a READ/PROJECTION over the existing fieldops_wos authority (see
// hooks/usePartWorkOrderDemand.js for the query strategy and domain/partWorkOrderDemand.js for the pure
// derivation). This card creates no second demand engine, no planned-quantity duplicate, and no editable
// record: every quantity shown traces directly to the Work Order's own inventorySnapshot, and anything
// this projection cannot confirm is shown as "—" (unknown), never a fabricated zero.
//
// THE CUSTOMER IS NAMED, NOT KEYED. This column rendered `r.customerId` directly -- a Firestore
// document id shown as content, the same defect the Sales Order surfaces carried. The projection
// deliberately does not denormalize a customer name (it is a read over fieldops_wos, not a CRM
// join), so the name is resolved through the SHARED account resolver: one batched read for the
// whole table, and the same reference states every other surface uses.
//
// A reference that cannot be resolved shows WHY -- "Not available to your role" is not the same
// fact as "No longer exists", and neither is an excuse to fall back to printing the id.
/** Stable identity, so an empty table does not re-trigger the resolver every render. */
const EMPTY_ROWS = [];

function formatScheduled(ts) {
  if (ts && typeof ts.toDate === "function") return ts.toDate().toLocaleDateString();
  return "—";
}

function formatQty(n) {
  return typeof n === "number" ? n : <span className="fo-muted">Unknown</span>;
}

export default function PartWorkOrderDemandSection({ partId }) {
  const demandRead = usePartWorkOrderDemand(partId);

  // Hoisted out of the render branch below so the account resolver can see the ids BEFORE the
  // table renders -- one batched read for the whole table rather than one per row.
  const rows = useMemo(
    () => (demandRead.status === PART_WORK_ORDER_DEMAND_STATE.READY
      ? buildPartWorkOrderDemand({ workOrders: demandRead.workOrders, partId }).rows
      : EMPTY_ROWS),
    [demandRead.status, demandRead.workOrders, partId],
  );
  const { resolveReference } = useAccountReferenceResolver(rows);

  // Never the id, in any branch. A name when we have one, otherwise the honest reason.
  const customerLabel = (customerId) => {
    if (!customerId) return "—";
    return normalizeReferenceResult(resolveReference("customerId", customerId)).label;
  };

  return (
    // PARTS NORTH STAR P1. The shared record-section grammar, and the design's own heading --
    // "Open demand", with the sentence that keeps it from being read as a reservation riding
    // beside the title rather than under the table, where it can be scrolled away from the
    // numbers it qualifies.
    <RuledSection
      title="Open demand"
      meta="Work orders that plan this part — planned demand, never a reservation."
    >

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
                    <td className="fo-muted">{customerLabel(r.customerId)}</td>
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
    </RuledSection>
  );
}

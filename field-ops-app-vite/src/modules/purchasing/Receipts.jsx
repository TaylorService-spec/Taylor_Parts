import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useReorderRequestsByStatuses } from "../../hooks/useReorderRequests";
import { usePurchaseOrdersByIds } from "../../hooks/usePurchaseOrdersByIds";
import { buildPurchaseOrdersView, PURCHASE_ORDERS_STATUS } from "../../domain/purchaseOrdersView";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// Purchasing > Receipts -- NOT a separate capability. It is the received/result side of the ONE
// governed Receiving capability, rendered as a reuse-only LAUNCH POINT into the CANONICAL purchase-
// order projection (buildPurchaseOrdersView -- the same view-model Purchase Orders and the Receiving
// workspace use), scoped to RECEIVED. See DECISIONS: Receipts is a launch point, not a second
// implementation, and does not introduce a new interpretation of the receive event.
//
// What it can and cannot show: the client-visible receipt record is the RECEIVED purchase order
// (reorder_requests closed out to RECEIVED). The GOVERNED stock-receipt records written by the
// receiveInventoryStock service (receiving_orders + the operational-movement ledger) are
// backend-only (firestore.rules deny all client access), so they are NOT read here -- the workspace
// says so plainly rather than implying it shows the governed receipt ledger. Read-only; no write
// path; admin/dispatcher (matching the reorder_requests/reorder_purchase_orders read rules).
const RECEIVED_ONLY = [REORDER_REQUEST_STATUS.RECEIVED];

export default function Receipts() {
  const requestsRead = useReorderRequestsByStatuses(RECEIVED_ONLY);
  const ids = useMemo(() => requestsRead.data.map((r) => r.id), [requestsRead.data]);
  const purchaseOrdersRead = usePurchaseOrdersByIds(ids);
  const view = useMemo(
    () => buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead }),
    [requestsRead, purchaseOrdersRead]
  );

  const intro = (
    <p className="fo-muted">
      Purchase orders that have been received. This is the received side of{" "}
      <Link to="/inventory/receiving">Receiving</Link> — governed stock receipts are recorded by the
      receiving service and aren't listed here.
    </p>
  );

  if (view.status === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION || view.status === PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE) {
    const code = view.status === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION ? "permission-denied" : "unavailable";
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Receipts" />
        {intro}
        <FailureState title="Receipts unavailable" message={loadErrorMessage({ code }, { entity: "receipts" })} />
      </div>
    );
  }
  // The view-model owns the load ladder: it reports LOADING while EITHER read is in flight
  // (purchaseOrdersView.js), so a single status check suffices (matches PurchaseOrders.jsx).
  if (view.status === PURCHASE_ORDERS_STATUS.LOADING) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Receipts" />
        {intro}
        <LoadingState>Loading receipts…</LoadingState>
      </div>
    );
  }

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Receipts" />
      {intro}
      {view.summary.received > 0 && (
        <p className="fo-muted" role="status">
          {view.summary.received} received purchase order{view.summary.received === 1 ? "" : "s"}.
        </p>
      )}
      {view.rows.length === 0 ? (
        <EmptyState
          variant="database"
          title="No receipts yet"
          message="Received purchase orders will appear here once a purchase order is received."
          guidance="A receipt is the record that ordered stock actually arrived. A purchase order only appears on this screen after it has been received, so this list stays empty until the first receipt is recorded."
        />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Receipts">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Supplier</th>
                <th scope="col">PO #</th>
                <th scope="col" className="fo-po-qty">Qty</th>
                <th scope="col">Ordered</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.reorderRequestId}>
                  <td>{row.partId ? <Link to={`/inventory/${row.partId}?requestId=${row.reorderRequestId}`}>{row.partId}</Link> : <span className="fo-muted">—</span>}</td>
                  <td>{row.supplierName ?? <span className="fo-muted">—</span>}</td>
                  <td>{row.externalPoNumber ?? <span className="fo-muted">—</span>}</td>
                  <td className="fo-po-qty">{row.orderedQuantity ?? <span className="fo-muted">—</span>}</td>
                  <td>{row.orderedDate ?? <span className="fo-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

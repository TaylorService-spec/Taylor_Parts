import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useReorderRequestsByStatuses } from "../../hooks/useReorderRequests";
import { usePurchaseOrdersByIds } from "../../hooks/usePurchaseOrdersByIds";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { resolveActorDisplayName } from "../../domain/actorDisplayName";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import {
  buildPurchaseOrdersView,
  PURCHASE_ORDERS_STATUS,
  PURCHASE_ORDER_VIEW_STATUS,
} from "../../domain/purchaseOrdersView";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// Purchasing > Purchase Orders (item C). The first cross-request view of the
// active `reorder_purchase_orders` (until now these were only visible one-at-a-
// time inside PartDetail). It is the Purchasing area's index surface.
//
// READ-ONLY by design. It composes the ALREADY-client-direct `reorder_requests`
// + `reorder_purchase_orders` reads via the pure purchaseOrdersView view-model.
// It records nothing, calls no Cloud Function, and never reads `receiving_orders`
// (backend-only). The sole writers of reorder POs remain
// domain/reorderPurchaseOrders.js (recordPurchaseOrder/voidPurchaseOrder).
//
// Its point in the platform: surface the ORDERED/ORDERED "receipt candidates"
// that the now-live receiveInventoryStock callable can receive against -- WITHOUT
// itself performing a receipt. Actually receiving stock is a separate, authorized
// operator action (a receipt mutates production inventory and requires the
// inventory.stock.receive capability); this surface only shows the exact source
// descriptor an operator would use.

// The three statuses a reorder Purchase Order can be observed under. Module-level
// constant so the hook's `statuses.join(",")` dep key is stable across renders.
const PO_REQUEST_STATUSES = [
  REORDER_REQUEST_STATUS.ORDERED,
  REORDER_REQUEST_STATUS.RECEIVED,
  REORDER_REQUEST_STATUS.VOIDED,
];

// "Needs attention" (ORPHAN) is a real, first-class integrity state -- an ORDERED
// request whose PO record couldn't be read. The whole point of the view-model's
// ladder is to SURFACE it, so it earns its own filter, but only when at least one
// exists (an always-empty filter would be noise on the common, healthy case).
const FILTERS = [
  { key: "open", label: "Open", viewStatus: PURCHASE_ORDER_VIEW_STATUS.OPEN },
  { key: "received", label: "Received", viewStatus: PURCHASE_ORDER_VIEW_STATUS.RECEIVED },
  { key: "voided", label: "Voided", viewStatus: PURCHASE_ORDER_VIEW_STATUS.VOIDED },
  { key: "attention", label: "Needs attention", viewStatus: PURCHASE_ORDER_VIEW_STATUS.ORPHAN },
  { key: "all", label: "All", viewStatus: null },
];

const STATUS_LABEL = {
  [PURCHASE_ORDER_VIEW_STATUS.OPEN]: "Open",
  [PURCHASE_ORDER_VIEW_STATUS.RECEIVED]: "Received",
  [PURCHASE_ORDER_VIEW_STATUS.VOIDED]: "Voided",
  [PURCHASE_ORDER_VIEW_STATUS.ORPHAN]: "Needs attention",
};

export default function PurchaseOrders() {
  const requestsRead = useReorderRequestsByStatuses(PO_REQUEST_STATUSES);
  const ids = useMemo(() => requestsRead.data.map((r) => r.id), [requestsRead.data]);
  const { purchaseOrdersById, loading: poLoading } = usePurchaseOrdersByIds(ids);
  const { byUserId } = useEmployeeDirectory();
  const [filterKey, setFilterKey] = useState("open");

  const view = useMemo(
    () => buildPurchaseOrdersView({ requestsRead, purchaseOrdersById }),
    [requestsRead, purchaseOrdersById]
  );

  const intro = (
    <p className="fo-muted">
      Purchase Orders recorded when a Reorder Request is placed with a supplier. This is a
      read-only workspace. <strong>Open</strong> orders are eligible to be received against the
      live receiving service — receiving stock is a separate, authorized action.
    </p>
  );

  // Fail-closed load ladder (never render an empty list as success on a failed read).
  if (view.status === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION || view.status === PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE) {
    const code = view.status === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION ? "permission-denied" : "unavailable";
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Purchase Orders" />
        {intro}
        <FailureState title="Purchase Orders unavailable" message={loadErrorMessage({ code }, { entity: "purchase orders" })} />
      </div>
    );
  }
  // Show Loading only until the FIRST rows exist. Once requests have rendered
  // (even briefly as ORPHAN before PO docs resolve), a later poLoading refetch
  // (e.g. the id set changed) streams updated rows in place rather than flashing
  // the whole surface back to a loading state -- deliberate flicker avoidance.
  if (view.status === PURCHASE_ORDERS_STATUS.LOADING || (poLoading && view.rows.length === 0)) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Purchase Orders" />
        {intro}
        <LoadingState>Loading purchase orders…</LoadingState>
      </div>
    );
  }

  const activeFilter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const visibleRows = activeFilter.viewStatus
    ? view.rows.filter((r) => r.viewStatus === activeFilter.viewStatus)
    : view.rows;

  const filterOptions = FILTERS
    // The "Needs attention" filter appears only when there is at least one ORPHAN.
    .filter((f) => f.key !== "attention" || view.summary.orphan > 0)
    .map((f) => ({
      key: f.key,
      label: f.label,
      count: f.viewStatus ? view.rows.filter((r) => r.viewStatus === f.viewStatus).length : view.rows.length,
    }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Purchase Orders" />
      {intro}
      {view.summary.receiptCandidates > 0 && (
        <p className="fo-muted" role="status">
          {view.summary.receiptCandidates} open purchase order
          {view.summary.receiptCandidates === 1 ? "" : "s"} eligible for receiving.
        </p>
      )}
      <FilterBar options={filterOptions} activeKey={filterKey} onChange={setFilterKey} />

      {view.rows.length === 0 ? (
        <EmptyState
          variant="database"
          title="No purchase orders yet"
          message="A purchase order appears here once a Reorder Request is placed with a supplier."
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState variant="filtered" title="No matching purchase orders" message="No purchase orders match this filter." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table" aria-label="Purchase orders">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Supplier</th>
                <th scope="col">PO #</th>
                <th scope="col" className="fo-po-qty">Qty</th>
                <th scope="col">Ordered</th>
                <th scope="col">Expected</th>
                <th scope="col">Ordered by</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.reorderRequestId}>
                  <td>
                    {row.partId ? (
                      <Link to={`/inventory/${row.partId}?requestId=${row.reorderRequestId}`}>{row.partId}</Link>
                    ) : (
                      <span className="fo-muted">—</span>
                    )}
                  </td>
                  <td>{row.supplierName ?? <span className="fo-muted">—</span>}</td>
                  <td>{row.externalPoNumber ?? <span className="fo-muted">—</span>}</td>
                  <td className="fo-po-qty">{row.orderedQuantity ?? <span className="fo-muted">—</span>}</td>
                  <td>{row.orderedDate ?? <span className="fo-muted">—</span>}</td>
                  <td>{row.expectedArrivalDate ?? <span className="fo-muted">—</span>}</td>
                  <td>{row.orderedByUserId ? resolveActorDisplayName(row.orderedByUserId, byUserId) : <span className="fo-muted">—</span>}</td>
                  <td>
                    <span className={`fo-po-status fo-po-status--${row.viewStatus.toLowerCase()}`}>
                      {STATUS_LABEL[row.viewStatus] ?? row.viewStatus}
                    </span>
                    {row.isReceiptCandidate && row.receiptSource && (
                      <details className="fo-po-receipt">
                        <summary>Receipt source</summary>
                        <p className="fo-muted fo-po-receipt-note">
                          Eligible for receiving via the receiving service. Receiving is a separate,
                          authorized action.
                        </p>
                        <dl className="fo-po-receipt-desc">
                          <div>
                            <dt>Reorder Request ID</dt>
                            <dd><code>{row.receiptSource.reorderRequestId}</code></dd>
                          </div>
                          <div>
                            <dt>Purchase Order ID</dt>
                            <dd><code>{row.receiptSource.purchaseOrderId}</code></dd>
                          </div>
                        </dl>
                      </details>
                    )}
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

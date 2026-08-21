// Epic 5 Procurement -- pure renderer. Draft proposals are exactly
// that: proposals. There is no "approve"/"create PO" button here --
// turning one into a real PurchaseOrder requires a human-triggered
// Cloud Function call outside this dashboard's scope (see
// procurementDraftEngine.ts's header comment).
//
// site-work r4 item A: `purchaseOrders` rows come from the LIVE
// `reorder_purchase_orders` collection now (services/operationsQueries.ts's
// fetchProcurementPurchaseOrders(), built from the same pure
// domain/purchaseOrdersView.js used by Purchasing > Purchase Orders), not the
// dormant Epic-5 `purchase_orders` collection this panel used to read -- so the
// row shape mirrors that view-model's output (reorderRequestId/partId/
// supplierName/externalPoNumber/orderedQuantity/orderedDate/expectedArrivalDate/
// viewStatus), not the old supplierId/items/totalCost shape.
import { inventoryUrgencyTone } from "../../../domain/inventoryUrgencyTone";
import StatusPill from "../../../shared/ui/StatusPill.jsx";
import { resolveSupplierIdentity } from "../../../domain/actorDisplayName";

export default function ProcurementPanel({ purchaseOrders, suppliers, procurementDrafts, resolveName }) {
  // Shared resolver -- see domain/actorDisplayName.js. Previously fell back to the raw supplier
  // document id, printing an opaque key where a business name belongs.
  const supplierName = (id) => resolveSupplierIdentity(id, { suppliers }).name;

  return (
    <div className="fo-card">
      <h3>Procurement</h3>

      <h4>Purchase Orders</h4>
      {purchaseOrders.length === 0 ? (
        <p className="fo-muted">No purchase orders yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Supplier</th>
              <th>PO #</th>
              <th>Qty</th>
              <th>Ordered</th>
              <th>Expected</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.reorderRequestId}>
                <td>{po.partId ? resolveName(po.partId) : <span className="fo-muted">—</span>}</td>
                <td>{po.supplierName ?? <span className="fo-muted">—</span>}</td>
                <td>{po.externalPoNumber ?? <span className="fo-muted">—</span>}</td>
                <td>{po.orderedQuantity ?? <span className="fo-muted">—</span>}</td>
                <td>{po.orderedDate ?? <span className="fo-muted">—</span>}</td>
                <td>{po.expectedArrivalDate ?? <span className="fo-muted">—</span>}</td>
                <td>{po.viewStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Draft Proposals</h4>
      <p className="fo-muted">Generated from Epic 3 reorder recommendations -- proposals only, nothing here is a real order.</p>
      {procurementDrafts.length === 0 ? (
        <p className="fo-muted">No draft proposals -- nothing currently needs reordering.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Recommended Qty</th>
              <th>Urgency</th>
              <th>Suggested Supplier</th>
              <th>Est. Unit Price</th>
              <th>Est. Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {procurementDrafts.map((draft) => (
              <tr key={draft.partId}>
                <td>{resolveName(draft.partId)}</td>
                <td>{draft.recommendedQuantity}</td>
                <td>
                  <StatusPill tone={inventoryUrgencyTone(draft.urgency)} label={draft.urgency} />
                </td>
                <td>{draft.suggestedSupplierId ? supplierName(draft.suggestedSupplierId) : "No supplier available"}</td>
                <td>{draft.estimatedUnitPrice != null ? `$${draft.estimatedUnitPrice.toFixed(2)}` : "—"}</td>
                <td>{draft.estimatedTotalCost != null ? `$${draft.estimatedTotalCost.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

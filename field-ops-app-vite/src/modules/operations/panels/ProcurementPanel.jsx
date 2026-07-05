import { getCatalogItem } from "../../../data/partsCatalog";

// Epic 5 Procurement -- pure renderer. Draft proposals are exactly
// that: proposals. There is no "approve"/"create PO" button here --
// turning one into a real PurchaseOrder requires a human-triggered
// Cloud Function call outside this dashboard's scope (see
// procurementDraftEngine.ts's header comment).
export default function ProcurementPanel({ purchaseOrders, suppliers, procurementDrafts }) {
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name ?? id;

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
              <th>Supplier</th>
              <th>Status</th>
              <th>Line Items</th>
              <th>Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id}>
                <td>{supplierName(po.supplierId)}</td>
                <td>{po.status}</td>
                <td>{po.items.length}</td>
                <td>${po.totalCost.toFixed(2)}</td>
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
                <td>{getCatalogItem(draft.partId)?.name ?? draft.partId}</td>
                <td>{draft.recommendedQuantity}</td>
                <td>
                  <span className={`fo-badge fo-badge-${draft.urgency.toLowerCase()}`}>{draft.urgency}</span>
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

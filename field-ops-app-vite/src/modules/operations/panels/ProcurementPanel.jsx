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
import { PURCHASE_ORDER_VIEW_STATUS } from "../../../domain/purchaseOrdersView";
import { statusLabel } from "../../../shared/display/displayLabels.js";
import { useMemo } from "react";
import SortableHeader from "../../../shared/ui/sorting/SortableHeader.jsx";
import { useTableSort } from "../../../shared/ui/sorting/useTableSort.js";

// The same words Purchasing > Purchase Orders uses for the view-model's status ladder (item A: never the raw enum).
const PO_STATUS_WORDS = {
  [PURCHASE_ORDER_VIEW_STATUS.OPEN]: "Open",
  [PURCHASE_ORDER_VIEW_STATUS.RECEIVED]: "Received",
  [PURCHASE_ORDER_VIEW_STATUS.VOIDED]: "Voided",
  [PURCHASE_ORDER_VIEW_STATUS.ORPHAN]: "Needs Attention",
};
const URGENCY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export default function ProcurementPanel({ purchaseOrders, purchaseOrdersFailure = null, suppliers, procurementDrafts, resolveName, ledgerIntegrity = null }) {
  // DQ-027: draft proposals are derived from the ledger. Parts whose ledger cannot be read have NO
  // proposal either way -- that is said, so "no proposals" never stands in for "not assessed".
  const incompleteParts = ledgerIntegrity?.unavailablePartIds?.length ?? 0;
  const ledgerUnavailable = ledgerIntegrity?.state === "UNAVAILABLE";
  // Shared resolver -- see domain/actorDisplayName.js. Previously fell back to the raw supplier
  // document id, printing an opaque key where a business name belongs.
  const supplierName = (id) => resolveSupplierIdentity(id, { suppliers }).name;

  // Client-side sort over the rows the dashboard already loaded (item C); the given order is the default.
  const poSortColumns = useMemo(() => ({
    part: { value: (po) => (po.partId ? resolveName(po.partId) : null) },
    supplier: { value: (po) => po.supplierName },
    poNumber: { value: (po) => po.externalPoNumber },
    quantity: { value: (po) => (typeof po.orderedQuantity === "number" ? po.orderedQuantity : null) },
    ordered: { value: (po) => po.orderedDate },
    expected: { value: (po) => po.expectedArrivalDate },
    status: { value: (po) => statusLabel(po.viewStatus, PO_STATUS_WORDS) },
  }), [resolveName]);
  const draftSortColumns = useMemo(() => ({
    part: { value: (d) => resolveName(d.partId) },
    recommended: { value: (d) => d.recommendedQuantity },
    urgency: { value: (d) => URGENCY_ORDER[d.urgency] ?? 99 },
    supplier: { value: (d) => (d.suggestedSupplierId ? resolveSupplierIdentity(d.suggestedSupplierId, { suppliers }).name : null) },
    unitPrice: { value: (d) => d.estimatedUnitPrice },
    totalCost: { value: (d) => d.estimatedTotalCost },
  }), [resolveName, suppliers]);
  const poSort = useTableSort({ rows: purchaseOrders, columns: poSortColumns });
  const draftSort = useTableSort({ rows: procurementDrafts, columns: draftSortColumns });

  return (
    <div className="fo-card">
      <h3>Procurement</h3>

      <h4>Purchase Orders</h4>
      {purchaseOrdersFailure ? (
        <p className="fo-warning" role="alert" data-purchase-orders-unavailable>
          Purchase orders aren't available: {purchaseOrdersFailure.message ?? "the Reorder queue could not be read"}
        </p>
      ) : purchaseOrders.length === 0 ? (
        <p className="fo-muted">No purchase orders yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="part" label="Part" sort={poSort.sort} onSort={poSort.toggle} />
              <SortableHeader columnKey="supplier" label="Supplier" sort={poSort.sort} onSort={poSort.toggle} />
              <SortableHeader columnKey="poNumber" label="PO #" sort={poSort.sort} onSort={poSort.toggle} />
              <SortableHeader columnKey="quantity" label="Qty" sort={poSort.sort} onSort={poSort.toggle} />
              <SortableHeader columnKey="ordered" label="Ordered" sort={poSort.sort} onSort={poSort.toggle} />
              <SortableHeader columnKey="expected" label="Expected" sort={poSort.sort} onSort={poSort.toggle} />
              <SortableHeader columnKey="status" label="Status" sort={poSort.sort} onSort={poSort.toggle} />
            </tr>
          </thead>
          <tbody>
            {poSort.sorted.map((po) => (
              <tr key={po.reorderRequestId}>
                <td>{po.partId ? resolveName(po.partId) : <span className="fo-muted">—</span>}</td>
                <td>{po.supplierName ?? <span className="fo-muted">—</span>}</td>
                <td>{po.externalPoNumber ?? <span className="fo-muted">—</span>}</td>
                <td>{po.orderedQuantity ?? <span className="fo-muted">—</span>}</td>
                <td>{po.orderedDate ?? <span className="fo-muted">—</span>}</td>
                <td>{po.expectedArrivalDate ?? <span className="fo-muted">—</span>}</td>
                <td>{statusLabel(po.viewStatus, PO_STATUS_WORDS)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Draft Proposals</h4>
      <p className="fo-muted">Generated from Epic 3 reorder recommendations -- proposals only, nothing here is a real order.</p>
      {ledgerUnavailable ? (
        <p className="fo-warning" role="status">Draft proposals are unavailable: a ledger record cannot be read or attributed to a part.</p>
      ) : incompleteParts > 0 ? (
        <p className="fo-warning" role="status">
          Incomplete: {incompleteParts} part{incompleteParts === 1 ? " was" : "s were"} not assessed because a ledger record cannot be read.
        </p>
      ) : null}
      {ledgerUnavailable ? null : procurementDrafts.length === 0 ? (
        <p className="fo-muted">{incompleteParts > 0 ? "No draft proposals among the parts that could be assessed." : "No draft proposals -- nothing currently needs reordering."}</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="part" label="Part" sort={draftSort.sort} onSort={draftSort.toggle} />
              <SortableHeader columnKey="recommended" label="Recommended Qty" sort={draftSort.sort} onSort={draftSort.toggle} />
              <SortableHeader columnKey="urgency" label="Urgency" sort={draftSort.sort} onSort={draftSort.toggle} />
              <SortableHeader columnKey="supplier" label="Suggested Supplier" sort={draftSort.sort} onSort={draftSort.toggle} />
              <SortableHeader columnKey="unitPrice" label="Est. Unit Price" sort={draftSort.sort} onSort={draftSort.toggle} />
              <SortableHeader columnKey="totalCost" label="Est. Total Cost" sort={draftSort.sort} onSort={draftSort.toggle} />
            </tr>
          </thead>
          <tbody>
            {draftSort.sorted.map((draft) => (
              <tr key={draft.partId}>
                <td>{resolveName(draft.partId)}</td>
                <td>{draft.recommendedQuantity}</td>
                <td>
                  <StatusPill tone={inventoryUrgencyTone(draft.urgency)} label={statusLabel(draft.urgency)} />
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

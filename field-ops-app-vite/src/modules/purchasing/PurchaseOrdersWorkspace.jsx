import { useState } from "react";
import { SUPPLIER_PURCHASE_ORDER_GATE } from "../../access/shellCapabilityGates.js";
import FilterBar from "../../shared/ui/FilterBar";
import PurchaseOrders from "./PurchaseOrders.jsx";
import SupplierPurchaseOrders from "./SupplierPurchaseOrders.jsx";

// Purchasing > Purchase Orders: the two purchase order authorities, side by side and never mixed (DECISIONS #P-1).
//
//   Recorded orders           the Reorder purchase orders a buyer RECORDS after placing an order elsewhere, one Part each (PurchaseOrders.jsx).
//   Supplier purchase orders  the multi-line orders a buyer RAISES here, approves and sends (SupplierPurchaseOrders.jsx).
//
// The second view is offered ONLY to a holder of supplier.purchaseOrder.read; everyone else sees the page exactly as it was, with no switcher and
// no hint of a view they cannot open. The capability answer is the shell's (App.jsx); each view's commands re-decide on the server.
const VIEWS = [
  { key: "recorded", label: "Recorded orders" },
  { key: "supplier", label: "Supplier purchase orders" },
];

export default function PurchaseOrdersWorkspace({ hasCapability, client }) {
  const [view, setView] = useState("recorded");
  const canSeeSupplierOrders = typeof hasCapability === "function" && hasCapability(SUPPLIER_PURCHASE_ORDER_GATE.read) === true;
  if (!canSeeSupplierOrders) return <PurchaseOrders />;
  // A holder of supplier.purchaseOrder.read WITHOUT reorder.purchaseOrder.read (the buyers and approvers) sees the supplier view alone: no switcher, no recorded list.
  if (hasCapability(SUPPLIER_PURCHASE_ORDER_GATE.recordedRead) !== true) return <SupplierPurchaseOrders hasCapability={hasCapability} client={client} />;
  return (
    <>
      <FilterBar options={VIEWS} activeKey={view} onChange={setView} label="Purchase order views" variant="chips" />
      {view === "supplier" ? <SupplierPurchaseOrders hasCapability={hasCapability} client={client} /> : <PurchaseOrders />}
    </>
  );
}

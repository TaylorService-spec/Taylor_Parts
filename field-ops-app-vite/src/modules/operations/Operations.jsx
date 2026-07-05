import { useEffect, useState } from "react";
import { getCatalogItem, PARTS_CATALOG } from "../../data/partsCatalog";
import {
  fetchInventoryTransactions,
  fetchStockLocations,
  fetchWarehouses,
  fetchTransferOrders,
  fetchSuppliers,
  fetchSupplierCatalog,
  fetchPurchaseOrders,
} from "../../services/operationsQueries";
import {
  normalizeLedgerTransaction,
  generateInventoryHealthDashboard,
} from "../../domain/inventoryAnalyticsEngine";
import {
  detectStockDiscrepancies,
  generateReconciliationReport,
} from "../../domain/warehouseReconciliationEngine";
import { generateProcurementDrafts } from "../../domain/procurementDraftEngine";
import InventoryHealthPanel from "./panels/InventoryHealthPanel";
import WarehousePanel from "./panels/WarehousePanel";
import ProcurementPanel from "./panels/ProcurementPanel";

// ROLE DEFINITION (load-bearing, don't blur this):
// Operations is a READ-ONLY EXECUTIVE / MONITORING layer over Epics
// 2D/3/4/5 (ledger, analytics, warehouse, procurement) -- it answers
// "what does the business's inventory/warehouse/procurement picture
// look like," nothing else. It is explicitly NOT a second dispatcher
// tool and must never become one:
//   - modules/dispatch/Dispatch.jsx (soon domains/execution/
//     ExecutionWorkspace.jsx) remains the ONLY place a human assigns a
//     job to a technician -- Operations has no job/technician
//     assignment UI and must never grow one.
//   - modules/controlTower/ControlTower.jsx remains the dispatcher's
//     real-time operational intelligence view (at-risk jobs, overload,
//     activity timeline) -- Operations does not duplicate or compete
//     with it; Operations' scope is inventory/warehouse/procurement
//     reporting only, never job/technician/work-order risk signals.
// Concretely: this module has no "assign," "dispatch," or "act on
// this job" affordance anywhere, and never will -- only tables and
// read-only reconciliation/forecast output. See docs/CLAUDE_CONTEXT.md's
// rule on Control Tower/Dispatcher Workspace overlap for why a third
// competing operational view is exactly the fragmentation risk this
// module must not repeat.
//
// Epics 2D/3/4/5 (ledger, analytics, warehouse, procurement) are all
// backend-only Cloud Functions modules with no prior UI -- this is the
// first read-only reporting surface over them. One-shot reads only (no
// onSnapshot), same precedent as firebase/collectionStore.js's list().
// This module NEVER writes -- firestore.rules denies all client writes
// to every collection read here, unconditionally; there is no "action"
// button anywhere in this screen that calls a Cloud Function.
//
// available stock per part = warehouseQty (data/partsCatalog.ts's
// static baseline) - (grossReserved - released), same formula as
// functions/src/inventoryService.ts's getAvailableQuantity -- CONSUMED
// is deliberately not subtracted again (see that file's comment).
function computeAvailableStockByPart(transactions) {
  const byPart = new Map();
  for (const t of transactions) {
    const entry = byPart.get(t.partId) ?? { reserved: 0, released: 0 };
    if (t.type === "RESERVED") entry.reserved += t.quantity;
    else if (t.type === "RELEASED") entry.released += t.quantity;
    byPart.set(t.partId, entry);
  }

  const result = new Map();
  for (const [partId, { reserved, released }] of byPart) {
    const warehouseQty = getCatalogItem(partId)?.warehouseQty ?? 0;
    result.set(partId, warehouseQty - (reserved - released));
  }
  return result;
}

export default function Operations() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchInventoryTransactions(),
      fetchStockLocations(),
      fetchWarehouses(),
      fetchTransferOrders(),
      fetchSuppliers(),
      fetchSupplierCatalog(),
      fetchPurchaseOrders(),
    ])
      .then(([rawTransactions, stockLocations, warehouses, transferOrders, suppliers, supplierCatalog, purchaseOrders]) => {
        if (cancelled) return;

        const transactions = rawTransactions.map(normalizeLedgerTransaction);
        const consumedTransactions = transactions.filter((t) => t.type === "CONSUMED");
        const availableByPart = computeAvailableStockByPart(transactions);

        const stockSnapshots = [...availableByPart.entries()].map(([partId, availableStock]) => ({
          partId,
          availableStock,
        }));

        const healthEntries = generateInventoryHealthDashboard(transactions, stockSnapshots);

        const discrepancies = detectStockDiscrepancies({
          warehouseStock: stockLocations,
          ledgerConsumption: consumedTransactions,
        });
        const reconciliationReport = generateReconciliationReport(discrepancies);

        const procurementRecommendations = healthEntries
          .filter((entry) => entry.recommendation.recommendedOrderQty > 0)
          .map((entry) => ({
            partId: entry.partId,
            recommendedQuantity: Math.ceil(entry.recommendation.recommendedOrderQty),
            urgency: entry.recommendation.urgency,
            source: "EPIC3_ANALYTICS",
          }));
        const procurementDrafts = generateProcurementDrafts(procurementRecommendations, supplierCatalog);

        setState({
          loading: false,
          error: null,
          data: {
            healthEntries,
            warehouses,
            stockLocations,
            transferOrders,
            reconciliationReport,
            purchaseOrders,
            suppliers,
            procurementDrafts,
          },
        });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err, data: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="fo-panel">
        <h2>Operations</h2>
        <p className="fo-muted">Loading inventory, warehouse, and procurement data...</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="fo-panel">
        <h2>Operations</h2>
        <p className="fo-muted">Failed to load: {state.error.message}</p>
      </div>
    );
  }

  const { healthEntries, warehouses, stockLocations, transferOrders, reconciliationReport, purchaseOrders, suppliers, procurementDrafts } =
    state.data;

  return (
    <div className="fo-panel">
      <h2>Operations</h2>
      <p className="fo-muted">
        Read-only reporting over the inventory ledger (Epic 2D), analytics engine (Epic 3), warehouse system
        (Epic 4), and procurement system (Epic 5). Nothing on this screen writes anywhere -- catalog data ({PARTS_CATALOG.length} parts) is a
        static baseline, not live stock.
      </p>
      <InventoryHealthPanel healthEntries={healthEntries} />
      <WarehousePanel
        warehouses={warehouses}
        stockLocations={stockLocations}
        transferOrders={transferOrders}
        reconciliationReport={reconciliationReport}
      />
      <ProcurementPanel purchaseOrders={purchaseOrders} suppliers={suppliers} procurementDrafts={procurementDrafts} />
    </div>
  );
}

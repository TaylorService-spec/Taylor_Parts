import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useCanonicalPartNames } from "../../hooks/useCanonicalPartNames";
import {
  fetchSuppliers,
  fetchSupplierCatalog,
  fetchProcurementPurchaseOrders,
} from "../../services/operationsQueries";
import { loadEosInventoryHealth } from "../../hooks/useInventoryLedger.js";
import { fetchInventoryWarehouseOptions } from "../../services/inventoryLocationClient.js";
import { listTransferOrderDocs } from "../../services/transferCommandClient.js";
import { generateProcurementDrafts } from "../../domain/procurementDraftEngine";
import {
  getInventoryConsumptionSnapshot,
  getTechnicianVolumeBreakdown,
} from "../../analytics/executionAnalyticsService";
import InventoryHealthPanel from "./panels/InventoryHealthPanel";
import WarehousePanel from "./panels/WarehousePanel";
import ProcurementPanel from "./panels/ProcurementPanel";
import ExecutionInsightsPanel from "./panels/ExecutionInsightsPanel";

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
// computeAvailableStockByPart now lives in domain/inventoryAnalyticsEngine.ts
// (Sprint 2.1.1) so this dashboard and the Inventory domain workspace
// (modules/inventory/PartsList.jsx/PartDetail.jsx) share one
// computation instead of each maintaining its own copy.

export default function Operations({ accessVersion } = {}) {
  const { user } = useAuth();
  // OD-3: ONE canonical part-name read for the whole dashboard, threaded as `resolveName`
  // into the panels below (never an independent read per panel). Fail-closed: on a
  // denied/unavailable/incomplete/invalid canonical read, names degrade to the raw partId
  // (never the static-catalog name); the panels' tables/calculations are unaffected.
  // accessVersion is threaded from App so a same-UID access change re-runs the read and
  // invalidates the prior name map synchronously (boundary-key guard in the hook).
  const { resolveName, namesUnavailable } = useCanonicalPartNames({ uid: user?.uid, accessVersion });
  const [state, setState] = useState({ loading: true, error: null, data: null });

  // Fail-closed access invalidation: when accessVersion changes, SYNCHRONOUSLY drop the
  // prior-scope data back to a loading state during render -- before the new reads start --
  // so previously-authorized rows can never remain visible during a slow/hung re-read (and
  // a stale completion is separately suppressed by the effect's `cancelled` guard). This is
  // the React "adjust state when a prop changes" pattern (guarded setState during render).
  const [loadedVersion, setLoadedVersion] = useState(accessVersion);
  if (loadedVersion !== accessVersion) {
    setLoadedVersion(accessVersion);
    setState({ loading: true, error: null, data: null });
  }

  useEffect(() => {
    let cancelled = false;

    // INVENTORY TRUTH IS EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): stock health from the
    // PostgreSQL on-hand / movement reads (the same loader useInventoryLedger uses), warehouses from eos_ops, transfer
    // orders from the governed EOS list. No Firebase stock dashboard remains. The PROCUREMENT panel (canonical
    // supplier POs, supplier catalog, supplier list) still reads its Firestore sources -- procurement, not inventory
    // truth, and outside this package; recorded as a remaining dependency.
    Promise.all([
      loadEosInventoryHealth(),
      fetchInventoryWarehouseOptions(),
      listTransferOrderDocs({}).then((page) => page.items),
      fetchSuppliers(),
      fetchSupplierCatalog(),
      fetchProcurementPurchaseOrders(),
      // The governed Work Order aggregates, SETTLED: a refused or unavailable aggregate is said inside the
      // Execution Insights panel, never by blanking the inventory / warehouse / procurement panels beside it.
      Promise.all([getInventoryConsumptionSnapshot(), getTechnicianVolumeBreakdown()]).then(
        ([consumption, volume]) => ({ consumption, volume, failure: null }),
        (failure) => ({ consumption: null, volume: null, failure }),
      ),
    ])
      .then(
        ([
          inventoryHealth,
          warehouses,
          transferOrderDocs,
          suppliers,
          supplierCatalog,
          purchaseOrders,
          executionInsights,
        ]) => {
        if (cancelled) return;

        // DQ-027: partition first. Unreadable rows are never silently dropped: their parts are listed as
        // unavailable, and an unattributable one makes the inventory-derived panels unavailable.
        const { healthEntries, integrity: ledgerIntegrity } = inventoryHealth;

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
            ledgerIntegrity,
            warehouses,
            transferOrderDocs,
            purchaseOrders,
            suppliers,
            procurementDrafts,
            executionInsights,
          },
        });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err, data: null });
      });

    return () => {
      cancelled = true;
    };
    // accessVersion is a dependency so a same-UID access-boundary change re-runs the
    // one-shot reads (re-scoping what this admin/dispatcher may see). The `cancelled`
    // guard suppresses a stale in-flight completion from the prior access version.
  }, [accessVersion]);

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

  const {
    healthEntries,
    ledgerIntegrity,
    warehouses,
    transferOrderDocs,
    purchaseOrders,
    suppliers,
    procurementDrafts,
    executionInsights,
  } = state.data;

  return (
    <div className="fo-panel">
      <h2>Operations</h2>
      <p className="fo-muted">
        Read-only reporting over the inventory ledger (Epic 2D), analytics engine (Epic 3), warehouse system
        (Epic 4), and procurement system (Epic 5). Nothing on this screen writes anywhere. Part names in the
        Inventory Health, Warehouse, Procurement, and Execution Insights panels are resolved from the canonical
        Parts source (fail-closed to the raw Part ID if it can't be verified); the static catalog is a static
        baseline, and all stock quantities and calculations are ledger/analytics-derived, not live stock.
      </p>
      {namesUnavailable && (
        <p className="fo-muted" role="status">Some part names are unavailable; Part IDs are shown.</p>
      )}
      <InventoryHealthPanel
        healthEntries={healthEntries}
        resolveName={resolveName}
        unavailablePartIds={ledgerIntegrity?.unavailablePartIds ?? []}
        ledgerUnavailable={ledgerIntegrity?.state === "UNAVAILABLE"}
      />
      <WarehousePanel
        warehouses={warehouses}
        transferOrderDocs={transferOrderDocs}
        resolveName={resolveName}
      />
      <ProcurementPanel purchaseOrders={purchaseOrders} suppliers={suppliers} procurementDrafts={procurementDrafts} resolveName={resolveName} ledgerIntegrity={ledgerIntegrity} />
      <ExecutionInsightsPanel
        consumptionSnapshot={executionInsights.consumption}
        technicianVolume={executionInsights.volume}
        failure={executionInsights.failure}
        resolveName={resolveName}
      />
    </div>
  );
}

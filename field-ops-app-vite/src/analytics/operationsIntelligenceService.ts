// Epic 8 -- Operations Intelligence Unification Layer. A COMPOSITE VIEW
// over three already-existing, independent read-only systems:
//   - Epic 3 domain engines (domain/inventoryAnalyticsEngine.ts,
//     warehouseReconciliationEngine.ts) -- inventory forecasting/risk
//   - Epic 7 execution analytics (analytics/executionAnalyticsService.ts)
//     -- qtyUsed normalization, technician/work-order stats
//   - services/operationsQueries.ts -- one-shot reads of the
//     inventory/warehouse/procurement collections
//
// This file does not reimplement any of the above. It only reads their
// outputs and correlates them across domains. No new Firestore writes,
// no Cloud Functions, no lifecycle changes, no schema changes -- every
// read here is getDoc/getDocs (one-shot), same precedent as the three
// systems it composes.
//
// The one exception is computeAvailableStockByPart() below, which
// mirrors the identical helper already inlined in
// modules/operations/Operations.jsx (itself mirroring
// functions/src/inventoryService.ts's getAvailableQuantity formula).
// It's duplicated here rather than imported because the source lives
// in a React component file, not a shared module -- same
// "client + server mirrors" precedent used throughout this repo
// (see inventoryAnalyticsEngine.ts's header comment) rather than a new
// pattern invented for this epic.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import { getCatalogItem } from "../data/partsCatalog";
import type { WorkOrder } from "../types/workOrder";
import {
  fetchInventoryTransactions,
  fetchPurchaseOrders,
  fetchTransferOrders,
} from "../services/operationsQueries";
import {
  normalizeLedgerTransaction,
  generateInventoryHealthDashboard,
  type LedgerTransaction,
  type RiskLevel,
  type InventoryHealthEntry,
} from "../domain/inventoryAnalyticsEngine";
import { getInventoryConsumptionSnapshot, getTechnicianVolumeBreakdown } from "./executionAnalyticsService";

const ACTIVE_WORK_ORDER_STATUSES = new Set(["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);
const HIGH_RISK_LEVELS = new Set<RiskLevel>(["HIGH", "CRITICAL"]);

// Same formula as Operations.jsx's computeAvailableStockByPart -- see
// header comment above.
function computeAvailableStockByPart(transactions: LedgerTransaction[]): Map<string, number> {
  const byPart = new Map<string, { reserved: number; released: number }>();
  for (const t of transactions) {
    const entry = byPart.get(t.partId) ?? { reserved: 0, released: 0 };
    if (t.type === "RESERVED") entry.reserved += t.quantity;
    else if (t.type === "RELEASED") entry.released += t.quantity;
    byPart.set(t.partId, entry);
  }

  const result = new Map<string, number>();
  for (const [partId, { reserved, released }] of byPart) {
    const warehouseQty = getCatalogItem(partId)?.warehouseQty ?? 0;
    result.set(partId, warehouseQty - (reserved - released));
  }
  return result;
}

// Shared by getCrossDomainBottlenecks() and getPartDemandHeatmap() --
// one ledger read + Epic 3's generateInventoryHealthDashboard(),
// composed exactly the way Operations.jsx already does it.
async function buildInventoryHealthByPart(): Promise<{
  healthByPart: Map<string, InventoryHealthEntry>;
  transactions: LedgerTransaction[];
}> {
  const rawTransactions = await fetchInventoryTransactions();
  const transactions = rawTransactions.map(normalizeLedgerTransaction);
  const availableByPart = computeAvailableStockByPart(transactions);
  const stockSnapshots = [...availableByPart.entries()].map(([partId, availableStock]) => ({ partId, availableStock }));
  const healthEntries = generateInventoryHealthDashboard(transactions, stockSnapshots);
  return { healthByPart: new Map(healthEntries.map((h) => [h.partId, h])), transactions };
}

async function fetchAllWorkOrders(): Promise<WorkOrder[]> {
  const snap = await getDocs(collection(db, WORK_ORDERS_COLLECTION));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder);
}

export interface OperationalOverview {
  totalWorkOrdersCompleted: number;
  totalInventoryConsumed: number;
  openProcurementCount: number;
  activeWarehouseTransfers: number;
}

// 1. getOperationalOverview() -- system-wide snapshot, admin/dispatcher
// only (inherits that restriction from getTechnicianVolumeBreakdown()
// and the unfiltered purchase_orders/transfer_orders reads below --
// see executionAnalyticsService.ts's header comment for why).
//
// totalWorkOrdersCompleted is derived from
// getTechnicianVolumeBreakdown()'s completedCount sums rather than a
// second full Work Order scan -- every completed Work Order already
// has assignedTechId set (Dispatch always precedes Complete in
// transitionEngine.ts), so this is exact, not an approximation.
// totalInventoryConsumed reads the ledger's CONSUMED transactions
// (Epic 3's system of record for stock movement), a separate figure
// from Epic 7's qtyUsed-based execution consumption reported elsewhere.
export async function getOperationalOverview(): Promise<OperationalOverview> {
  const [technicianVolume, rawTransactions, purchaseOrders, transferOrders] = await Promise.all([
    getTechnicianVolumeBreakdown(),
    fetchInventoryTransactions(),
    fetchPurchaseOrders(),
    fetchTransferOrders(),
  ]);

  const totalWorkOrdersCompleted = technicianVolume.reduce((sum, t) => sum + t.completedCount, 0);

  const totalInventoryConsumed = rawTransactions
    .map(normalizeLedgerTransaction)
    .filter((t) => t.type === "CONSUMED")
    .reduce((sum, t) => sum + t.quantity, 0);

  const openProcurementCount = purchaseOrders.filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED").length;

  const activeWarehouseTransfers = transferOrders.filter(
    (t) => t.status === "REQUESTED" || t.status === "IN_TRANSIT"
  ).length;

  return { totalWorkOrdersCompleted, totalInventoryConsumed, openProcurementCount, activeWarehouseTransfers };
}

export interface WorkOrderPartsBlock {
  workOrderId: string;
  woNumber: string;
  partIds: string[];
}

export interface ProcurementDelayBlock {
  partId: string;
  openPurchaseOrderIds: string[];
  blockedWorkOrderIds: string[];
}

export interface WarehouseTransferDelayBlock {
  partId: string;
  transferOrderIds: string[];
  riskLevel: RiskLevel;
}

export interface InventoryShortageBlock {
  partId: string;
  riskLevel: RiskLevel;
  activeWorkOrderCount: number;
}

export interface CrossDomainBottlenecks {
  workOrdersWaitingOnParts: WorkOrderPartsBlock[];
  procurementDelaysImpactingExecution: ProcurementDelayBlock[];
  warehouseTransferDelays: WarehouseTransferDelayBlock[];
  inventoryShortagesCorrelatedWithActiveWork: InventoryShortageBlock[];
}

// 2. getCrossDomainBottlenecks() -- admin/dispatcher only (unfiltered
// Work Order scan, same restriction as getInventoryConsumptionSnapshot()
// in executionAnalyticsService.ts).
//
// "Waiting on parts" is judged by inventorySnapshot's own
// qtyPlanned > qtyUsed (Epic 6.3's real fields -- still needs more of
// that part) AND that part currently being HIGH/CRITICAL risk per
// Epic 3's generateInventoryHealthDashboard(). This is a correlation
// across two already-real signals, not a new field or heuristic
// invented for this epic.
export async function getCrossDomainBottlenecks(): Promise<CrossDomainBottlenecks> {
  const [workOrders, purchaseOrders, transferOrders, { healthByPart }] = await Promise.all([
    fetchAllWorkOrders(),
    fetchPurchaseOrders(),
    fetchTransferOrders(),
    buildInventoryHealthByPart(),
  ]);

  const activeWorkOrders = workOrders.filter((wo) => ACTIVE_WORK_ORDER_STATUSES.has(wo.status));

  // urgency is null for a NEEDS_PLANNING recommendation (no usage
  // history -- domain/inventoryAnalyticsEngine.ts). Normalized to
  // undefined here so every existing `risk === undefined`/
  // `risk !== undefined` check below keeps working unchanged: "no
  // usage history" carries the same "no known risk signal" meaning as
  // "no health entry at all" for this cross-domain bottleneck view.
  const riskOf = (partId: string): RiskLevel | undefined => healthByPart.get(partId)?.recommendation.urgency ?? undefined;

  const workOrdersWaitingOnParts: WorkOrderPartsBlock[] = [];
  for (const wo of activeWorkOrders) {
    const partIds = (wo.inventorySnapshot ?? [])
      .filter((item) => (item.qtyPlanned ?? 0) > (item.qtyUsed ?? 0))
      .map((item) => item.sku)
      .filter((sku) => {
        const risk = riskOf(sku);
        return risk !== undefined && HIGH_RISK_LEVELS.has(risk);
      });
    if (partIds.length > 0) {
      workOrdersWaitingOnParts.push({ workOrderId: wo.id, woNumber: wo.woNumber, partIds });
    }
  }

  const blockedPartIds = new Set(workOrdersWaitingOnParts.flatMap((w) => w.partIds));

  const openPOsByPart = new Map<string, string[]>();
  for (const po of purchaseOrders) {
    if (po.status === "RECEIVED" || po.status === "CANCELLED") continue;
    for (const item of po.items) {
      if (!blockedPartIds.has(item.partId)) continue;
      const list = openPOsByPart.get(item.partId) ?? [];
      list.push(po.id);
      openPOsByPart.set(item.partId, list);
    }
  }
  const procurementDelaysImpactingExecution: ProcurementDelayBlock[] = [...openPOsByPart.entries()].map(
    ([partId, openPurchaseOrderIds]) => ({
      partId,
      openPurchaseOrderIds,
      blockedWorkOrderIds: workOrdersWaitingOnParts.filter((w) => w.partIds.includes(partId)).map((w) => w.workOrderId),
    })
  );

  const activeTransfersByPart = new Map<string, string[]>();
  for (const t of transferOrders) {
    if (t.status !== "REQUESTED" && t.status !== "IN_TRANSIT") continue;
    const risk = riskOf(t.partId);
    if (risk === undefined || !HIGH_RISK_LEVELS.has(risk)) continue;
    const list = activeTransfersByPart.get(t.partId) ?? [];
    list.push(t.id);
    activeTransfersByPart.set(t.partId, list);
  }
  const warehouseTransferDelays: WarehouseTransferDelayBlock[] = [...activeTransfersByPart.entries()].map(
    ([partId, transferOrderIds]) => ({ partId, transferOrderIds, riskLevel: riskOf(partId)! })
  );

  const activeWorkCountByPart = new Map<string, number>();
  for (const wo of activeWorkOrders) {
    const skus = new Set((wo.inventorySnapshot ?? []).map((item) => item.sku));
    for (const sku of skus) {
      activeWorkCountByPart.set(sku, (activeWorkCountByPart.get(sku) ?? 0) + 1);
    }
  }
  const inventoryShortagesCorrelatedWithActiveWork: InventoryShortageBlock[] = [...activeWorkCountByPart.entries()]
    .map(([partId, activeWorkOrderCount]) => ({ partId, riskLevel: riskOf(partId), activeWorkOrderCount }))
    .filter((entry): entry is InventoryShortageBlock => entry.riskLevel !== undefined && HIGH_RISK_LEVELS.has(entry.riskLevel));

  return {
    workOrdersWaitingOnParts,
    procurementDelaysImpactingExecution,
    warehouseTransferDelays,
    inventoryShortagesCorrelatedWithActiveWork,
  };
}

export interface PartDemandHeatmapEntry {
  partId: string;
  demandFrequency: number;
  consumptionTrend: number;
  reorderSignalStrength: RiskLevel;
}

// 3. getPartDemandHeatmap() -- MUST reuse per Epic 8's mandatory reuse
// requirement, and does: demandFrequency/consumption totals come from
// Epic 7's getInventoryConsumptionSnapshot() (qtyUsed-based), while
// consumptionTrend (avgDailyUsage) and reorderSignalStrength (urgency)
// come from Epic 3's generateInventoryHealthDashboard() (ledger-based).
// Neither figure is recomputed here -- this only joins the two by
// partId. reorderSignalStrength is explicitly a derived/composite
// metric, not a new authority on reorder decisions (Epic 3's
// recommendation.urgency remains that authority).
export async function getPartDemandHeatmap(): Promise<PartDemandHeatmapEntry[]> {
  const [inventoryConsumption, { healthByPart }] = await Promise.all([
    getInventoryConsumptionSnapshot(),
    buildInventoryHealthByPart(),
  ]);

  return inventoryConsumption.parts
    .map((p) => {
      const health = healthByPart.get(p.partId);
      return {
        partId: p.partId,
        demandFrequency: p.frequency,
        consumptionTrend: health?.usage.avgDailyUsage ?? 0,
        reorderSignalStrength: health?.recommendation.urgency ?? ("LOW" as RiskLevel),
      };
    })
    .sort((a, b) => b.demandFrequency - a.demandFrequency);
}

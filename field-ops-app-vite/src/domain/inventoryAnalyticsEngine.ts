// Client mirror of functions/src/inventoryAnalyticsService.ts's pure
// forecasting logic (Epic 3) -- same "client + server mirrors" pattern
// as data/partsCatalog.ts. functions/src/inventoryAnalyticsService.ts
// is authoritative; if the two drift, that file wins. Kept here
// (rather than imported across the functions/ <-> field-ops-app-vite/
// package boundary) because the two are separate npm packages with
// independent tsconfigs -- there's no existing precedent in this repo
// for a cross-package source import.
//
// Only the synchronous, non-provider functions are mirrored -- the
// server file's *WithProvider wrappers exist for a lazy-fetch caller
// this dashboard doesn't need (it already has all StockSnapshots in
// hand from one batch Firestore read).

import { getCatalogItem } from "../data/partsCatalog";

export type LedgerTransaction = {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  timestamp: number;
};

export type StockSnapshot = {
  partId: string;
  availableStock: number;
};

export type UsageStats = {
  partId: string;
  totalConsumed: number;
  avgDailyUsage: number;
  volatility: number;
  volatilityModel: "HEURISTIC_SIMPLE";
};

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type StockoutPrediction = {
  partId: string;
  daysRemaining: number;
  estimatedStockoutDate: Date | null;
  riskLevel: RiskLevel;
};

export type ReplenishmentRecommendation = {
  partId: string;
  availableStock: number;
  reorderPoint: number;
  daysRemaining: number;
  recommendedOrderQty: number;
  urgency: RiskLevel;
  modelVersion: "EPIC3_LINEAR_V1";
};

export type InventoryHealthEntry = {
  partId: string;
  usage: UsageStats;
  stock: StockSnapshot;
  recommendation: ReplenishmentRecommendation;
};

// Sprint 2.1.2 -- Inventory Operational Queue. Moved here from
// modules/operations/panels/InventoryHealthPanel.jsx so this file is
// the canonical home for inventory-domain presentation constants and
// derived models, not just raw analytics math -- InventoryHealthPanel
// (Operations) and PartsList's queue section (Inventory workspace)
// both import this one constant instead of each defining their own
// copy. No logic change from the original.
export const URGENCY_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function filterTransactionsByPart(transactions: LedgerTransaction[], partId: string): LedgerTransaction[] {
  return transactions.filter((t) => t.partId === partId);
}

function getConsumedTransactions(transactions: LedgerTransaction[]): LedgerTransaction[] {
  return transactions.filter((t) => t.type === "CONSUMED");
}

// `avgDailyUsage === 0` is ambiguous: it means either "genuinely no
// demand" or "no CONSUMED transactions exist for this part in the
// window" (indistinguishable from each other in the math -- see
// calculateUsageRate below). This flag lets callers render an honest
// "insufficient usage history" state instead of a numeric 0 that reads
// as "no reorder needed," without changing recommendedOrderQty's
// value or any consumer that already depends on it being a number.
export function hasUsageHistory(usage: UsageStats): boolean {
  return usage.totalConsumed > 0;
}

export function calculateUsageRate(
  partId: string,
  transactions: LedgerTransaction[],
  windowDays: number = 30
): UsageStats {
  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const filtered = getConsumedTransactions(filterTransactionsByPart(transactions, partId)).filter(
    (t) => now - t.timestamp <= windowMs
  );

  const totalConsumed = filtered.reduce((sum, t) => sum + t.quantity, 0);
  const avgDailyUsage = totalConsumed / windowDays;

  const variance =
    filtered.length > 0
      ? filtered.reduce((acc, t) => acc + Math.pow(t.quantity - avgDailyUsage, 2), 0) / filtered.length
      : 0;

  return {
    partId,
    totalConsumed,
    avgDailyUsage,
    volatility: Math.sqrt(variance),
    volatilityModel: "HEURISTIC_SIMPLE",
  };
}

export function predictStockout(partId: string, availableStock: number, usage: UsageStats): StockoutPrediction {
  const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;

  const now = Date.now();
  const estimatedStockoutDate =
    daysRemaining === Infinity ? null : new Date(now + daysRemaining * 24 * 60 * 60 * 1000);

  let riskLevel: RiskLevel = "LOW";
  if (daysRemaining < 3) riskLevel = "CRITICAL";
  else if (daysRemaining < 7) riskLevel = "HIGH";
  else if (daysRemaining < 14) riskLevel = "MEDIUM";

  return { partId, daysRemaining, estimatedStockoutDate, riskLevel };
}

export function calculateReorderPoint(
  usage: UsageStats,
  leadTimeDays: number = 7,
  safetyFactor: number = 1.5
): number {
  const safetyStock = usage.avgDailyUsage * safetyFactor;
  return usage.avgDailyUsage * leadTimeDays + safetyStock;
}

export function generateReplenishmentRecommendation(
  partId: string,
  availableStock: number,
  usage: UsageStats,
  leadTimeDays: number = 7
): ReplenishmentRecommendation {
  const reorderPoint = calculateReorderPoint(usage, leadTimeDays, 1.5);
  const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;
  const recommendedOrderQty = Math.max(reorderPoint * 2 - availableStock, 0);

  let urgency: RiskLevel = "LOW";
  if (availableStock <= reorderPoint * 0.5) urgency = "CRITICAL";
  else if (availableStock <= reorderPoint) urgency = "HIGH";
  else if (daysRemaining < 14) urgency = "MEDIUM";

  return {
    partId,
    availableStock,
    reorderPoint,
    daysRemaining,
    recommendedOrderQty,
    urgency,
    modelVersion: "EPIC3_LINEAR_V1",
  };
}

// Normalization boundary between a raw Firestore inventory_transactions
// doc (Firestore Timestamp) and this engine's plain-epoch-ms
// LedgerTransaction -- same role as functions/src/ledgerNormalizer.ts
// server-side, just on the client's read path instead.
export function normalizeLedgerTransaction(doc: {
  id: string;
  workOrderId: string;
  partId: string;
  type: LedgerTransaction["type"];
  quantity: number;
  timestamp: { toMillis?: () => number } | number;
}): LedgerTransaction {
  const timestamp =
    typeof doc.timestamp === "number" ? doc.timestamp : (doc.timestamp?.toMillis?.() ?? 0);
  return {
    id: doc.id,
    workOrderId: doc.workOrderId,
    partId: doc.partId,
    type: doc.type,
    quantity: doc.quantity,
    timestamp,
  };
}

export function generateInventoryHealthDashboard(
  transactions: LedgerTransaction[],
  stockSnapshots: StockSnapshot[]
): InventoryHealthEntry[] {
  return stockSnapshots.map((stock) => {
    const usage = calculateUsageRate(stock.partId, transactions);
    return {
      partId: stock.partId,
      usage,
      stock,
      recommendation: generateReplenishmentRecommendation(stock.partId, stock.availableStock, usage),
    };
  });
}

// Moved here from modules/operations/Operations.jsx (Sprint 2.1.1) so
// the new Inventory domain workspace and the Operations dashboard
// share one computation instead of each maintaining its own copy of
// the same formula. No logic change from the original -- same formula
// as functions/src/inventoryService.ts's getAvailableQuantity:
// available = warehouseQty (data/partsCatalog.ts's static baseline) -
// (grossReserved - released). CONSUMED is deliberately not subtracted
// again (see that file's comment).
export function computeAvailableStockByPart(transactions: LedgerTransaction[]): Map<string, number> {
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

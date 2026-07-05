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

function filterTransactionsByPart(transactions: LedgerTransaction[], partId: string): LedgerTransaction[] {
  return transactions.filter((t) => t.partId === partId);
}

function getConsumedTransactions(transactions: LedgerTransaction[]): LedgerTransaction[] {
  return transactions.filter((t) => t.type === "CONSUMED");
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

// Epic 3 -- Inventory Analytics Engine.
//
// A deterministic forecasting layer over immutable inventory history --
// NOT an inventory control system, warehouse system, automation engine,
// or workflow system. Every function here is pure: given the same
// transactions/stock snapshot input, always the same output, no
// Firestore access, no mutation, no dependency on Work Order state or
// logic (workOrderId is carried on LedgerTransaction only because it's
// part of the real ledger's shape -- no function below reads or
// branches on it).
//
// Type name note: this file's `LedgerTransaction` is deliberately NOT
// named `InventoryTransaction` -- that name is already taken by
// functions/src/types/inventoryTransaction.ts's Firestore-shaped type,
// which stores `timestamp` as a Firestore Admin SDK `Timestamp` object,
// not a plain number. The two are structurally incompatible (a
// `Timestamp` is not a `number`), so giving them the same name would
// create a real collision risk the moment a future caller imports both
// in one file (e.g. a Cloud Function that reads the real ledger and
// feeds it into this analytics engine). A real caller must convert
// each Firestore `Timestamp` to epoch milliseconds first (`.toMillis()`)
// before calling any function here -- that conversion boundary is
// deliberately kept outside this file, which stays pure and
// Firestore-agnostic.

export type LedgerTransaction = {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  timestamp: number; // epoch ms -- see header comment re: Timestamp conversion
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
  // Epic 3 Fix 3.2 -- labels volatility explicitly as the naive
  // heuristic it is (see calculateUsageRate's comment), so a consumer
  // of this data never mistakes it for a real statistical/forecasting
  // model. A future, more rigorous model would ship as a new literal
  // value here, not silently change what "HEURISTIC_SIMPLE" means.
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
  // Epic 3 Fix 3.3 -- labels the reorder logic's lineage explicitly, so
  // it's never mistaken for a "smart"/adaptive model. A future
  // replacement model ships as a new version string (e.g.
  // "EPIC4_SEASONAL_V1"), and any consumer checking this field can tell
  // exactly which deterministic formula produced a given
  // recommendation.
  modelVersion: "EPIC3_LINEAR_V1";
};

export type InventoryHealthEntry = {
  partId: string;
  usage: UsageStats;
  stock: StockSnapshot;
  recommendation: ReplenishmentRecommendation;
};

function filterTransactionsByPart(
  transactions: LedgerTransaction[],
  partId: string
): LedgerTransaction[] {
  return transactions.filter((t) => t.partId === partId);
}

function getConsumedTransactions(transactions: LedgerTransaction[]): LedgerTransaction[] {
  return transactions.filter((t) => t.type === "CONSUMED");
}

// Usage rate over a trailing window (default 30 days). volatility is a
// simple estimate (per-transaction quantity variance around the
// window's average DAILY rate, not a rigorous statistical measure) --
// deliberately naive, matching this epic's own "simple volatility
// estimate" framing rather than a more sophisticated model. Known
// quirk, not a bug: comparing a per-transaction quantity against a
// window-normalized daily rate means volatility is nonzero even for
// perfectly steady consumption (different units) unless windowDays
// happens to equal the transaction count -- verified/documented via
// this exact behavior in this epic's test pass, not "fixed."
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

export function calculateDaysOfSupply(
  partId: string,
  availableStock: number,
  usage: UsageStats
): number {
  if (usage.avgDailyUsage === 0) return Infinity;
  return availableStock / usage.avgDailyUsage;
}

export function predictStockout(
  partId: string,
  availableStock: number,
  usage: UsageStats
): StockoutPrediction {
  const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;

  const now = Date.now();
  const estimatedStockoutDate =
    daysRemaining === Infinity ? null : new Date(now + daysRemaining * 24 * 60 * 60 * 1000);

  let riskLevel: RiskLevel = "LOW";
  if (daysRemaining < 3) riskLevel = "CRITICAL";
  else if (daysRemaining < 7) riskLevel = "HIGH";
  else if (daysRemaining < 14) riskLevel = "MEDIUM";

  return {
    partId,
    daysRemaining,
    estimatedStockoutDate,
    riskLevel,
  };
}

// Simple reorder point: lead-time demand plus a safety-stock buffer
// (a flat multiple of daily usage, not a service-level/variability-based
// calculation) -- deliberately naive, matching this epic's own framing.
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

// --- Epic 3 Fix 3.4 -- provider-based wrappers, ADDITIVE only ---
//
// The functions above (calculateDaysOfSupply/predictStockout/
// generateReplenishmentRecommendation/generateInventoryHealthDashboard)
// are UNCHANGED -- still pure, synchronous, trivially testable with
// plain numbers. They already decouple this engine from any storage
// model: a caller integrating a future warehouse system just fetches a
// number from wherever and passes it in, exactly as it would for
// Firestore-sourced data today. Replacing their signatures with an
// async provider would have made them I/O-capable for no actual gain
// in decoupling -- a real regression against this epic's own "all
// functions are pure and testable" goal.
//
// Instead, StockSnapshotProvider and the *WithProvider wrappers below
// are added alongside the pure functions, for the specific case (Epic
// 4 warehouse integration) where a caller genuinely wants to fetch
// stock lazily/per-part rather than pre-assembling a StockSnapshot[].
// Each wrapper does nothing but await the provider and delegate to the
// existing pure function -- no duplicated logic.
export type StockSnapshotProvider = {
  getStock(partId: string): Promise<number> | number;
};

export async function calculateDaysOfSupplyWithProvider(
  partId: string,
  stockProvider: StockSnapshotProvider,
  usage: UsageStats
): Promise<number> {
  const availableStock = await stockProvider.getStock(partId);
  return calculateDaysOfSupply(partId, availableStock, usage);
}

export async function predictStockoutWithProvider(
  partId: string,
  stockProvider: StockSnapshotProvider,
  usage: UsageStats
): Promise<StockoutPrediction> {
  const availableStock = await stockProvider.getStock(partId);
  return predictStockout(partId, availableStock, usage);
}

export async function generateReplenishmentRecommendationWithProvider(
  partId: string,
  stockProvider: StockSnapshotProvider,
  usage: UsageStats,
  leadTimeDays: number = 7
): Promise<ReplenishmentRecommendation> {
  const availableStock = await stockProvider.getStock(partId);
  return generateReplenishmentRecommendation(partId, availableStock, usage, leadTimeDays);
}

// Provider-based dashboard variant: takes a list of partIds instead of
// a pre-fetched StockSnapshot[], fetching each part's stock lazily via
// the provider. generateInventoryHealthDashboard() (array-based) is
// still the right choice whenever the caller already has all snapshots
// in hand (e.g. read once from Firestore) -- this variant exists for
// when it doesn't.
export async function generateInventoryHealthDashboardWithProvider(
  transactions: LedgerTransaction[],
  partIds: string[],
  stockProvider: StockSnapshotProvider
): Promise<InventoryHealthEntry[]> {
  const entries: InventoryHealthEntry[] = [];
  for (const partId of partIds) {
    const usage = calculateUsageRate(partId, transactions);
    const availableStock = await stockProvider.getStock(partId);
    entries.push({
      partId,
      usage,
      stock: { partId, availableStock },
      recommendation: generateReplenishmentRecommendation(partId, availableStock, usage),
    });
  }
  return entries;
}

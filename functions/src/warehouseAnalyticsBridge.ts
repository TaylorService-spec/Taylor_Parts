// Epic 4 Warehouse + Fulfillment System -- analytics integration bridge.
//
// Consumes Epic 3's read-only forecasting output to produce warehouse
// suggestions. Strictly read-only: nothing here calls
// updateStockLocation/createTransferOrder or writes anywhere -- a
// caller (human or future admin action) decides whether to act on a
// suggestion, this module never acts on its own.
import type {
  ReplenishmentRecommendation,
  StockoutPrediction,
} from "./inventoryAnalyticsService";
import type { Warehouse, StockLocation } from "./types/warehouse";

export interface ReorderSignal {
  partId: string;
  recommendedOrderQty: number;
  urgency: ReplenishmentRecommendation["urgency"];
}

// Passes through Epic 3's reorder recommendations as warehouse-facing
// signals -- no warehouse-specific logic here yet (there's no per-
// warehouse reorder split, since the ledger/analytics engine are
// warehouse-agnostic; see warehouseReconciliationService.ts's same
// limitation note). Filters out anything with no actual order quantity.
export function applyReorderSignals(reorderRecommendations: ReplenishmentRecommendation[]): ReorderSignal[] {
  return reorderRecommendations
    .filter((r) => r.recommendedOrderQty > 0)
    .map((r) => ({
      partId: r.partId,
      recommendedOrderQty: r.recommendedOrderQty,
      urgency: r.urgency,
    }));
}

export interface CriticalStockFlag {
  partId: string;
  daysRemaining: number;
  riskLevel: StockoutPrediction["riskLevel"];
}

// Surfaces Epic 3's HIGH/CRITICAL stockout predictions as warehouse-
// facing flags -- LOW/MEDIUM risk is not this function's concern (that's
// what generateReplenishmentRecommendation's urgency already covers via
// applyReorderSignals).
export function flagCriticalStock(stockoutPredictions: StockoutPrediction[]): CriticalStockFlag[] {
  return stockoutPredictions
    .filter((p) => p.riskLevel === "HIGH" || p.riskLevel === "CRITICAL")
    .map((p) => ({ partId: p.partId, daysRemaining: p.daysRemaining, riskLevel: p.riskLevel }));
}

export interface TransferSuggestion {
  partId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  suggestedQuantity: number;
  reason: string;
}

// Suggests moving stock from a warehouse with a surplus toward one
// flagged critical/high risk by analytics, for the same part. Purely a
// suggestion -- no TransferOrder is created here; a caller decides
// whether to act via warehouseService.createTransferOrder(). Naive by
// design (moves the lesser of the surplus or the shortfall, single
// best-surplus source per part) -- matches this epic's read-only-
// suggestion-only scope, not a routing/optimization solver.
export function suggestTransferOptimization(params: {
  warehouses: Warehouse[];
  stock: StockLocation[];
  analytics: StockoutPrediction[];
}): TransferSuggestion[] {
  const { stock, analytics } = params;

  const stockByWarehouseAndPart = new Map<string, number>();
  for (const loc of stock) {
    const key = `${loc.warehouseId}__${loc.partId}`;
    stockByWarehouseAndPart.set(key, (stockByWarehouseAndPart.get(key) ?? 0) + loc.quantity);
  }

  const suggestions: TransferSuggestion[] = [];
  const criticalParts = analytics.filter((p) => p.riskLevel === "HIGH" || p.riskLevel === "CRITICAL");

  for (const prediction of criticalParts) {
    const warehousesWithPart = Array.from(stockByWarehouseAndPart.entries())
      .filter(([key]) => key.endsWith(`__${prediction.partId}`))
      .map(([key, quantity]) => ({ warehouseId: key.split("__")[0], quantity }));

    if (warehousesWithPart.length < 2) continue;

    const sorted = [...warehousesWithPart].sort((a, b) => b.quantity - a.quantity);
    const surplusSource = sorted[0];
    const shortfallTarget = sorted[sorted.length - 1];
    if (surplusSource.warehouseId === shortfallTarget.warehouseId) continue;

    const gap = surplusSource.quantity - shortfallTarget.quantity;
    if (gap <= 0) continue;

    suggestions.push({
      partId: prediction.partId,
      fromWarehouseId: surplusSource.warehouseId,
      toWarehouseId: shortfallTarget.warehouseId,
      suggestedQuantity: Math.floor(gap / 2),
      reason: `${prediction.partId} flagged ${prediction.riskLevel} at ${shortfallTarget.warehouseId} (${prediction.daysRemaining.toFixed(1)}d remaining); ${surplusSource.warehouseId} holds a surplus`,
    });
  }

  return suggestions;
}

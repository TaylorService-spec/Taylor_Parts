"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyReorderSignals = applyReorderSignals;
exports.flagCriticalStock = flagCriticalStock;
exports.suggestTransferOptimization = suggestTransferOptimization;
// Passes through Epic 3's reorder recommendations as warehouse-facing
// signals -- no warehouse-specific logic here yet (there's no per-
// warehouse reorder split, since the ledger/analytics engine are
// warehouse-agnostic; see warehouseReconciliationService.ts's same
// limitation note). Filters out anything with no actual order quantity.
function applyReorderSignals(reorderRecommendations) {
    return reorderRecommendations
        .filter((r) => r.recommendedOrderQty > 0)
        .map((r) => ({
        partId: r.partId,
        recommendedOrderQty: r.recommendedOrderQty,
        urgency: r.urgency,
    }));
}
// Surfaces Epic 3's HIGH/CRITICAL stockout predictions as warehouse-
// facing flags -- LOW/MEDIUM risk is not this function's concern (that's
// what generateReplenishmentRecommendation's urgency already covers via
// applyReorderSignals).
function flagCriticalStock(stockoutPredictions) {
    return stockoutPredictions
        .filter((p) => p.riskLevel === "HIGH" || p.riskLevel === "CRITICAL")
        .map((p) => ({ partId: p.partId, daysRemaining: p.daysRemaining, riskLevel: p.riskLevel }));
}
// Suggests moving stock from a warehouse with a surplus toward one
// flagged critical/high risk by analytics, for the same part. Purely a
// suggestion -- no TransferOrder is created here; a caller decides
// whether to act via warehouseService.createTransferOrder(). Naive by
// design (moves the lesser of the surplus or the shortfall, single
// best-surplus source per part) -- matches this epic's read-only-
// suggestion-only scope, not a routing/optimization solver.
function suggestTransferOptimization(params) {
    const { stock, analytics } = params;
    const stockByWarehouseAndPart = new Map();
    for (const loc of stock) {
        const key = `${loc.warehouseId}__${loc.partId}`;
        stockByWarehouseAndPart.set(key, (stockByWarehouseAndPart.get(key) ?? 0) + loc.quantity);
    }
    const suggestions = [];
    const criticalParts = analytics.filter((p) => p.riskLevel === "HIGH" || p.riskLevel === "CRITICAL");
    for (const prediction of criticalParts) {
        const warehousesWithPart = Array.from(stockByWarehouseAndPart.entries())
            .filter(([key]) => key.endsWith(`__${prediction.partId}`))
            .map(([key, quantity]) => ({ warehouseId: key.split("__")[0], quantity }));
        if (warehousesWithPart.length < 2)
            continue;
        const sorted = [...warehousesWithPart].sort((a, b) => b.quantity - a.quantity);
        const surplusSource = sorted[0];
        const shortfallTarget = sorted[sorted.length - 1];
        if (surplusSource.warehouseId === shortfallTarget.warehouseId)
            continue;
        const gap = surplusSource.quantity - shortfallTarget.quantity;
        if (gap <= 0)
            continue;
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
//# sourceMappingURL=warehouseAnalyticsBridge.js.map
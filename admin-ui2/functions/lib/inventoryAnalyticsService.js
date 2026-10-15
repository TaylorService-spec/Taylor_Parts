"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasUsageHistory = hasUsageHistory;
exports.calculateUsageRate = calculateUsageRate;
exports.calculateDaysOfSupply = calculateDaysOfSupply;
exports.predictStockout = predictStockout;
exports.calculateReorderPoint = calculateReorderPoint;
exports.generateReplenishmentRecommendation = generateReplenishmentRecommendation;
exports.generateInventoryHealthDashboard = generateInventoryHealthDashboard;
exports.calculateDaysOfSupplyWithProvider = calculateDaysOfSupplyWithProvider;
exports.predictStockoutWithProvider = predictStockoutWithProvider;
exports.generateReplenishmentRecommendationWithProvider = generateReplenishmentRecommendationWithProvider;
exports.generateInventoryHealthDashboardWithProvider = generateInventoryHealthDashboardWithProvider;
function filterTransactionsByPart(transactions, partId) {
    return transactions.filter((t) => t.partId === partId);
}
function getConsumedTransactions(transactions) {
    return transactions.filter((t) => t.type === "CONSUMED");
}
// `avgDailyUsage === 0` is ambiguous: it means either "genuinely no
// demand" or "no CONSUMED transactions exist for this part in the
// window" (indistinguishable from each other in the math -- see
// calculateUsageRate below). Mirrors
// field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts's
// hasUsageHistory() (PR #88, client-only until this sprint made it a
// classification concern here too, not just a display one).
function hasUsageHistory(usage) {
    return usage.totalConsumed > 0;
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
function calculateUsageRate(partId, transactions, windowDays = 30) {
    const now = Date.now();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const filtered = getConsumedTransactions(filterTransactionsByPart(transactions, partId)).filter((t) => now - t.timestamp <= windowMs);
    const totalConsumed = filtered.reduce((sum, t) => sum + t.quantity, 0);
    const avgDailyUsage = totalConsumed / windowDays;
    const variance = filtered.length > 0
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
function calculateDaysOfSupply(partId, availableStock, usage) {
    if (usage.avgDailyUsage === 0)
        return Infinity;
    return availableStock / usage.avgDailyUsage;
}
function predictStockout(partId, availableStock, usage) {
    const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;
    const now = Date.now();
    const estimatedStockoutDate = daysRemaining === Infinity ? null : new Date(now + daysRemaining * 24 * 60 * 60 * 1000);
    let riskLevel = "LOW";
    if (daysRemaining < 3)
        riskLevel = "CRITICAL";
    else if (daysRemaining < 7)
        riskLevel = "HIGH";
    else if (daysRemaining < 14)
        riskLevel = "MEDIUM";
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
function calculateReorderPoint(usage, leadTimeDays = 7, safetyFactor = 1.5) {
    const safetyStock = usage.avgDailyUsage * safetyFactor;
    return usage.avgDailyUsage * leadTimeDays + safetyStock;
}
function generateReplenishmentRecommendation(partId, availableStock, usage, leadTimeDays = 7) {
    const reorderPoint = calculateReorderPoint(usage, leadTimeDays, 1.5);
    const daysRemaining = usage.avgDailyUsage === 0 ? Infinity : availableStock / usage.avgDailyUsage;
    const recommendedOrderQty = Math.max(reorderPoint * 2 - availableStock, 0);
    if (!hasUsageHistory(usage)) {
        return {
            partId,
            availableStock,
            reorderPoint,
            daysRemaining,
            recommendedOrderQty,
            recommendationStatus: "NEEDS_PLANNING",
            urgency: null,
            modelVersion: "EPIC3_LINEAR_V1",
        };
    }
    let urgency = "LOW";
    if (availableStock <= reorderPoint * 0.5)
        urgency = "CRITICAL";
    else if (availableStock <= reorderPoint)
        urgency = "HIGH";
    else if (daysRemaining < 14)
        urgency = "MEDIUM";
    return {
        partId,
        availableStock,
        reorderPoint,
        daysRemaining,
        recommendedOrderQty,
        recommendationStatus: "READY",
        urgency,
        modelVersion: "EPIC3_LINEAR_V1",
    };
}
function generateInventoryHealthDashboard(transactions, stockSnapshots) {
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
async function calculateDaysOfSupplyWithProvider(partId, stockProvider, usage) {
    const availableStock = await stockProvider.getStock(partId);
    return calculateDaysOfSupply(partId, availableStock, usage);
}
async function predictStockoutWithProvider(partId, stockProvider, usage) {
    const availableStock = await stockProvider.getStock(partId);
    return predictStockout(partId, availableStock, usage);
}
async function generateReplenishmentRecommendationWithProvider(partId, stockProvider, usage, leadTimeDays = 7) {
    const availableStock = await stockProvider.getStock(partId);
    return generateReplenishmentRecommendation(partId, availableStock, usage, leadTimeDays);
}
// Provider-based dashboard variant: takes a list of partIds instead of
// a pre-fetched StockSnapshot[], fetching each part's stock lazily via
// the provider. generateInventoryHealthDashboard() (array-based) is
// still the right choice whenever the caller already has all snapshots
// in hand (e.g. read once from Firestore) -- this variant exists for
// when it doesn't.
async function generateInventoryHealthDashboardWithProvider(transactions, partIds, stockProvider) {
    const entries = [];
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
//# sourceMappingURL=inventoryAnalyticsService.js.map
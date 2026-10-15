"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectStockDiscrepancies = detectStockDiscrepancies;
exports.generateReconciliationReport = generateReconciliationReport;
function sumQuantityByPart(entries) {
    const totals = new Map();
    for (const entry of entries) {
        totals.set(entry.partId, (totals.get(entry.partId) ?? 0) + entry.quantity);
    }
    return totals;
}
function classifySeverity(expectedQuantity, variance) {
    if (expectedQuantity === 0) {
        return variance === 0 ? "LOW" : "CRITICAL";
    }
    const pctOff = Math.abs(variance) / expectedQuantity;
    if (pctOff >= 0.5)
        return "CRITICAL";
    if (pctOff >= 0.25)
        return "HIGH";
    if (pctOff >= 0.1)
        return "MEDIUM";
    return "LOW";
}
// Compares each warehouse's actual bin-level stock (summed across bins,
// per part) against a ledger-derived expectation for that part, and
// returns only the entries where actual != expected -- "detect", not
// "report everything."
function detectStockDiscrepancies(params) {
    const { warehouseStock, ledgerConsumption } = params;
    const consumedByPart = sumQuantityByPart(ledgerConsumption);
    const actualByWarehouseAndPart = new Map();
    for (const loc of warehouseStock) {
        const key = `${loc.warehouseId}__${loc.partId}`;
        actualByWarehouseAndPart.set(key, (actualByWarehouseAndPart.get(key) ?? 0) + loc.quantity);
    }
    const discrepancies = [];
    for (const [key, actualQuantity] of actualByWarehouseAndPart) {
        const [warehouseId, partId] = key.split("__");
        const expectedQuantity = consumedByPart.get(partId) ?? 0;
        const variance = actualQuantity - expectedQuantity;
        if (variance === 0)
            continue;
        discrepancies.push({
            partId,
            warehouseId,
            expectedQuantity,
            actualQuantity,
            variance,
            severity: classifySeverity(expectedQuantity, variance),
        });
    }
    return discrepancies;
}
// Summarizes a discrepancy list into a report shape -- still purely
// informational, no side effects, nothing here writes anywhere.
function generateReconciliationReport(discrepancies) {
    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const d of discrepancies) {
        bySeverity[d.severity] += 1;
    }
    return {
        totalDiscrepancies: discrepancies.length,
        bySeverity,
        discrepancies,
    };
}
//# sourceMappingURL=warehouseReconciliationService.js.map
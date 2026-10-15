"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateProcurementDrafts = generateProcurementDrafts;
// Picks the lowest-priced available catalog listing per part from the
// given catalog snapshot -- same "planning layer, not an optimization
// engine" restraint as supplierService.findBestSupplierForPart (no
// MOQ/discount-tier/reliability scoring). Takes catalogItems as a
// pre-fetched input rather than querying Firestore itself, so this
// stays pure and trivially testable, matching Epic 3's engine and
// warehouseReconciliationService.ts's own pure-function pattern.
function generateProcurementDrafts(recommendations, catalogItems) {
    const bestByPart = new Map();
    for (const item of catalogItems) {
        if (!item.available)
            continue;
        const current = bestByPart.get(item.partId);
        if (!current || item.unitPrice < current.unitPrice) {
            bestByPart.set(item.partId, item);
        }
    }
    return recommendations.map((rec) => {
        const best = bestByPart.get(rec.partId) ?? null;
        return {
            partId: rec.partId,
            recommendedQuantity: rec.recommendedQuantity,
            urgency: rec.urgency,
            suggestedSupplierId: best?.supplierId ?? null,
            estimatedUnitPrice: best?.unitPrice ?? null,
            estimatedTotalCost: best ? best.unitPrice * rec.recommendedQuantity : null,
        };
    });
}
//# sourceMappingURL=procurementBridge.js.map
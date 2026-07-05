// Epic 5 Procurement + Supplier Management System -- analytics bridge.
//
// Converts Epic 3 recommendations into purchase-intent PROPOSALS only.
// This file NEVER calls procurementService.createPurchaseOrder or
// writes anywhere -- it's a pure function, same restraint as
// warehouseAnalyticsBridge.ts's suggestTransferOptimization. A
// human-triggered action (outside this epic's scope, same as Epic 4
// never wiring a client caller for its bridge) takes one of these
// proposals and explicitly calls createPurchaseOrder after approval.
import type { ProcurementRecommendation, SupplierCatalogItem } from "./types/procurement";

export interface ProcurementDraftProposal {
  partId: string;
  recommendedQuantity: number;
  urgency: ProcurementRecommendation["urgency"];
  suggestedSupplierId: string | null;
  estimatedUnitPrice: number | null;
  estimatedTotalCost: number | null;
}

// Picks the lowest-priced available catalog listing per part from the
// given catalog snapshot -- same "planning layer, not an optimization
// engine" restraint as supplierService.findBestSupplierForPart (no
// MOQ/discount-tier/reliability scoring). Takes catalogItems as a
// pre-fetched input rather than querying Firestore itself, so this
// stays pure and trivially testable, matching Epic 3's engine and
// warehouseReconciliationService.ts's own pure-function pattern.
export function generateProcurementDrafts(
  recommendations: ProcurementRecommendation[],
  catalogItems: SupplierCatalogItem[]
): ProcurementDraftProposal[] {
  const bestByPart = new Map<string, SupplierCatalogItem>();
  for (const item of catalogItems) {
    if (!item.available) continue;
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

// Client mirror of functions/src/procurementBridge.ts's pure
// draft-proposal logic (Epic 5) -- same mirror pattern as
// inventoryAnalyticsEngine.ts. functions/src/procurementBridge.ts is
// authoritative. Never creates a real PurchaseOrder -- this only
// produces proposal objects for the dashboard to display; turning one
// into a real order is a human-triggered action outside this dashboard.

export interface ProcurementRecommendation {
  partId: string;
  recommendedQuantity: number;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  source: "EPIC3_ANALYTICS";
}

export interface SupplierCatalogItem {
  id: string;
  supplierId: string;
  partId: string;
  unitPrice: number;
  available: boolean;
}

export interface ProcurementDraftProposal {
  partId: string;
  recommendedQuantity: number;
  urgency: ProcurementRecommendation["urgency"];
  suggestedSupplierId: string | null;
  estimatedUnitPrice: number | null;
  estimatedTotalCost: number | null;
}

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

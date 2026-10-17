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

// FIREBASE EXIT F2 (2026-10-17): the items come from the governed EOS part-supplier terms
// (services/partsOperationsReads.js fetchSupplierCatalogForParts), not Firestore `supplier_catalog`. Cost is
// the COMMERCIAL field group there (DECISIONS #210 / #230): a caller without inventory.catalog.cost.read gets
// it WITHHELD, so unitPrice is null rather than a number.
export interface SupplierCatalogItem {
  id: string;
  supplierId: string;
  partId: string;
  unitPrice: number | null;
  currency?: string | null;
  available: boolean;
  preferred?: boolean;
}

// The cheapest available item wins when both prices are known in the same currency -- the rule this engine has always
// had. When a price is withheld or the currencies differ there is nothing honest to compare, so the governed PREFERRED
// supplier wins instead and no price is estimated.
function better(a: SupplierCatalogItem, b: SupplierCatalogItem): boolean {
  if (a.unitPrice !== null && b.unitPrice !== null && (a.currency ?? null) === (b.currency ?? null)) {
    return a.unitPrice < b.unitPrice;
  }
  return Boolean(a.preferred) && !b.preferred;
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
    if (!current || better(item, current)) {
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
      estimatedTotalCost: best && best.unitPrice !== null ? best.unitPrice * rec.recommendedQuantity : null,
    };
  });
}

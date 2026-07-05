// Client mirror of functions/src/warehouseReconciliationService.ts's
// pure reconciliation logic (Epic 4) -- same mirror pattern as
// inventoryAnalyticsEngine.ts. functions/src/warehouseReconciliationService.ts
// is authoritative.
//
// Same known limitation as the server file: inventory_transactions has
// no warehouseId, so expectedQuantity is a global figure compared
// against one warehouse's actual bin-level total -- exact for a single
// warehouse, a real simplification for multi-warehouse.

export interface StockLocation {
  id: string;
  warehouseId: string;
  partId: string;
  quantity: number;
  binCode: string;
}

export type DiscrepancySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface WarehouseDiscrepancy {
  partId: string;
  warehouseId: string;
  expectedQuantity: number;
  actualQuantity: number;
  variance: number;
  severity: DiscrepancySeverity;
}

export interface LedgerConsumptionEntry {
  partId: string;
  quantity: number;
}

function sumQuantityByPart(entries: Array<{ partId: string; quantity: number }>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.partId, (totals.get(entry.partId) ?? 0) + entry.quantity);
  }
  return totals;
}

function classifySeverity(expectedQuantity: number, variance: number): DiscrepancySeverity {
  if (expectedQuantity === 0) {
    return variance === 0 ? "LOW" : "CRITICAL";
  }
  const pctOff = Math.abs(variance) / expectedQuantity;
  if (pctOff >= 0.5) return "CRITICAL";
  if (pctOff >= 0.25) return "HIGH";
  if (pctOff >= 0.1) return "MEDIUM";
  return "LOW";
}

export function detectStockDiscrepancies(params: {
  warehouseStock: StockLocation[];
  ledgerConsumption: LedgerConsumptionEntry[];
}): WarehouseDiscrepancy[] {
  const { warehouseStock, ledgerConsumption } = params;
  const consumedByPart = sumQuantityByPart(ledgerConsumption);

  const actualByWarehouseAndPart = new Map<string, number>();
  for (const loc of warehouseStock) {
    const key = `${loc.warehouseId}__${loc.partId}`;
    actualByWarehouseAndPart.set(key, (actualByWarehouseAndPart.get(key) ?? 0) + loc.quantity);
  }

  const discrepancies: WarehouseDiscrepancy[] = [];
  for (const [key, actualQuantity] of actualByWarehouseAndPart) {
    const [warehouseId, partId] = key.split("__");
    const expectedQuantity = consumedByPart.get(partId) ?? 0;
    const variance = actualQuantity - expectedQuantity;
    if (variance === 0) continue;

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

export interface ReconciliationReport {
  totalDiscrepancies: number;
  bySeverity: Record<DiscrepancySeverity, number>;
  discrepancies: WarehouseDiscrepancy[];
}

export function generateReconciliationReport(discrepancies: WarehouseDiscrepancy[]): ReconciliationReport {
  const bySeverity: Record<DiscrepancySeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const d of discrepancies) {
    bySeverity[d.severity] += 1;
  }
  return { totalDiscrepancies: discrepancies.length, bySeverity, discrepancies };
}

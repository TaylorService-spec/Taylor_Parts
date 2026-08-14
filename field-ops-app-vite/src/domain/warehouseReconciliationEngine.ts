// Client mirror of functions/src/warehouseReconciliationService.ts's
// pure reconciliation logic (Epic 4) -- same mirror pattern as
// inventoryAnalyticsEngine.ts. functions/src/warehouseReconciliationService.ts
// is authoritative; if the two drift, that file wins.
//
// Known limitation (same as the server file): inventory_transactions
// (LedgerTransaction, see inventoryAnalyticsEngine.ts) has no
// warehouseId -- it's warehouse-agnostic by design (Epic 2D). So a
// caller building LedgerConsumptionEntry values from the live ledger
// today cannot supply warehouseId. Rather than compare a global
// consumption figure against one warehouse's bin-level total --
// manufacturing spurious HIGH/CRITICAL discrepancies the moment a
// deployment has more than one warehouse -- this fails closed (see
// the guard in detectStockDiscrepancies below): no discrepancies
// reported, never a wrong one.

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
  warehouseId?: string;
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
  // A global ledger entry cannot truthfully be compared to one warehouse.
  // Fail closed until the producer supplies warehouse attribution instead of
  // manufacturing HIGH/CRITICAL discrepancies from incompatible scopes.
  if (warehouseStock.some((s) => s.warehouseId) && ledgerConsumption.some((e) => !e.warehouseId)) return [];
  const consumedByWarehouseAndPart = new Map<string, number>();
  for (const entry of ledgerConsumption) {
    const key = `${entry.warehouseId ?? ""}__${entry.partId}`;
    consumedByWarehouseAndPart.set(key, (consumedByWarehouseAndPart.get(key) ?? 0) + entry.quantity);
  }

  const actualByWarehouseAndPart = new Map<string, number>();
  for (const loc of warehouseStock) {
    const key = `${loc.warehouseId}__${loc.partId}`;
    actualByWarehouseAndPart.set(key, (actualByWarehouseAndPart.get(key) ?? 0) + loc.quantity);
  }

  const discrepancies: WarehouseDiscrepancy[] = [];
  for (const [key, actualQuantity] of actualByWarehouseAndPart) {
    const [warehouseId, partId] = key.split("__");
    const expectedQuantity = consumedByWarehouseAndPart.get(`${warehouseId}__${partId}`) ?? 0;
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

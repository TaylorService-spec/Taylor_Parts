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
// the guard in detectStockDiscrepancies below).
//
// M15 fix: fail-closed does NOT mean "report zero discrepancies." Today
// every live call trips this guard (bin stock always carries warehouseId;
// no ledger write anywhere sets it -- see functions/src/types/
// inventoryTransaction.ts), so this ALWAYS returns the guard branch, and
// the old `[]`-for-both-cases shape made "the check ran and found nothing"
// indistinguishable from "the check could not run at all." WarehousePanel
// rendered the latter as "No discrepancies" -- a clean bill of health for
// a check that structurally never executes. detectStockDiscrepancies now
// returns a status alongside the discrepancy list so the guard branch and
// the genuinely-clean branch are never conflated, the same honesty
// discipline domain/reconciliationRowHonesty.js already applies per-row.

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

// "EVALUATED" means the comparison actually ran (discrepancies may still be
// empty -- a genuinely clean result). "CANNOT_EVALUATE" means the guard
// below fired and no comparison was possible; discrepancies is always []
// in that case, but the two must never be presented as the same thing.
export type ReconciliationStatus = "EVALUATED" | "CANNOT_EVALUATE";

export interface DiscrepancyDetectionResult {
  status: ReconciliationStatus;
  discrepancies: WarehouseDiscrepancy[];
}

export function detectStockDiscrepancies(params: {
  warehouseStock: StockLocation[];
  ledgerConsumption: LedgerConsumptionEntry[];
}): DiscrepancyDetectionResult {
  const { warehouseStock, ledgerConsumption } = params;
  // A global ledger entry cannot truthfully be compared to one warehouse.
  // Fail closed until the producer supplies warehouse attribution instead of
  // manufacturing HIGH/CRITICAL discrepancies from incompatible scopes --
  // but "fail closed" reports as CANNOT_EVALUATE, never as a clean 0.
  if (warehouseStock.some((s) => s.warehouseId) && ledgerConsumption.some((e) => !e.warehouseId)) {
    return { status: "CANNOT_EVALUATE", discrepancies: [] };
  }
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
  return { status: "EVALUATED", discrepancies };
}

export interface ReconciliationReport {
  status: ReconciliationStatus;
  totalDiscrepancies: number;
  bySeverity: Record<DiscrepancySeverity, number>;
  discrepancies: WarehouseDiscrepancy[];
}

export function generateReconciliationReport(result: DiscrepancyDetectionResult): ReconciliationReport {
  const bySeverity: Record<DiscrepancySeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const d of result.discrepancies) {
    bySeverity[d.severity] += 1;
  }
  return {
    status: result.status,
    totalDiscrepancies: result.discrepancies.length,
    bySeverity,
    discrepancies: result.discrepancies,
  };
}

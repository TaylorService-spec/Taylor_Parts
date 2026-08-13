// Epic 4 Warehouse + Fulfillment System -- reconciliation.
//
// Pure, read-only comparison between physical stock (StockLocation)
// and ledger-derived expectation. No Firestore access, no mutation, no
// auto-correction -- a discrepancy is reported, never fixed here.
//
// Scope note: only CONSUMED ledger transactions represent stock that
// has physically left a warehouse -- RESERVED/RELEASED are ledger-side
// availability holds with no physical stock movement (the part is
// still sitting in its bin until actually consumed). Callers should
// pass only CONSUMED transactions as ledgerConsumption; passing other
// transaction types will skew expectedQuantity, since this function
// does no type filtering itself (it trusts the caller's naming/intent).
//
// Known limitation: the ledger (inventory_transactions) has no
// warehouseId -- it's warehouse-agnostic by design (Epic 2D). So
// expectedQuantity here is a global (all-warehouses) figure, compared
// against one warehouse's actual bin-level total. For a single-warehouse
// deployment this is exact; for multi-warehouse it's a real
// simplification, not a solved problem -- flagged here rather than
// silently assumed correct.
import type { StockLocation, WarehouseDiscrepancy, DiscrepancySeverity } from "./types/warehouse";

export interface LedgerConsumptionEntry {
  partId: string;
  quantity: number;
  warehouseId?: string;
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

// Compares each warehouse's actual bin-level stock (summed across bins,
// per part) against a ledger-derived expectation for that part, and
// returns only the entries where actual != expected -- "detect", not
// "report everything."
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

// Summarizes a discrepancy list into a report shape -- still purely
// informational, no side effects, nothing here writes anywhere.
export function generateReconciliationReport(discrepancies: WarehouseDiscrepancy[]): ReconciliationReport {
  const bySeverity: Record<DiscrepancySeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const d of discrepancies) {
    bySeverity[d.severity] += 1;
  }
  return {
    totalDiscrepancies: discrepancies.length,
    bySeverity,
    discrepancies,
  };
}

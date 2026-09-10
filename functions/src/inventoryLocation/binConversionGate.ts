// BIN CONVERSION GATE (BIN-P7, Decision #178 B4) -- the established operational fact that a Warehouse
// has been transitioned to authoritative Bin custody and the transition reconciled.
//
// WHY A RECORD OF ITS OWN, not a field on the warehouse document: `warehouses/{id}.status` is the
// Receiving location-eligibility authority (ACTIVE/INACTIVE, I-LA C2) and its shape is locked by the
// strict validator five consumers share. "Converted to bins" is a different fact with different
// evidence. It is not configuration either -- there is no Admin editor and no client path: the
// collection has no firestore.rules match block, so every client is denied by default, and the only
// writer is the governed completion step (functions/scripts/completeBinConversion.mjs), which refuses
// unless the reconciliation report balances.
//
// States are no broader than P7 needs. ABSENT means NOT_CONVERTED; the one stored state is
// CONVERSION_COMPLETE. There is no un-convert: nothing requires one yet.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { ConversionReport } from "../inventoryLedger/binConversionReconciliation.js";

export const WAREHOUSE_BIN_CONVERSIONS_COLLECTION = "warehouse_bin_conversions";
export const BIN_CONVERSION_SCHEMA_VERSION = 1;
export const CONVERSION_COMPLETE = "CONVERSION_COMPLETE";

/** Whether this Warehouse has passed the Bin conversion gate. Fails closed on any malformed record. */
export async function isWarehouseBinConversionComplete(txn: Transaction, db: Firestore, warehouseId: string): Promise<boolean> {
  const snap = await txn.get(db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(warehouseId));
  if (!snap.exists) return false;
  const d = snap.data() ?? {};
  return d.schemaVersion === BIN_CONVERSION_SCHEMA_VERSION && d.warehouseId === warehouseId && d.state === CONVERSION_COMPLETE;
}

export class ConversionNotProvenError extends Error {}

/**
 * The completion record, built ONLY from a balanced report. Throws otherwise -- the gate cannot be
 * passed on anyone's say-so. `completedAt` is left to the writer (a server timestamp).
 */
export function buildConversionCompletion(
  report: ConversionReport,
  meta: { readonly completedBy: string; readonly reportSha256: string; readonly malformedRows: number },
): Record<string, unknown> {
  if (meta.malformedRows !== 0) throw new ConversionNotProvenError(`${meta.malformedRows} malformed ledger row(s) -- a report that skipped evidence proves nothing`);
  if (report.unresolvedBinIds.length > 0) throw new ConversionNotProvenError(`unresolved bin ids: ${report.unresolvedBinIds.join(", ")}`);
  const unexplained = report.parts.filter((p) => !p.balanced);
  if (unexplained.length > 0 || !report.balanced) {
    throw new ConversionNotProvenError(`not balanced: ${unexplained.map((p) => p.partId).join(", ") || "report"}`);
  }
  const sum = (k: "binnedAfter" | "directAfter" | "otherNet") => report.parts.reduce((n, p) => n + p[k], 0);
  return {
    schemaVersion: BIN_CONVERSION_SCHEMA_VERSION,
    warehouseId: report.warehouseId,
    state: CONVERSION_COMPLETE,
    conversionWindow: { start: report.start, end: report.end },
    evidence: {
      reportSha256: meta.reportSha256,
      parts: report.parts.length,
      binnedAfter: sum("binnedAfter"),
      // Stock deliberately left unbinned (floor stock, oversize) stays direct and is named in the
      // runbook's completion record; it is not a reason to refuse the gate.
      directAfter: sum("directAfter"),
      explainedOtherActivity: sum("otherNet"),
    },
    completedBy: meta.completedBy,
  };
}

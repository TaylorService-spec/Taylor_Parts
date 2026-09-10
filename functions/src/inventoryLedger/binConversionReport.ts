// Reads one Warehouse's conversion evidence and reconciles it. Shared by the read-only reconciliation
// script and the completion step, so the gate is passed on EXACTLY the report an operator reviewed.

import type { Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { BINS_COLLECTION } from "../inventoryLocation/binCommands.js";
import { parentageFromBinSnapshots } from "../inventoryLocation/binParentage.js";
import { INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import { classifyLedgerDoc, deserializeOperationalMovement } from "./operationalMovementRepository.js";
import { reconcileBinConversion, type ConversionReport, type ConversionRow } from "./binConversionReconciliation.js";

export interface LoadedConversionReport {
  readonly report: ConversionReport;
  readonly binCount: number;
  readonly rowsRead: number;
  readonly malformedRows: number;
  /** sha256 over the canonical report JSON -- what the completion record pins. */
  readonly reportSha256: string;
}

export async function readBinConversionReport(db: Firestore, warehouseId: string, start: number, end: number): Promise<LoadedConversionReport> {
  // Every bin of this warehouse, from its governed documents -- the ONLY source of parentage.
  const binSnap = await db.collection(BINS_COLLECTION).where("warehouseId", "==", warehouseId).get();
  const parentage = parentageFromBinSnapshots(binSnap.docs);
  const locationIds = [warehouseId, ...parentage.keys()];

  const rows: ConversionRow[] = [];
  let malformedRows = 0;
  for (let i = 0; i < locationIds.length; i += 30) { // `in` takes 30 values per query
    const snap = await db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("location.locationId", "in", locationIds.slice(i, i + 30)).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (classifyLedgerDoc(data) !== "operational") continue;
      try {
        const d = deserializeOperationalMovement(data);
        rows.push({ value: d.value, recordedAt: d.recordedAt });
      } catch {
        malformedRows += 1; // reported, never trusted
      }
    }
  }
  const report = reconcileBinConversion(rows, warehouseId, parentage, start, end);
  const reportSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return { report, binCount: parentage.size, rowsRead: rows.length, malformedRows, reportSha256 };
}

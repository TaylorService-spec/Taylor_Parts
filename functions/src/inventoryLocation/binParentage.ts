// BIN PARENTAGE — which Warehouse holds a Bin, read from governed `bins` documents and nothing else.
//
// Model A (Decision #160 / ADR-014) makes a Warehouse's on-hand its direct stock plus the stock at every
// Bin inside it. That sum needs to know each Bin's parent, and there are tempting shortcuts that are all
// wrong: the id's `bin_` prefix says it is a bin but not whose; the human code ("A01-003") is
// warehouse-scoped and mutable; scanner text is whatever was printed. The parent is the `warehouseId`
// field of the bin's own document, and only that.
//
// Reads ONLY the bins actually referenced by the rows being summed (binIdsReferenced), so an
// availability check costs one batched get of a handful of documents, not a scan of the racking.
//
// A bin that is missing or malformed is simply ABSENT from the map. locationOnHand treats an absent bin
// as unresolvable and excludes its rows -- it never counts them as zero, and never attributes them to a
// guessed parent. A bin's STATUS is deliberately irrelevant here: stock sitting in a retired bin is still
// physically in that warehouse, and dropping it from the aggregate would under-report real inventory.

import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import type { BinParentage } from "../inventoryLedger/locationOnHand.js";
import { BINS_COLLECTION } from "./binCommands.js";
import { BIN_SCHEMA_VERSION, isSafeIdSegment } from "./binRegistry.js";

/** Build parentage from bin snapshots. Pure given the snapshots; exported for tests. */
export function parentageFromBinSnapshots(
  snaps: ReadonlyArray<Pick<DocumentSnapshot, "exists" | "id" | "data">>,
): BinParentage {
  const map = new Map<string, string>();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() ?? {};
    if (data.schemaVersion !== BIN_SCHEMA_VERSION) continue;
    if (typeof data.warehouseId !== "string" || data.warehouseId === "") continue;
    map.set(snap.id, data.warehouseId);
  }
  return map;
}

/**
 * Resolve the parent Warehouse of each referenced bin. Pass `txn` to read inside a transaction (as
 * allocation does); otherwise reads directly. Ids that are not safe document segments are dropped
 * before any read -- a ledger row can never steer a path.
 */
export async function readBinParentage(
  db: Firestore,
  binIds: readonly string[],
  txn?: Transaction,
): Promise<BinParentage> {
  const safe = [...new Set(binIds)].filter((id) => isSafeIdSegment(id));
  if (safe.length === 0) return new Map();
  const refs = safe.map((id) => db.collection(BINS_COLLECTION).doc(id));
  const snaps = txn ? await txn.getAll(...refs) : await db.getAll(...refs);
  return parentageFromBinSnapshots(snaps);
}

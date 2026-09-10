// Enterprise Inventory Phase 4 -- the concrete production `resolveLocationActive` resolver for the
// transfer command family. Reads WAREHOUSE endpoints through `warehouses/{locationId}` (the SAME §3A
// governed validator Receiving's resolver uses) and MOBILE(truck) endpoints through
// `mobile_locations/{locationId}` (the EI Truck Registry's MOBILE Inventory Location, ADR-010). Never
// throws for data reasons -- returns a plain boolean; the command maps false to ORIGIN_INVALID /
// DESTINATION_INVALID. Because every read is inside the caller's transaction, a concurrent
// ACTIVE->INACTIVE transition (warehouse status flip, truck deactivation) conflicts the command's
// commit, forcing a retry that re-reads the new state -- no stale movement.

import { BINS_COLLECTION } from "../inventoryLocation/binCommands.js";
import { BIN_SCHEMA_VERSION } from "../inventoryLocation/binRegistry.js";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { validateGovernedWarehouse } from "../warehouseGovernance/governedWarehouseValidation.js";
import { MOBILE_LOCATIONS_COLLECTION, mobileLocationFromFirestore } from "../truckRegistry/truckRegistryRepository.js";
import { MalformedStoredRecordError as TruckMalformedStoredRecordError } from "../truckRegistry/types.js";
import type { TransferLocationRef } from "./transferOrderTypes.js";
import { isSafeDocumentIdSegment } from "./transferDocIdGuard.js";

export function makeResolveTransferLocationActive(db: Firestore): (txn: Transaction, location: TransferLocationRef) => Promise<boolean> {
  return async function resolveLocationActive(txn: Transaction, location: TransferLocationRef): Promise<boolean> {
    if (!isSafeDocumentIdSegment(location.locationId)) return false;

    if (location.type === "WAREHOUSE") {
      const snap = await txn.get(db.collection(WAREHOUSES_COLLECTION).doc(location.locationId));
      if (!snap.exists) return false;
      const parsed = validateGovernedWarehouse(snap.data(), location.locationId);
      if (!parsed.valid) return false;
      return parsed.value.status === "ACTIVE";
    }

    if (location.type === "BIN") {
      // BIN-P6: the bin must be readable at the current schema and ACTIVE, and its GOVERNED parent
      // Warehouse -- the bin document's own warehouseId, never the id prefix or the code -- must be
      // ACTIVE too. A bin in a retired building is not a place stock can go.
      const binSnap = await txn.get(db.collection(BINS_COLLECTION).doc(location.locationId));
      if (!binSnap.exists) return false;
      const bin = binSnap.data() ?? {};
      if (bin.schemaVersion !== BIN_SCHEMA_VERSION || bin.status !== "ACTIVE") return false;
      if (typeof bin.warehouseId !== "string" || !isSafeDocumentIdSegment(bin.warehouseId)) return false;
      const whSnap = await txn.get(db.collection(WAREHOUSES_COLLECTION).doc(bin.warehouseId));
      if (!whSnap.exists) return false;
      const parsed = validateGovernedWarehouse(whSnap.data(), bin.warehouseId);
      return parsed.valid && parsed.value.status === "ACTIVE";
    }

    if (location.type === "MOBILE") {
      const snap = await txn.get(db.collection(MOBILE_LOCATIONS_COLLECTION).doc(location.locationId));
      if (!snap.exists) return false;
      try {
        const parsed = mobileLocationFromFirestore(snap.id, snap.data());
        return parsed.active === true;
      } catch (err) {
        // A malformed stored MOBILE location fails closed -- never trusted as active.
        if (err instanceof TruckMalformedStoredRecordError) return false;
        throw err;
      }
    }

    return false;
  };
}

/**
 * The Warehouse custody parent of a Transfer endpoint under Model A, or null for a truck. A BIN's parent
 * is read from its governed document. Used to refuse a "transfer" that never leaves its Warehouse.
 */
export async function resolveTransferCustodyWarehouseId(
  txn: Transaction,
  db: Firestore,
  location: TransferLocationRef,
): Promise<string | null> {
  if (location.type === "WAREHOUSE") return location.locationId;
  if (location.type !== "BIN" || !isSafeDocumentIdSegment(location.locationId)) return null;
  const snap = await txn.get(db.collection(BINS_COLLECTION).doc(location.locationId));
  if (!snap.exists) return null;
  const warehouseId = (snap.data() ?? {}).warehouseId;
  return typeof warehouseId === "string" && warehouseId !== "" ? warehouseId : null;
}

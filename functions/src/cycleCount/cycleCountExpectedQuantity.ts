// Enterprise Inventory -- Cycle Count operating authority: EXPECTED-QUANTITY computation.
//
// Reuses the SAME sourcing discipline transferOrderCommand.ts's computeNoneOnHandThroughTxn established
// as the live expected-quantity authority for Transfer sufficiency (PR #1032): for NONE-mode Parts, sum
// the location-aware operational ledger (RECEIVED/RETURNED/TRANSFER_IN +, TRANSFER_OUT/SCRAPPED -,
// ADJUSTED signed) at the (partId, location) pair. That function is not exported from
// transferOrderCommand.ts, so this is a parallel, behaviorally-identical implementation over the same
// public inventoryLedger repository -- not a competing authority.
//
// IN-TRANSIT DISPOSITION (documented boundary, not an open ambiguity): a unit mid-transfer has already
// posted TRANSFER_OUT at the origin (excluded from the origin's sum) and has not yet posted TRANSFER_IN
// at the destination (excluded from the destination's sum too) -- Transfer's own dispatch/receive
// commands already establish this. A Cycle Count at either endpoint therefore correctly excludes
// in-transit stock from BOTH locations' expected quantity; it is never double-counted and never silently
// dropped, it is simply not AT a location while in flight. This module does not need to invent a
// separate in-transit business rule -- it inherits the one Transfer already enforces.
//
// SERIAL-mode expected units are NOT read from the ledger sum (the ledger's SERIAL quantity is always 1
// per event and is not an aggregable on-hand count): the authority is the serialized_assets registry's
// AVAILABLE units at the location -- the SAME rule transferOrderCommand.ts's SERIAL sufficiency check
// uses (asset.currentLocationId === origin && asset.inventoryState === "AVAILABLE"). A serial that is
// IN_TRANSIT, RESERVED, STAGED, LOADED, DELIVERED, INSTALLED, or RECEIVED-but-not-yet-AVAILABLE is
// correctly excluded from what a count at this location should expect to find.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { INVENTORY_TRANSACTIONS_COLLECTION, SERIALIZED_ASSETS_COLLECTION } from "../constants/collections.js";
import { classifyLedgerDoc, deserializeOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import type { CycleCountLocationRef } from "./cycleCountTypes.js";

export async function computeExpectedQuantityThroughTxn(
  txn: Transaction,
  db: Firestore,
  partId: string,
  location: CycleCountLocationRef,
): Promise<number> {
  const snap = await txn.get(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
  let onHand = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (classifyLedgerDoc(data) !== "operational") continue;
    let mv;
    try {
      mv = deserializeOperationalMovement(data);
    } catch {
      continue; // a malformed operational record is skipped, not trusted -- never inflates expected qty
    }
    const v = mv.value;
    if (v.location.type !== location.type || v.location.locationId !== location.locationId) continue;
    if (v.type === "RECEIVED" || v.type === "RETURNED" || v.type === "TRANSFER_IN") onHand += v.quantity;
    else if (v.type === "TRANSFER_OUT" || v.type === "SCRAPPED") onHand -= v.quantity;
    else if (v.type === "ADJUSTED") onHand += v.quantity; // ADJUSTED is already signed (direction SIGNED)
    // COUNTED (SNAPSHOT direction) is intentionally excluded from this sum -- a prior count's own
    // snapshot event is evidence, not a movement, and must never compound with itself.
  }
  return Math.max(onHand, 0);
}

export async function computeExpectedSerialsThroughTxn(
  txn: Transaction,
  db: Firestore,
  partId: string,
  location: CycleCountLocationRef,
): Promise<string[]> {
  const snap = await txn.get(
    db
      .collection(SERIALIZED_ASSETS_COLLECTION)
      .where("partId", "==", partId)
      .where("currentLocationId", "==", location.locationId)
      .where("inventoryState", "==", "AVAILABLE"),
  );
  const serials: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    if (typeof data.serialNo === "string" && data.serialNo.trim() !== "") serials.push(data.serialNo);
  }
  return serials.sort();
}

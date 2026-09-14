// Enterprise Inventory -- Cycle Count operating authority: EXPECTED-QUANTITY computation.
//
// Reuses the SAME sourcing discipline transferOrderCommand.ts's computeNoneOnHandThroughTxn established
// as the live expected-quantity authority for Transfer sufficiency (PR #1032): for NONE-mode Parts, sum
// the location-aware operational ledger at the (partId, location) pair. That function is not exported
// from transferOrderCommand.ts, so this is a parallel, behaviorally-identical implementation over the
// same public inventoryLedger repository -- not a competing authority.
//
// THE SIGN RULE IS NOT RESTATED HERE, deliberately. It used to be spelled out in this paragraph
// ("RECEIVED/RETURNED/TRANSFER_IN +, TRANSFER_OUT/SCRAPPED -, ADJUSTED signed") and that sentence had
// already gone stale: it named neither WORK_ORDER_CONSUMPTION nor the RELOCATION pair. A comment that
// restates a rule is a copy of it that no test can fail, which is how five copies of this rule drifted
// apart in the first place. The rule lives in inventoryLedger/locationOnHand.ts MOVEMENT_SIGN and is
// read from there, once, below.
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

import { signedQuantity } from "../inventoryLedger/locationOnHand.js";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { INVENTORY_TRANSACTIONS_COLLECTION, SERIALIZED_ASSETS_COLLECTION } from "../constants/collections.js";
import { classifyLedgerDoc, deserializeOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import { CycleCountIntegrityError, type CycleCountLocationRef } from "./cycleCountTypes.js";

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
    // The sign comes from inventoryLedger/locationOnHand.ts -- the ONE place it is decided. This line
    // used to carry its own RECEIVED/TRANSFER/ADJUSTED branches and never learned
    // WORK_ORDER_CONSUMPTION, so after Decision #171 made consumption live it counted consumed stock
    // as still present. Here that was worse than an overstatement: a count would "find" the consumed quantity as a
    // shortage, reconciliation would post an ADJUSTED for it, and the consumption would be subtracted
    // twice.
    //
    // signedQuantity is still an allowlist: a type it does not name (a stored COUNTED row, retired by
    // CERT-LEDGER-COUNTED-08) contributes nothing, and is skipped by classifyLedgerDoc above anyway.
    onHand += signedQuantity(v);
  }
  // A NEGATIVE TOTAL IS A DATA-INTEGRITY SIGNAL, NOT A QUANTITY. This line used to be
  // `Math.max(onHand, 0)`, which undid part of the care the comment above describes: the sign was
  // taken from the one authority and then a floor silently replaced an impossible answer with a
  // plausible one. More stock cannot have left this location than ever arrived, so a negative sum
  // means the LEDGER is wrong -- a row missing, duplicated, or misattributed.
  //
  // Clamping that to 0 does not repair it, it hides it, and it hides it in the worst possible
  // place: every unit the counter physically finds then reads as SURPLUS against an expected 0,
  // reconciliation posts an ADJUSTED for the whole counted quantity (cycleCountCommand.ts computes
  // variance = counted - expected), and the ledger gets "corrected" toward a figure the clamp
  // invented. An expected quantity derived from a number the system already knows is impossible is
  // not a count, it is a second corruption written on top of the first.
  //
  // The floor is NOT simply deleted, because a negative expectedQuantity cannot be stored either:
  // cycleCountRepository.ts and cycleCountSheetRepository.ts both reject one as a malformed stored
  // record, so writing it would brick the count document -- unreadable, and therefore not even
  // cancellable. Refusing at computation time keeps the stored contract (non-negative integer)
  // exactly as it is, because a count whose expected quantity is impossible is never created.
  //
  // CycleCountIntegrityError is the existing sanitized bucket for "this cannot coherently be done"
  // (cycleCountTypes.ts); it needs no new failure code and maps to `internal` at the callable
  // boundary, so the operator sees a refusal and an alert rather than a fabricated variance.
  if (onHand < 0) {
    throw new CycleCountIntegrityError(
      `the inventory ledger for this part nets ${onHand} at ${location.type} ${location.locationId}; ` +
        "a negative on-hand is impossible, so the expected quantity cannot be established until the ledger is corrected",
    );
  }
  return onHand;
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

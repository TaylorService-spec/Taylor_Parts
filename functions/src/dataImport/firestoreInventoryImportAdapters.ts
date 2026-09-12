// EOS Data Import -- the FIRESTORE side, for opening balances.
//
// A SECOND adapter file, alongside firestoreDataImportAdapters.ts, and split for a reason
// rather than for size: every other entity's adapter creates a RECORD, and this one stages a
// LEDGER MOVEMENT through a command that already exists and already owns the rules. Keeping
// it separate is what stops the record-shaped helpers next door from growing a quantity
// special case, and what makes it obvious that inventory does not write a document of its own.
//
// The portability boundary is unchanged: this file names collections and imports
// firebase-admin, and the contract above it does neither.

import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { PARTS_COLLECTION } from "../partMaster/partMasterRepository.js";
import { WAREHOUSES_COLLECTION } from "../constants/collections.js";
import { controlTypeToTrackingMode } from "../partMaster/controlTypeTrackingMode.js";
import { naturalIdentityKey } from "./contracts/entityContract.js";
import { isCanonicalPartId } from "../eosOps/migration/partIdContract.js";
import { derivePartId } from "./contracts/partImportContract.js";
import {
  INVENTORY_REFERENCES,
  OPENING_BALANCE_LOCATION_TYPE,
  partIdentityKeyForInventory,
} from "./contracts/inventoryImportContract.js";
import { applyOpeningInventoryBalanceThroughTxn, OpeningBalanceError } from "./openingInventoryBalance.js";
import type { RowWriter } from "./importExecution.js";
import type { PartTrackingMode } from "../inventoryLedger/operationalMovementTypes.js";

/**
 * The Parts and ACTIVE warehouses an inventory file may point at.
 *
 * ACTIVE ONLY for warehouses. `warehouses.status` is the governed authority on where stock may
 * be held (Receiving Location Authority, I-LA C2), and an opening balance is a statement about
 * stock being somewhere -- so a retired warehouse is not a place a balance may be stated at,
 * however clearly the spreadsheet names it.
 */
export async function loadInventoryReferences(
  db: Firestore = getFirestore(),
): Promise<Readonly<Record<string, ReadonlySet<string>>>> {
  const partsSnap = await db.collection(PARTS_COLLECTION).select("internalPartNumber").get();
  const parts = new Set<string>();
  for (const doc of partsSnap.docs) {
    const ipn = String((doc.data() ?? {}).internalPartNumber ?? "").trim();
    if (ipn) parts.add(partIdentityKeyForInventory(ipn));
  }

  // COUNTED, NOT COLLECTED. A Set answers "is this name present" and silently discards how
  // many warehouses answer to it -- which is the one fact preview needs in order to refuse a
  // name that identifies two places. Counting here, in the single pass that already reads the
  // register, is what lets preview and the writer refuse the same row for the same reason.
  const whSnap = await db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").select("name").get();
  const countByName = new Map<string, number>();
  for (const doc of whSnap.docs) {
    const name = String((doc.data() ?? {}).name ?? "").trim();
    if (!name) continue;
    const key = naturalIdentityKey(name);
    countByName.set(key, (countByName.get(key) ?? 0) + 1);
  }

  const warehouses = new Set<string>();
  const warehouseAmbiguous = new Set<string>();
  for (const [key, count] of countByName) {
    // A name held by two ACTIVE warehouses is NOT offered as resolvable. It goes only into the
    // ambiguous set, so a row naming it can never fall through to "found".
    if (count === 1) warehouses.add(key);
    else warehouseAmbiguous.add(key);
  }

  return Object.freeze({
    [INVENTORY_REFERENCES.PART]: parts,
    [INVENTORY_REFERENCES.WAREHOUSE]: warehouses,
    [INVENTORY_REFERENCES.WAREHOUSE_AMBIGUOUS]: warehouseAmbiguous,
  });
}

/**
 * Which (part, warehouse) positions already exist? DELIBERATELY NONE.
 *
 * The other entities answer "does this already exist" by reading what exists. For an opening
 * balance the equivalent question is "has this position already moved", and answering it here
 * would mean reading the movement ledger for every pair in the file -- outside a transaction,
 * minutes before the write, for an answer the command computes again anyway and refuses on.
 *
 * So the refusal lives in ONE place: applyOpeningInventoryBalanceThroughTxn, inside the
 * transaction, on ledger state it read itself. A preview copy would be a second authority on
 * the same question, and the two would eventually disagree -- with the preview being the one
 * an operator believed.
 *
 * THE CONSEQUENCE IS HONEST AND WORTH STATING: a position that has already moved shows READY
 * in the preview and fails at execution with OPENING_BALANCE_ALREADY_OPERATIONAL, named in the
 * result. That is a worse preview and a correct system, and between those two the ledger wins.
 */
export async function loadExistingOpeningBalances(): Promise<ReadonlySet<string>> {
  return new Set<string>();
}

/**
 * The opening-balance writer.
 *
 * It resolves the part and the warehouse and hands the row to the governed command, one
 * transaction per row. It writes nothing itself: the command owns what an opening balance
 * means, which movement it stages, and every condition under which it refuses.
 */
export function firestoreOpeningBalanceWriter(
  actorUid: string,
  db: Firestore = getFirestore(),
  importJobId = "unknown",
): RowWriter {
  return {
    async write(draft, idempotencyKey) {
      try {
        const partNumber = String(draft.internalPartNumber ?? "");
        const warehouseName = String(draft.warehouseName ?? "");

        const part = await resolvePartByNumber(db, partNumber);
        if (part.kind === "refused") {
          return { kind: "failed", code: part.code, message: part.message };
        }
        const warehouse = await resolveActiveWarehouseIdByName(db, warehouseName);
        if (warehouse.kind === "refused") {
          return { kind: "failed", code: warehouse.code, message: warehouse.message };
        }

        const outcome = await db.runTransaction(async (txn) =>
          applyOpeningInventoryBalanceThroughTxn(
            txn,
            db,
            {
              importJobId,
              // The pipeline's key already encodes (job, row), so a re-run of the same file
              // keys identically without this needing its own scheme.
              sourceRowKey: idempotencyKey,
              partId: part.partId,
              trackingMode: part.trackingMode,
              location: { type: OPENING_BALANCE_LOCATION_TYPE, locationId: warehouse.warehouseId },
              openingQuantity: Number(draft.openingQuantity ?? 0),
              actorUid,
              occurredAt: Date.now(),
            },
            { now: new Date() },
          ),
        );

        // "no-movement" is a zero balance: nothing was written because nothing moved, and a
        // movement that moves nothing is not a movement. Counted as `replayed` because that is
        // this pipeline's word for "the write was correctly a no-op" -- reporting it as
        // created would put a movement in the history that does not exist.
        if (outcome.outcome === "no-movement") return { kind: "replayed" };
        return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
      } catch (err) {
        if (err instanceof OpeningBalanceError) {
          const message =
            err.code === "OPENING_BALANCE_ALREADY_SET"
              ? "An opening balance has already been set for this part at this warehouse. There is only one per position; correct it with a cycle count."
              : err.code === "OPENING_BALANCE_ALREADY_OPERATIONAL"
              ? "This part has already moved at this warehouse. An opening balance is the starting point, not a correction; use a cycle count."
              : err.code === "OPENING_BALANCE_TRACKING_MODE_UNSUPPORTED"
                ? "This part is serial- or lot-tracked. Its balance is a list of units rather than a number, and needs a different path."
                : "The row failed the opening-balance rules.";
          return { kind: "failed", code: err.code, message };
        }
        return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
      }
    },
  };
}

/**
 * WHAT A RESOLUTION IS ALLOWED TO BE.
 *
 * Two outcomes and no third: the identifier, or a NAMED reason there isn't one. There is
 * deliberately no "best match" and no `| null` -- a null carries no reason, so the caller has
 * to invent one, and the reason it invented for an ambiguous warehouse was "it does not exist".
 */
type Resolution<T> =
  | ({ readonly kind: "resolved" } & T)
  | { readonly kind: "refused"; readonly code: string; readonly message: string };

/** A named refusal. The `code` is what the row result carries; it is never a fallback value. */
function refuse(code: string, message: string): { kind: "refused"; code: string; message: string } {
  return { kind: "refused", code, message };
}

/**
 * The part whose identity goes into the ledger.
 *
 * ═══════════ THE IDENTITY IS THE DOCUMENT ID, AND IT IS GATED ═══════════
 *
 * `Part.partId` IS the `parts` document id. This used to return `data.partId ?? doc.id`,
 * which is a SECOND authority on the same fact: a document whose stored `partId` field
 * disagreed with its own id would put the field's value into inventory_transactions, where it
 * joins to no Part and is only discoverable later as a reconciliation that does not balance.
 * So the id is the answer, a stored field that contradicts it is a refusal, and the value is
 * passed through isCanonicalPartId -- the one contract that says what a Part.partId is --
 * before it reaches a ledger command that accepts any non-empty string.
 *
 * ═══════════ AND IT NO LONGER PICKS ═══════════
 *
 * The fallback query was `.limit(2)` followed by `.docs[0]`: two Parts sharing an Internal
 * Part Number resolved to whichever Firestore returned first, and an opening balance landed
 * on a coin flip. The `limit(2)` was there to SEE the second one; nothing looked. Two Parts
 * with one part number is a question about the catalog, and an import boundary answers it by
 * naming the row, not by choosing.
 */
async function resolvePartByNumber(
  db: Firestore,
  internalPartNumber: string,
): Promise<Resolution<{ partId: string; trackingMode: PartTrackingMode }>> {
  // BY THE DERIVED ID FIRST: that is where an imported Part lives, and it costs one read.
  const derived = await db.collection(PARTS_COLLECTION).doc(derivePartId(internalPartNumber)).get();

  let doc = derived.exists ? derived : undefined;
  if (!doc) {
    // Then by query, because a Part created through the Part Master screens carries an id
    // nobody derived, and inventory must be importable against those too.
    const snap = await db
      .collection(PARTS_COLLECTION)
      .where("internalPartNumber", "==", internalPartNumber.trim())
      .limit(2)
      .get();
    if (snap.size > 1) {
      return refuse(
        "PART_NUMBER_AMBIGUOUS",
        `More than one Part carries the Internal Part Number "${internalPartNumber}". ` +
          "A part number that identifies two Parts identifies neither, and import will not choose between them. " +
          "Resolve the duplicate in Part Master, then re-upload.",
      );
    }
    doc = snap.docs[0];
  }

  if (!doc || !doc.exists) {
    return refuse("PART_NOT_FOUND", `No Part "${internalPartNumber}" exists.`);
  }

  const data = doc.data() ?? {};
  const storedPartId = data.partId;
  if (typeof storedPartId === "string" && storedPartId !== doc.id) {
    return refuse(
      "PART_ID_CONFLICT",
      `The Part for "${internalPartNumber}" stores a partId (${JSON.stringify(storedPartId)}) that is not its own ` +
        "document id. Part identity is the document id; import will not guess which of the two the ledger meant.",
    );
  }
  if (!isCanonicalPartId(doc.id)) {
    return refuse(
      "PART_ID_NOT_CANONICAL",
      `The Part for "${internalPartNumber}" has an id (${JSON.stringify(doc.id)}) that is not a canonical ` +
        "Part.partId. An opening balance may not put a non-canonical identity into the movement ledger.",
    );
  }

  return {
    kind: "resolved",
    partId: doc.id,
    trackingMode: controlTypeToTrackingMode(String(data.controlType ?? "STANDARD")) as PartTrackingMode,
  };
}

/**
 * The warehouse whose id becomes `location.locationId` in the movement ledger.
 *
 * THIS IS A LOOKUP, NOT AN INVENTION -- and the distinction is the whole design. The location
 * TYPE is never derived from the file: it is the compile-time constant
 * OPENING_BALANCE_LOCATION_TYPE ("WAREHOUSE"), so the typed pair's type half is a decision the
 * contract made, not a guess made from a spreadsheet. The id half is found by exact key
 * against the governed ACTIVE warehouse register -- case- and whitespace-insensitive, because
 * a person typed the name, but not by similarity, prefix, or nearest match.
 *
 * A file cannot carry the id half itself: EOS warehouse ids appear on no spreadsheet an
 * operator has, so requiring one would refuse every real opening-balance file rather than
 * refuse a guess. Name resolution stays. What changes is that an unresolvable name is refused
 * BY ITS ACTUAL REASON: two ACTIVE warehouses with one name is AMBIGUOUS, not absent, and
 * telling an operator a warehouse "does not exist" when two of them do points at exactly the
 * wrong correction.
 */
async function resolveActiveWarehouseIdByName(
  db: Firestore,
  name: string,
): Promise<Resolution<{ warehouseId: string }>> {
  const snap = await db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get();
  const wanted = naturalIdentityKey(name);
  const matches = snap.docs.filter((d) => naturalIdentityKey(String((d.data() ?? {}).name ?? "")) === wanted);

  if (matches.length === 1) return { kind: "resolved", warehouseId: matches[0].id };
  if (matches.length === 0) {
    return refuse("WAREHOUSE_NOT_FOUND", `No ACTIVE warehouse named "${name}" exists.`);
  }
  return refuse(
    "WAREHOUSE_NAME_AMBIGUOUS",
    `${matches.length} ACTIVE warehouses are named "${name}". A name that identifies two places identifies ` +
      "neither, and import will not choose between them. Rename them in EOS so each is distinct, then re-upload.",
  );
}

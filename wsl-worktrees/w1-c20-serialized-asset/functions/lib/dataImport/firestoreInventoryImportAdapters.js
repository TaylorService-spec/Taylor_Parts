"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadInventoryReferences = loadInventoryReferences;
exports.loadExistingOpeningBalances = loadExistingOpeningBalances;
exports.firestoreOpeningBalanceWriter = firestoreOpeningBalanceWriter;
const firestore_1 = require("firebase-admin/firestore");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const collections_js_1 = require("../constants/collections.js");
const controlTypeTrackingMode_js_1 = require("../partMaster/controlTypeTrackingMode.js");
const entityContract_js_1 = require("./contracts/entityContract.js");
const partImportContract_js_1 = require("./contracts/partImportContract.js");
const inventoryImportContract_js_1 = require("./contracts/inventoryImportContract.js");
const openingInventoryBalance_js_1 = require("./openingInventoryBalance.js");
/**
 * The Parts and ACTIVE warehouses an inventory file may point at.
 *
 * ACTIVE ONLY for warehouses. `warehouses.status` is the governed authority on where stock may
 * be held (Receiving Location Authority, I-LA C2), and an opening balance is a statement about
 * stock being somewhere -- so a retired warehouse is not a place a balance may be stated at,
 * however clearly the spreadsheet names it.
 */
async function loadInventoryReferences(db = (0, firestore_1.getFirestore)()) {
    const partsSnap = await db.collection(partMasterRepository_js_1.PARTS_COLLECTION).select("internalPartNumber").get();
    const parts = new Set();
    for (const doc of partsSnap.docs) {
        const ipn = String((doc.data() ?? {}).internalPartNumber ?? "").trim();
        if (ipn)
            parts.add((0, inventoryImportContract_js_1.partIdentityKeyForInventory)(ipn));
    }
    const whSnap = await db.collection(collections_js_1.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").select("name").get();
    const warehouses = new Set();
    for (const doc of whSnap.docs) {
        const name = String((doc.data() ?? {}).name ?? "").trim();
        if (name)
            warehouses.add((0, entityContract_js_1.naturalIdentityKey)(name));
    }
    return Object.freeze({
        [inventoryImportContract_js_1.INVENTORY_REFERENCES.PART]: parts,
        [inventoryImportContract_js_1.INVENTORY_REFERENCES.WAREHOUSE]: warehouses,
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
async function loadExistingOpeningBalances() {
    return new Set();
}
/**
 * The opening-balance writer.
 *
 * It resolves the part and the warehouse and hands the row to the governed command, one
 * transaction per row. It writes nothing itself: the command owns what an opening balance
 * means, which movement it stages, and every condition under which it refuses.
 */
function firestoreOpeningBalanceWriter(actorUid, db = (0, firestore_1.getFirestore)(), importJobId = "unknown") {
    return {
        async write(draft, idempotencyKey) {
            try {
                const partNumber = String(draft.internalPartNumber ?? "");
                const warehouseName = String(draft.warehouseName ?? "");
                const part = await resolvePartByNumber(db, partNumber);
                if (!part) {
                    return { kind: "failed", code: "PART_NOT_FOUND", message: `No Part "${partNumber}" exists.` };
                }
                const warehouseId = await resolveActiveWarehouseIdByName(db, warehouseName);
                if (!warehouseId) {
                    return {
                        kind: "failed",
                        code: "WAREHOUSE_NOT_FOUND",
                        message: `No ACTIVE warehouse named "${warehouseName}" exists.`,
                    };
                }
                const outcome = await db.runTransaction(async (txn) => (0, openingInventoryBalance_js_1.applyOpeningInventoryBalanceThroughTxn)(txn, db, {
                    importJobId,
                    // The pipeline's key already encodes (job, row), so a re-run of the same file
                    // keys identically without this needing its own scheme.
                    sourceRowKey: idempotencyKey,
                    partId: part.partId,
                    trackingMode: part.trackingMode,
                    location: { type: inventoryImportContract_js_1.OPENING_BALANCE_LOCATION_TYPE, locationId: warehouseId },
                    openingQuantity: Number(draft.openingQuantity ?? 0),
                    actorUid,
                    occurredAt: Date.now(),
                }, { now: new Date() }));
                // "no-movement" is a zero balance: nothing was written because nothing moved, and a
                // movement that moves nothing is not a movement. Counted as `replayed` because that is
                // this pipeline's word for "the write was correctly a no-op" -- reporting it as
                // created would put a movement in the history that does not exist.
                if (outcome.outcome === "no-movement")
                    return { kind: "replayed" };
                return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
            }
            catch (err) {
                if (err instanceof openingInventoryBalance_js_1.OpeningBalanceError) {
                    const message = err.code === "OPENING_BALANCE_ALREADY_SET"
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
async function resolvePartByNumber(db, internalPartNumber) {
    // BY THE DERIVED ID FIRST: that is where an imported Part lives, and it costs one read.
    const derived = await db.collection(partMasterRepository_js_1.PARTS_COLLECTION).doc((0, partImportContract_js_1.derivePartId)(internalPartNumber)).get();
    const doc = derived.exists
        ? derived
        : // Then by query, because a Part created through the Part Master screens carries an id
            // nobody derived, and inventory must be importable against those too.
            (await db
                .collection(partMasterRepository_js_1.PARTS_COLLECTION)
                .where("internalPartNumber", "==", internalPartNumber.trim())
                .limit(2)
                .get()).docs[0];
    if (!doc || !doc.exists)
        return null;
    const data = doc.data() ?? {};
    return {
        partId: String(data.partId ?? doc.id),
        trackingMode: (0, controlTypeTrackingMode_js_1.controlTypeToTrackingMode)(String(data.controlType ?? "STANDARD")),
    };
}
async function resolveActiveWarehouseIdByName(db, name) {
    const snap = await db.collection(collections_js_1.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get();
    const wanted = (0, entityContract_js_1.naturalIdentityKey)(name);
    const matches = snap.docs.filter((d) => (0, entityContract_js_1.naturalIdentityKey)(String((d.data() ?? {}).name ?? "")) === wanted);
    // Two ACTIVE warehouses with one name is a question, not a resolution.
    return matches.length === 1 ? matches[0].id : null;
}
//# sourceMappingURL=firestoreInventoryImportAdapters.js.map
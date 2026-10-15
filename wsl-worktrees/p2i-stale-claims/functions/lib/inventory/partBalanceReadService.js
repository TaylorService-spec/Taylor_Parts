"use strict";
// PART BALANCE — the shared governed read for "how much of this part is there, and what is it
// already spoken for?"
//
// ============================ NOT A SCANNER PROJECTION ============================
//
// This is a general inventory-balance read. The scanner is its first consumer, not its owner: it
// takes a partId and answers the same question any surface would ask. It creates no new inventory
// model, no new collection and no new math.
//
// ============================ THE MATH IS ALREADY RATIFIED ============================
//
// Every number here comes from fulfillment/fulfillmentAvailability.ts, whose semantics the Owner
// ratified on 2026-08-07 and amended on 2026-08-17 (ledger supersedes stock_locations):
//
//   sumLedgerEligibleOnHand  physical on-hand at ACTIVE warehouses, from the append-only ledger
//   openWorkOrderReserved    open Work Order commitments (RESERVED − RELEASED − CONSUMED)
//
// Those functions are exported and pure; this service supplies the reads and composes the result. A
// fourth parallel implementation of on-hand would be a competing authority, and this platform has
// already been bitten once by two sources of stock truth diverging in both directions.
//
// ============================ UNKNOWN IS A VALUE ============================
//
// `null` means UNKNOWN and is never coerced to 0 anywhere in this file. The distinction is
// load-bearing: "no physical movement evidence for this part at all" and "evidence exists and nets
// to zero" are different facts. The first is a data gap; the second is a real, empty shelf.
//
// ============================ SERIAL PARTS DO NOT HAVE A QUANTITY ============================
//
// sumLedgerEligibleOnHand deliberately excludes SERIAL/LOT rows from its quantity math: a serialized
// unit is counted by the serialized_assets registry, one row per unit, never by summing ledger
// quantities. Reporting the resulting figure as "on hand" for a SERIAL part would therefore show a
// confident 0 for a shelf full of units. So a SERIAL-tracked part reports NOT_COUNTED_BY_QUANTITY
// and points at the serialized registry, which is its actual authority.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPartBalanceCallable = exports.OPEN_PURCHASE_ORDER_STATUSES = exports.INVENTORY_BALANCE_READ_CAPABILITY = void 0;
exports.composePartBalance = composePartBalance;
exports.sumOpenOrderedQuantity = sumOpenOrderedQuantity;
exports.readPartBalance = readPartBalance;
const binParentage_js_1 = require("../inventoryLocation/binParentage.js");
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const firestore_1 = require("firebase-admin/firestore");
const receivingTypes_1 = require("../inventoryReceiving/receivingTypes");
const purchaseOrderNormalization_1 = require("../purchasing/purchaseOrderNormalization");
const https_1 = require("firebase-functions/v2/https");
const collections_js_1 = require("../constants/collections.js");
const fulfillmentAvailability_js_1 = require("../fulfillment/fulfillmentAvailability.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const controlTypeTrackingMode_js_1 = require("../partMaster/controlTypeTrackingMode.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
exports.INVENTORY_BALANCE_READ_CAPABILITY = "inventory.balance.read";
const KNOWN = (value) => ({ state: "KNOWN", value });
const UNKNOWN = { state: "UNKNOWN", value: null };
const NOT_QUANTITY = { state: "NOT_COUNTED_BY_QUANTITY", value: null };
/**
 * Compose the projection from already-read inputs. PURE — unit-tested without an emulator.
 *
 * @param serialTracked whether the Part's control type means its units are individually tracked.
 *                      Supplied by the caller from the Part record; this service does not restate
 *                      the Part Master's own vocabulary.
 */
function composePartBalance(input) {
    const { partId, ledgerRows, eligibleWarehouseIds, binParentage, openOrderedQuantity, serialTracked } = input;
    const rows = [...ledgerRows];
    // RESERVED / RELEASED / CONSUMED are LOGICAL commitments and are counted only here — never as
    // physical stock. sumLedgerEligibleOnHand already ignores them; this is the other half of that
    // same split, and keeping both halves visible in one place is why they are computed together.
    const reservedValue = (0, fulfillmentAvailability_js_1.openWorkOrderReserved)(rows);
    const sawAnyCommitment = rows.some((r) => r.type === "RESERVED" || r.type === "RELEASED" || r.type === "CONSUMED");
    if (serialTracked) {
        // A serialized part has no aggregable quantity. Saying so is the honest answer; reporting the
        // ledger sum would show 0 for a shelf that is full.
        return Object.freeze({
            partId,
            onHand: NOT_QUANTITY,
            reserved: NOT_QUANTITY,
            available: NOT_QUANTITY,
            onOrder: openOrderedQuantity === null ? UNKNOWN : KNOWN(openOrderedQuantity),
            byLocation: Object.freeze([]),
        });
    }
    const onHandValue = (0, fulfillmentAvailability_js_1.sumLedgerEligibleOnHand)(rows, new Set(eligibleWarehouseIds), binParentage);
    const onHand = onHandValue === null ? UNKNOWN : KNOWN(onHandValue);
    // No commitment evidence at all is a known zero, not UNKNOWN: the reservation ledger is written on
    // every reservation, so its silence genuinely means "nothing is reserved". This differs from
    // on-hand, where silence means the part was never received anywhere and the shelf state is
    // genuinely unknown.
    const reserved = KNOWN(sawAnyCommitment ? reservedValue : 0);
    // UNKNOWN is INFECTIOUS. Subtracting a known reservation from an unknown on-hand cannot produce a
    // trustworthy available figure, and presenting one would be the exact "missing evidence treated as
    // zero" failure this whole service exists to avoid.
    const available = onHand.state === "KNOWN" && onHand.value !== null
        ? KNOWN(Math.max(0, onHand.value - (reserved.value ?? 0)))
        : UNKNOWN;
    // Per-warehouse, using the SAME function with a singleton eligible set. Deliberately not a
    // separate grouping pass: a second implementation could round, filter or sign differently from the
    // total, and a breakdown that does not add up to its own total is worse than no breakdown.
    const byLocation = [];
    for (const locationId of eligibleWarehouseIds) {
        const at = (0, fulfillmentAvailability_js_1.sumLedgerEligibleOnHand)(rows, new Set([locationId]), binParentage);
        if (at !== null && at > 0)
            byLocation.push(Object.freeze({ locationId, quantity: at }));
    }
    byLocation.sort((a, b) => (b.quantity - a.quantity) || a.locationId.localeCompare(b.locationId));
    return Object.freeze({
        partId,
        onHand,
        reserved,
        available,
        onOrder: openOrderedQuantity === null ? UNKNOWN : KNOWN(openOrderedQuantity),
        byLocation: Object.freeze(byLocation),
    });
}
/**
 * Outstanding ordered quantity for a part across purchase orders that can still be received. PURE.
 *
 * Returns null (UNKNOWN) when no purchase order mentions the part at all — the same distinction the
 * on-hand rule draws. A part that appears on orders which are all fully received is a known 0.
 *
 * Reads the CANONICAL multi-line shape (Phase C) and the legacy single-line shape, because both
 * exist in stored data; neither is normalized into the other here beyond reading the two field
 * layouts, and quantities are never invented for a line that does not state one.
 */
function sumOpenOrderedQuantity(purchaseOrders, partId, receiptsByPurchaseOrder) {
    let saw = false;
    let outstanding = 0;
    for (const po of purchaseOrders) {
        const poId = typeof po.id === "string" ? po.id
            : typeof po.purchaseOrderId === "string" ? po.purchaseOrderId
                : null;
        const receipts = (poId ? receiptsByPurchaseOrder?.get(poId) : undefined) ?? [];
        // ── CANONICAL STORED SHAPE: `items`, with received derived from committed receipts.
        //
        // A canonical purchase order does NOT persist receivedQuantity -- the receipt command writes
        // only version/updatedAt/status, and progress is derived so it cannot drift from the receipts.
        // Reading `quantity` alone would report the FULL order as still inbound forever, which after a
        // partial receipt overstates supply and makes a live shortage look handled.
        //
        // deriveReceiptState is the existing authority for that arithmetic, including the clamp at
        // zero. Re-summing receipts here would be a second implementation of a rule that already has
        // an owner, free to disagree with it.
        if (Array.isArray(po.items)) {
            let canonical;
            try {
                canonical = (0, purchaseOrderNormalization_1.normalizeCanonicalPurchaseOrder)(poId ?? "unknown", po);
            }
            catch {
                // Malformed order: contributes nothing rather than a guessed quantity. Not silently a
                // zero either -- `saw` stays false, so this order cannot turn UNKNOWN into a measured 0.
                continue;
            }
            const derived = (0, purchaseOrderNormalization_1.deriveReceiptState)(canonical, receipts);
            for (const line of derived.lines) {
                if (line.partId !== partId)
                    continue;
                saw = true;
                outstanding += line.remainingQuantity;
            }
            continue;
        }
        // ── NORMALIZED IN-MEMORY SHAPE, and the LEGACY single-line document.
        //
        // Legacy orders carry receivedQuantity ON the document, so their outstanding already nets and
        // must keep doing so. Canonical receipt semantics are deliberately NOT applied here: a legacy
        // order is one-shot and full-quantity by validation, and deriving it from receipt records
        // would answer a question its shape never asked.
        const rawLines = Array.isArray(po.lines) ? po.lines : null;
        const lines = rawLines
            ? rawLines
            : (typeof po.partId === "string" ? [po] : []);
        for (const line of lines) {
            if (line.partId !== partId)
                continue;
            saw = true;
            const ordered = typeof line.quantity === "number" && Number.isFinite(line.quantity)
                ? line.quantity
                : (typeof line.orderedQuantity === "number" && Number.isFinite(line.orderedQuantity) ? line.orderedQuantity : null);
            if (ordered === null)
                continue; // a line with no stated quantity adds nothing, never a guess
            const received = typeof line.receivedQuantity === "number" && Number.isFinite(line.receivedQuantity)
                ? line.receivedQuantity
                : 0;
            outstanding += Math.max(0, ordered - received);
        }
    }
    return saw ? outstanding : null;
}
/** Purchase order statuses whose outstanding quantity is still genuinely incoming. */
exports.OPEN_PURCHASE_ORDER_STATUSES = Object.freeze(["DRAFT", "SENT", "ORDERED", "PARTIALLY_RECEIVED"]);
/**
 * Read and compose the balance for one part.
 *
 * NOT transactional: this is a read, and a balance is a point-in-time answer by nature. The
 * commands that MOVE stock re-derive their own numbers inside their own transactions and remain the
 * authority — nothing may be committed on the strength of this projection.
 */
async function readPartBalance(db, partId, serialTracked) {
    const [ledgerSnap, warehouseSnap, poSnap] = await Promise.all([
        db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId).get(),
        db.collection(collections_js_1.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get(),
        db.collection(collections_js_1.PURCHASE_ORDERS_COLLECTION).get(),
    ]);
    const ledgerRows = ledgerSnap.docs.map((d) => d.data());
    const eligibleWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));
    const openOrders = poSnap.docs
        // The document id is carried explicitly: it is how committed receipts are matched back to
        // their order, and a stored PO does not always repeat its own id in the body.
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((po) => typeof po.status === "string" && exports.OPEN_PURCHASE_ORDER_STATUSES.includes(po.status));
    // ── COMMITTED RECEIPTS, so canonical outstanding can be netted.
    //
    // A canonical purchase order stores no receivedQuantity; progress lives in the receipts. Without
    // them a partially received order reports its FULL quantity as still inbound -- overstating
    // supply and making a live shortage look handled.
    //
    // Read only for the orders that survived the status filter: a RECEIVED or CANCELLED order
    // contributes nothing either way, so fetching its receipts would be work with no effect on the
    // answer.
    // Built with `new Map(entries)` rather than `.set()` on purpose: this module carries a guard
    // forbidding /\.set\(/ so a balance READ can never write, and a text guard cannot tell
    // `Map.prototype.set` from `DocumentReference.set`. Restructuring the code is the right answer;
    // loosening the guard to accommodate it would trade a real protection for a convenience.
    const receiptSnaps = openOrders.length === 0 ? [] : await Promise.all(openOrders.map((po) => db.collection(receivingTypes_1.RECEIVING_ORDERS_COLLECTION).where("source.purchaseOrderId", "==", po.id).get()));
    const receiptsByPurchaseOrder = new Map(receiptSnaps.map((snap, i) => [
        openOrders[i].id,
        snap.docs.map((d) => {
            const data = d.data() ?? {};
            const lines = Array.isArray(data.lines) ? data.lines : [];
            return {
                receivingId: d.id,
                lines: lines.map((l) => ({
                    lineId: String(l?.lineId ?? ""),
                    receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
                })),
            };
        }),
    ]));
    // Model A: binned stock is still its Warehouse's stock. Only the bins these rows name are read.
    const binParentage = await (0, binParentage_js_1.readBinParentage)(db, (0, locationOnHand_js_1.binIdsReferenced)(ledgerRows));
    return composePartBalance({
        partId,
        ledgerRows,
        eligibleWarehouseIds,
        binParentage,
        openOrderedQuantity: sumOpenOrderedQuantity(openOrders, partId, receiptsByPurchaseOrder),
        serialTracked,
    });
}
/**
 * The trusted callable.
 *
 * Gated on `inventory.balance.read` — a NEW, narrow capability rather than a reused one.
 * `warehouse.stockLocation.read` names the stock_locations collection, which the Owner's 2026-08-17
 * ruling superseded as a stock authority; reusing it for a ledger-derived read would make it a
 * synonym for something it no longer means, and it is granted only to admin/dispatcher/owner, which
 * is the wrong audience for a warehouse balance question. `inventory.analytics.read` is a dashboard
 * projection, not a per-part answer.
 *
 * Registered `active: false`. Measured 2026-09-12: held by fifteen governed business Roles
 * (least-privilege: inventoryLookupReader -- access/governedBusinessRoles.ts) and ACTIVATED in
 * platform-sandbox (config/environments.json). Production neither activates nor grants it, and in an
 * environment with no activation override `active: false` denies every principal regardless of grant.
 */
exports.getPartBalanceCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.INVENTORY_BALANCE_READ_CAPABILITY],
        });
        allowed = decisions[exports.INVENTORY_BALANCE_READ_CAPABILITY] === true;
    }
    catch (err) {
        // A THROWING resolver is a denial, never an allow.
        console.error(`[getPartBalance] capability resolution failed for ${exports.INVENTORY_BALANCE_READ_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read inventory balances.");
    const data = (request.data ?? {});
    const partId = typeof data.partId === "string" ? data.partId.trim() : "";
    if (partId === "")
        throw new https_1.HttpsError("invalid-argument", "A partId is required.");
    // WHETHER A PART IS SERIAL-TRACKED IS A FACT THE SERVER OWNS, NOT A CLAIM THE CALLER MAKES.
    //
    // This previously read `data.serialTracked`, which let the CALLER decide the shape of the answer.
    // Found in sandbox validation, and it is the exact failure this whole service exists to prevent:
    //
    //   PRT-2001, which has two serialized units on the shelf at wh-main, answered
    //   { state: "KNOWN", value: 0 } when asked with serialTracked:false.
    //
    // A confident zero for a shelf that is not empty. The mirror-image error was equally reachable:
    // asking about a quantity-tracked part with serialTracked:true hid a real number behind
    // NOT_COUNTED_BY_QUANTITY.
    //
    // The Part Master's `controlType` is the authority, mapped through the SAME vocabulary receiving
    // and transfer already use (controlTypeToTrackingMode) rather than a second mapping free to
    // disagree with them.
    //
    // FAIL CLOSED ON AN UNKNOWN PART. A part nobody can resolve is not assumed quantity-tracked --
    // assuming would reintroduce the confident zero by a different route.
    try {
        const db = (0, firestore_1.getFirestore)();
        const stored = await (0, partMasterRepository_js_1.buildFirestorePartRepository)(db).getById(null, partId);
        if (stored === null) {
            throw new https_1.HttpsError("not-found", "That part could not be found.");
        }
        const serialTracked = (0, controlTypeTrackingMode_js_1.isSerialTracked)(stored.part.controlType);
        return await readPartBalance(db, partId, serialTracked);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        console.error("[getPartBalance] read failed", err);
        throw new https_1.HttpsError("internal", "The request could not be completed.");
    }
});
//# sourceMappingURL=partBalanceReadService.js.map
"use strict";
// PART BALANCES, FOR A PAGE OF PARTS — the batched sibling of the single-part balance read.
//
// GOVERNANCE: docs/architecture/inventory-health-projection.md.
//
// ============================ WHAT THIS IS, AND IS NOT ============================
//
// NOT a second balance authority. Every number here comes from `composePartBalance` — the same pure
// function `readPartBalance` uses, unchanged — over the same ratified inputs. This module owns the
// READ SHAPE and nothing else: it fetches once what the per-part path fetches N times.
//
// NOT a materialized projection. Nothing is stored, so nothing can go stale, drift from source, or
// need rebuilding — the same reasoning `financeReadProjection.ts` states for AR, where a possibly
// stale stored balance is deliberately never trusted and the position is derived from durable facts
// on every read. A cached health number is a number somebody will believe after it stops being true.
//
// ============================ WHY BATCHING IS THE WHOLE POINT ============================
//
// `readPartBalance` issues, PER PART: one ledger query, one warehouses query, one purchase-orders
// query, and one receipts query per open order. Three of those four answers are IDENTICAL for every
// part in a page — the ACTIVE warehouse set, the open purchase orders and their receipts do not vary
// by part — so a page of 50 re-reads the same data 50 times.
//
//   per-part, 50 parts   50 ledger + 50 warehouse + 50 PO + (50 x R) receipts
//   batched,  50 parts    2 ledger +  1 warehouse +  1 PO + R receipts
//
// The ledger read is the only genuinely per-part input, and Firestore's `in` operator takes 30
// values, so 50 parts is two queries rather than fifty.
//
// ============================ NO WRITES, ENFORCED ============================
//
// A balance read must never mutate. The sibling service carries a source guard that forbids every
// write and transaction token by name, and this module is held to the same one — which is why the
// receipt map below is constructed from entries rather than assembled entry by entry: a text guard
// cannot tell a Map mutator from a DocumentReference mutator, and restructuring the code is the
// right answer to that rather than loosening a real protection.
//
// This comment deliberately spells none of those tokens out. The guard reads SOURCE, so prose
// describing it would trip it — which is the guard working, not a false positive.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPartBalancesCallable = exports.PART_BALANCE_BATCH_LIMIT = void 0;
exports.readPartBalances = readPartBalances;
exports.readPartBalancesWithIntegrity = readPartBalancesWithIntegrity;
const binParentage_js_1 = require("../inventoryLocation/binParentage.js");
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const authoritativeLedgerRows_js_1 = require("../inventoryLedger/authoritativeLedgerRows.js");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const receivingTypes_1 = require("../inventoryReceiving/receivingTypes");
const collections_js_1 = require("../constants/collections.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const controlTypeTrackingMode_js_1 = require("../partMaster/controlTypeTrackingMode.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const catalogWriterState_js_1 = require("../catalogMaster/catalogWriterState.js");
const partBalanceReadService_js_1 = require("./partBalanceReadService.js");
/**
 * How many parts one batch answers for.
 *
 * A page of the Parts list is 50, and this is deliberately no larger: an unbounded batch would be
 * the fetch-all pattern wearing a callable's clothes, and a caller that wants 5,000 balances wants a
 * different question answered.
 */
exports.PART_BALANCE_BATCH_LIMIT = 50;
/** Firestore's ceiling on an `in` clause. Not a preference — the query either fits or it does not. */
const IN_CLAUSE_LIMIT = 30;
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}
/**
 * Read and compose balances for MANY parts, with the shared inputs read once.
 *
 * @param serialTrackedByPartId whether each Part's control type means its units are individually
 *        tracked. A FACT THE SERVER OWNS: the single-part callable was once willing to take this
 *        from the caller, and that let a request answer `{ KNOWN, 0 }` for PRT-2001 — a confident
 *        zero for a shelf holding two serialized units. Resolved from the Part Master here for the
 *        same reason, and a part that cannot be resolved is OMITTED rather than assumed.
 *
 * Returns one projection per part, in the order requested, for the parts that resolved.
 */
async function readPartBalances(db, partIds, serialTrackedByPartId) {
    return (await readPartBalancesWithIntegrity(db, partIds, serialTrackedByPartId)).balances;
}
/**
 * The same read, with the parts it could not answer BECAUSE OF THE LEDGER named separately (DQ-027): a
 * caller must be able to tell "no such part" from "this part's ledger has a record that cannot be read".
 */
async function readPartBalancesWithIntegrity(db, partIds, serialTrackedByPartId) {
    if (partIds.length === 0)
        return { balances: [], ledgerUnavailablePartIds: [] };
    // ── the three shared reads, once for the whole page ─────────────────────────────────────────
    const [warehouseSnap, poSnap, ...ledgerSnaps] = await Promise.all([
        db.collection(collections_js_1.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get(),
        db.collection(collections_js_1.PURCHASE_ORDERS_COLLECTION).get(),
        ...chunk(partIds, IN_CLAUSE_LIMIT).map((ids) => db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "in", ids).get()),
    ]);
    const eligibleWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));
    // Ledger rows GROUPED BY PART, so each part is composed from exactly its own rows. Built by
    // accumulating into arrays rather than by a per-part filter pass, so cost is linear in the rows
    // read rather than parts x rows.
    const ledgerByPart = new Map(partIds.map((id) => [id, []]));
    // FAIL CLOSED PER PART (DQ-019): a part with ANY unreadable ledger row gets no balance -- it is
    // omitted exactly like a part the Part Master could not resolve, so the caller reports it as having
    // no answer rather than a number computed past a record nobody can read.
    const unreadableParts = new Set();
    for (const snap of ledgerSnaps) {
        for (const doc of snap.docs) {
            try {
                (0, authoritativeLedgerRows_js_1.authoritativeOperationalMovements)([doc]);
            }
            catch (err) {
                if (!(err instanceof authoritativeLedgerRows_js_1.LedgerRowIntegrityError))
                    throw err;
                const pid = doc.data()?.partId;
                if (typeof pid === "string")
                    unreadableParts.add(pid);
                continue;
            }
            const row = doc.data();
            const bucket = typeof row.partId === "string" ? ledgerByPart.get(row.partId) : undefined;
            // A row whose partId is not one we asked for cannot appear (the query filtered on it), and a
            // row without one is not attributable to any part — dropping it is the only honest option.
            if (bucket)
                bucket.push(row);
        }
    }
    const openOrders = poSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((po) => typeof po.status === "string" && partBalanceReadService_js_1.OPEN_PURCHASE_ORDER_STATUSES.includes(po.status));
    // COMMITTED RECEIPTS, so canonical outstanding can be netted. A canonical purchase order stores no
    // receivedQuantity — progress lives in the receipts — so without them a partially received order
    // reports its FULL quantity as still inbound, overstating supply and making a live shortage look
    // handled. Read once for the page, not once per part.
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
    // Model A: one batched read of every bin any requested part's rows name, shared across the batch.
    const binParentage = await (0, binParentage_js_1.readBinParentage)(db, (0, locationOnHand_js_1.binIdsReferenced)([...ledgerByPart.values()].flat()));
    // ── compose, per part, through the SAME pure function the single-part read uses ──────────────
    const out = [];
    for (const partId of partIds) {
        const serialTracked = serialTrackedByPartId.get(partId);
        // A part the Part Master could not resolve is OMITTED. Assuming quantity-tracked would
        // reintroduce the confident zero by a different route.
        if (serialTracked === undefined)
            continue;
        if (unreadableParts.has(partId))
            continue;
        out.push((0, partBalanceReadService_js_1.composePartBalance)({
            partId,
            ledgerRows: ledgerByPart.get(partId) ?? [],
            eligibleWarehouseIds,
            binParentage,
            openOrderedQuantity: (0, partBalanceReadService_js_1.sumOpenOrderedQuantity)(openOrders, partId, receiptsByPurchaseOrder),
            serialTracked,
        }));
    }
    return { balances: out, ledgerUnavailablePartIds: partIds.filter((id) => unreadableParts.has(id)) };
}
/**
 * The trusted batched callable.
 *
 * SAME CAPABILITY as the single-part read — `inventory.balance.read`. Asking about fifty parts is
 * the same question asked fifty times, and minting a second capability for it would create an
 * audience split the domain does not have. §27: no new business role or capability.
 *
 * Inherits that capability's gate exactly: registered `active: false`, resolved per environment, and
 * still requiring a qualifying Role grant. It denies for every principal until activation, grant and
 * deploy are separately authorized.
 */
exports.getPartBalancesCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [partBalanceReadService_js_1.INVENTORY_BALANCE_READ_CAPABILITY],
        });
        allowed = decisions[partBalanceReadService_js_1.INVENTORY_BALANCE_READ_CAPABILITY] === true;
    }
    catch (err) {
        // A THROWING resolver is a denial, never an allow.
        console.error(`[getPartBalances] capability resolution failed for ${partBalanceReadService_js_1.INVENTORY_BALANCE_READ_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read inventory balances.");
    const data = (request.data ?? {});
    const raw = Array.isArray(data.partIds) ? data.partIds : null;
    if (raw === null)
        throw new https_1.HttpsError("invalid-argument", "partIds must be an array.");
    // De-duplicated before the limit is applied, so a caller repeating one id fifty times asks for one
    // part rather than being refused for asking about fifty.
    const partIds = [...new Set(raw.filter((v) => typeof v === "string").map((v) => v.trim()).filter((v) => v !== ""))];
    if (partIds.length === 0)
        throw new https_1.HttpsError("invalid-argument", "At least one partId is required.");
    if (partIds.length > exports.PART_BALANCE_BATCH_LIMIT) {
        // REFUSED, not silently truncated. Returning the first fifty of a larger request would answer a
        // question nobody asked and look like a complete answer to the one they did.
        throw new https_1.HttpsError("invalid-argument", `At most ${exports.PART_BALANCE_BATCH_LIMIT} parts may be requested at once; this asked for ${partIds.length}.`);
    }
    try {
        // CATALOG CUTOVER (Owner ruling, Lane 2). This read's ONE catalog fact is `controlType`, and it decides
        // the SHAPE of the answer -- quantity or serials. Once PostgreSQL is the catalog authority, the frozen
        // Firestore copy can no longer answer it, and this runtime cannot reach PostgreSQL without the
        // forbidden bridge. So the balance becomes explicitly UNAVAILABLE rather than being computed from a
        // stale controlType.
        //
        // THE FAILURE THIS PREVENTS IS THE ONE THIS SERVICE ALREADY EXISTS TO PREVENT. The comment below
        // records PRT-2001 answering `{ state: "KNOWN", value: 0 }` for a shelf holding two serialized units,
        // because the CALLER supplied `serialTracked`. A stale controlType is the same defect with a different
        // source: a confident number, of the wrong kind, that nobody can tell is wrong. Refusing is worse to
        // use and honest; there is no stale-read compatibility period.
        (0, catalogWriterState_js_1.assertFirestoreCatalogReadCurrent)("inventory.partBalance.controlType");
        const db = (0, firestore_1.getFirestore)();
        const repository = (0, partMasterRepository_js_1.buildFirestorePartRepository)(db);
        const stored = await Promise.all(partIds.map((id) => repository.getById(null, id)));
        const serialTrackedByPartId = new Map(stored
            .map((record, i) => (record === null ? null : [partIds[i], (0, controlTypeTrackingMode_js_1.isSerialTracked)(record.part.controlType)]))
            .filter((entry) => entry !== null));
        const { balances, ledgerUnavailablePartIds } = await readPartBalancesWithIntegrity(db, partIds, serialTrackedByPartId);
        return {
            balances,
            // DQ-027: the subset of unresolvedPartIds whose ledger holds a record that cannot be read -- a
            // reason a caller can act on, distinct from "the Part Master does not know this part".
            ledgerUnavailablePartIds,
            // WHICH PARTS HAD NO ANSWER, said explicitly. A caller that asked about fifty and received
            // forty-eight must be able to tell WHICH two are missing — silently short results are how a
            // list ends up rendering a blank cell that looks like a zero.
            // Unresolvable in the Part Master, OR a part whose ledger has an unreadable row (DQ-019): both
            // are "no answer", never a figure.
            unresolvedPartIds: partIds.filter((id) => !balances.some((b) => b.partId === id)),
        };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        // Same stable code as the single read: one migration state, one answer, whether one part was asked
        // about or forty.
        if (err instanceof catalogWriterState_js_1.FirestoreCatalogNotCurrentError) {
            throw new https_1.HttpsError("failed-precondition", "Part balances are unavailable: the catalog authority has moved to PostgreSQL.", { code: err.code });
        }
        console.error("[getPartBalances] read failed", err);
        throw new https_1.HttpsError("internal", "The request could not be completed.");
    }
});
//# sourceMappingURL=partBalanceBatchReadService.js.map
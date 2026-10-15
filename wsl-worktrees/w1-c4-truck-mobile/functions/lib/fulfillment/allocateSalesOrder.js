"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateSalesOrder = exports.SALES_ORDER_FULFILL_CAPABILITY = void 0;
// Fulfillment — governed `allocateSalesOrder` command (Cycle 5 live). Computes AUTHORITATIVE availability from
// canonical read-only sources and records allocation ENTIRELY on the Sales Order (allocatedQty [+ selected
// serials]) inside a transaction — non-forking: no write to the WO-keyed inventory ledger or the Equipment
// authority; other active Sales Orders' commitments are netted so the same on-hand/serial is never
// double-allocated (SO-vs-SO races prevented by re-reading commitments in the transaction).
//
// Authorization = capability `salesOrder.fulfill`, resolved fail-closed via the trusted effective-access feed;
// registered active:false ⇒ DENY for everyone until a separate Owner grant. EXPORT != DEPLOY, REGISTER != GRANT.
//
// PARTS availability (Owner-ratified 2026-08-17, superseding the stock_locations rule): ledger-derived
// eligible physical ON_HAND (inventory_transactions at status==ACTIVE warehouses) − open
// WO reservations (inventory_transactions RESERVED−RELEASED−CONSUMED) − other active SO allocations. Missing
// on-hand evidence ⇒ UNKNOWN (never 0). SERVICE lines need no inventory ⇒ always allocatable.
//
// SERIALIZED EQUIPMENT availability is deliberately UNKNOWN / fail-closed in this slice: per Owner §3 a serial
// is allocatable only once EOS can establish company control + eligible location + operational eligibility +
// no active SO allocation + not installed/customer-custody + no active temporary-placement/loaner conflict.
// That equipment-availability CONTRACT (a confident read over the canonical `equipment` authority + the #12
// temporary-placement conflict seam) is the next slice; until it exists, equipment ⇒ UNKNOWN, fail closed.
const binParentage_js_1 = require("../inventoryLocation/binParentage.js");
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const allocationProjection_1 = require("./allocationProjection");
const fulfillmentAvailability_1 = require("./fulfillmentAvailability");
const equipmentAvailabilityContract_1 = require("./equipmentAvailabilityContract");
exports.SALES_ORDER_FULFILL_CAPABILITY = "salesOrder.fulfill";
const ACTIVE_SO_STATES = ["CONFIRMED", "IN_FULFILLMENT"];
async function requireFulfill(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.SALES_ORDER_FULFILL_CAPABILITY] });
        allowed = decisions[exports.SALES_ORDER_FULFILL_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[requireFulfill (allocateSalesOrder)] capability resolution failed for ${exports.SALES_ORDER_FULFILL_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to allocate Sales Orders.");
}
// Read the eligible physical ON_HAND for a part from the GOVERNED LEDGER (Owner-ratified 2026-08-17):
// physical movements at eligible (status==ACTIVE) warehouses. Returns null (UNKNOWN) when the part has no
// physical movement evidence. Reads the SAME inventory_transactions collection readOpenWoReserved() already
// uses, so sellable stock and open reservations are derived from one authority rather than two that drift.
async function readPartOnHand(tx, ref, eligibleWarehouseIds) {
    const db = (0, firestore_1.getFirestore)();
    const snap = await tx.get(db.collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", ref));
    const rows = snap.docs.map((d) => d.data());
    // Model A: stock put away into a Bin is still this Warehouse's stock. Resolve the parent of only the
    // bins these rows name, from their governed documents, inside the same transaction.
    const binParentage = await (0, binParentage_js_1.readBinParentage)(db, (0, locationOnHand_js_1.binIdsReferenced)(rows), tx);
    return (0, fulfillmentAvailability_1.sumLedgerEligibleOnHand)(rows, eligibleWarehouseIds, binParentage);
}
async function readOpenWoReserved(tx, ref, excludeWorkOrderIds) {
    const db = (0, firestore_1.getFirestore)();
    const snap = await tx.get(db.collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", ref));
    return (0, fulfillmentAvailability_1.openWorkOrderReserved)(snap.docs.map((d) => d.data()), excludeWorkOrderIds);
}
// The set of Work Order ids linked (via salesOrderId lineage) to an active Sales Order — their reservations
// are counted via the Sales Order allocation, not again here (C7 demand lineage). Chunked to respect the
// Firestore `in` limit.
async function readSalesOrderLinkedWorkOrderIds(tx, activeSoIds) {
    const db = (0, firestore_1.getFirestore)();
    const ids = new Set();
    for (let i = 0; i < activeSoIds.length; i += 30) {
        const chunk = activeSoIds.slice(i, i + 30);
        if (chunk.length === 0)
            continue;
        const snap = await tx.get(db.collection(collections_1.WORK_ORDERS_COLLECTION).where("salesOrderId", "in", chunk));
        for (const d of snap.docs)
            ids.add(d.id);
    }
    return ids;
}
exports.allocateSalesOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireFulfill(request.auth.uid);
    const salesOrderId = request.data?.salesOrderId;
    if (typeof salesOrderId !== "string" || salesOrderId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesOrderId is required.");
    }
    const db = (0, firestore_1.getFirestore)();
    const soRef = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(salesOrderId);
    try {
        const result = await db.runTransaction(async (tx) => {
            // ---- READS (all before any write) ----
            const soSnap = await tx.get(soRef);
            if (!soSnap.exists)
                throw new https_1.HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
            const so = soSnap.data();
            if (so.state !== "CONFIRMED" && so.state !== "IN_FULFILLMENT") {
                throw new https_1.HttpsError("failed-precondition", `Sales Order is ${so.state}; only CONFIRMED/IN_FULFILLMENT can be allocated.`);
            }
            const lines = Array.isArray(so.lines) ? so.lines : [];
            // Eligible ON_HAND pool = status==ACTIVE warehouses (trucks/mobile/customer are separate collections and
            // are naturally excluded from stock_locations).
            const whSnap = await tx.get(db.collection(collections_1.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE"));
            const eligibleWarehouseIds = new Set(whSnap.docs.map((d) => d.id));
            // Other active Sales Orders' commitments (netted so we never double-allocate).
            const activeSoSnap = await tx.get(db.collection(collections_1.SALES_ORDERS_COLLECTION).where("state", "in", [...ACTIVE_SO_STATES]));
            const otherSoLines = [];
            const activeSoIds = [];
            for (const d of activeSoSnap.docs) {
                activeSoIds.push(d.id);
                if (d.id === salesOrderId)
                    continue;
                const data = d.data();
                if (Array.isArray(data.lines))
                    otherSoLines.push(...data.lines);
            }
            // C7 demand lineage: WO reservations whose WO is linked to an active Sales Order are counted via that
            // SO's allocation, so exclude them from openWoReserved to avoid double-counting the same demand.
            const soLinkedWorkOrderIds = await readSalesOrderLinkedWorkOrderIds(tx, activeSoIds);
            // Availability per distinct ref.
            const availabilityByRef = {};
            const distinctPartRefs = [...new Set(lines.filter((l) => l.kind === "PART").map((l) => l.ref))];
            const distinctEquipRefs = [...new Set(lines.filter((l) => l.kind === "EQUIPMENT_MODEL").map((l) => l.ref))];
            for (const ref of distinctPartRefs) {
                const onHandEligible = await readPartOnHand(tx, ref, eligibleWarehouseIds);
                const openWoReserved = onHandEligible === null ? 0 : await readOpenWoReserved(tx, ref, soLinkedWorkOrderIds);
                const other = (0, fulfillmentAvailability_1.sumOtherSoCommitments)(otherSoLines, "PART", ref);
                // This SO's OWN prior allocation for this ref is also a live claim on the same physical on-hand pool
                // (stock_locations is never decremented for an SO allocation — see fulfillmentAvailability.ts). It must
                // be netted here too, or a re-run additively over-allocates against the same undiminished on-hand read.
                const self = (0, fulfillmentAvailability_1.sumOtherSoCommitments)(lines, "PART", ref);
                availabilityByRef[`PART:${ref}`] = (0, fulfillmentAvailability_1.computePartAvailability)({
                    onHandEligible,
                    openWoReserved,
                    otherSoAllocated: other.allocatedQty,
                    selfAllocated: self.allocatedQty,
                });
            }
            // Equipment availability via the governed contract (equipmentAvailabilityContract). Fail-closed UNKNOWN
            // today per the canonical-read assessment (availability substrate not-yet-connected + ordered-model↔serial
            // mapping unresolved + no #12 Temporary Placement authority); auto-activates when the substrate connects.
            for (const ref of distinctEquipRefs)
                availabilityByRef[`EQUIPMENT_MODEL:${ref}`] = (0, equipmentAvailabilityContract_1.readEquipmentAvailability)(ref);
            // SERVICE lines need no inventory ⇒ treat as fully available.
            const planLines = lines.map((l) => l.kind === "SERVICE" ? { ...l, __availability: { kind: "KNOWN", quantity: l.orderedQty } } : l);
            const plan = (0, allocationProjection_1.buildAllocationPlan)(planLines, Object.fromEntries(planLines.map((l) => [`${l.kind}:${l.ref}`, l.__availability ?? availabilityByRef[`${l.kind}:${l.ref}`] ?? { kind: "UNKNOWN" }])));
            // ---- WRITE (only the Sales Order; allocation is a commitment on the SO, netted by future ATP) ----
            // plan.lines is built by buildAllocationPlan as a 1:1, order-preserving map over `planLines` (itself a
            // 1:1 map over `lines`), so each SO line's own result lives at the SAME index. A bare find(ref+kind)
            // would return the FIRST matching plan-line for every line that shares a ref+kind — mis-writing every
            // sibling line with the first line's result (site-work allocatesalesorder-duplicate-ref-lines-double-
            // allocate). Map by position so each line gets ITS OWN plan-line result.
            const nextLines = lines.map((l, i) => {
                const alloc = plan.lines[i];
                const already = typeof l.allocatedQty === "number" ? l.allocatedQty : 0;
                return alloc ? { ...l, allocatedQty: already + alloc.allocatableQty } : l;
            });
            tx.update(soRef, {
                lines: nextLines,
                fulfillmentReadiness: plan.readiness,
                fulfillmentReadinessCounts: plan.counts,
                allocatedAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            return { readiness: plan.readiness, counts: plan.counts };
        });
        return { success: true, salesOrderId, ...result };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        throw new https_1.HttpsError("internal", "Allocation failed.");
    }
});
//# sourceMappingURL=allocateSalesOrder.js.map
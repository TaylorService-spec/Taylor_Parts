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
// PARTS availability (Owner-ratified): eligible ON_HAND (stock_locations at status==ACTIVE warehouses) − open
// WO reservations (inventory_transactions RESERVED−RELEASED−CONSUMED) − other active SO allocations. Missing
// on-hand evidence ⇒ UNKNOWN (never 0). SERVICE lines need no inventory ⇒ always allocatable.
//
// SERIALIZED EQUIPMENT availability is deliberately UNKNOWN / fail-closed in this slice: per Owner §3 a serial
// is allocatable only once EOS can establish company control + eligible location + operational eligibility +
// no active SO allocation + not installed/customer-custody + no active temporary-placement/loaner conflict.
// That equipment-availability CONTRACT (a confident read over the canonical `equipment` authority + the #12
// temporary-placement conflict seam) is the next slice; until it exists, equipment ⇒ UNKNOWN, fail closed.
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
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to allocate Sales Orders.");
}
// Read the eligible ON_HAND for a part: sum stock_locations.quantity for partId at eligible (status==ACTIVE)
// warehouses. Returns null (UNKNOWN) if the read yields no usable evidence. All reads via the transaction.
async function readPartOnHand(tx, ref, eligibleWarehouseIds) {
    const db = (0, firestore_1.getFirestore)();
    const snap = await tx.get(db.collection(collections_1.STOCK_LOCATIONS_COLLECTION).where("partId", "==", ref));
    return (0, fulfillmentAvailability_1.sumEligibleOnHand)(snap.docs.map((d) => d.data()), eligibleWarehouseIds);
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
                const other = (0, fulfillmentAvailability_1.sumOtherSoCommitments)(otherSoLines, ref);
                // This SO's OWN prior allocation for this ref is also a live claim on the same physical on-hand pool
                // (stock_locations is never decremented for an SO allocation — see fulfillmentAvailability.ts). It must
                // be netted here too, or a re-run additively over-allocates against the same undiminished on-hand read.
                const self = (0, fulfillmentAvailability_1.sumOtherSoCommitments)(lines, ref);
                availabilityByRef[ref] = (0, fulfillmentAvailability_1.computePartAvailability)({
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
                availabilityByRef[ref] = (0, equipmentAvailabilityContract_1.readEquipmentAvailability)(ref);
            // SERVICE lines need no inventory ⇒ treat as fully available.
            const planLines = lines.map((l) => l.kind === "SERVICE" ? { ...l, __availability: { kind: "KNOWN", quantity: l.orderedQty } } : l);
            const plan = (0, allocationProjection_1.buildAllocationPlan)(planLines, Object.fromEntries(planLines.map((l) => [l.ref, l.__availability ?? availabilityByRef[l.ref] ?? { kind: "UNKNOWN" }])));
            // ---- WRITE (only the Sales Order; allocation is a commitment on the SO, netted by future ATP) ----
            const nextLines = lines.map((l) => {
                const alloc = plan.lines.find((p) => p.ref === l.ref && p.kind === l.kind);
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
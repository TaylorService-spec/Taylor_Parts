"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceForSalesOrder = exports.ServiceAllocationGateError = exports.LineRefBuildError = exports.SALES_ORDER_SERVICE_CAPABILITY = void 0;
exports.assertServiceAllocationGate = assertServiceAllocationGate;
exports.buildLineRefsAndInventorySnapshot = buildLineRefsAndInventorySnapshot;
// Sales Order → Service/Dispatch seam (Cycle 7). Creates governed Service demand for a committed Sales Order
// by producing a Work Order through the EXISTING governed Work Order authority (createWorkOrderRecord, ADR-009)
// — the Sales Order NEVER authors Work Order state, technician/truck assignment, or the dispatch schedule
// directly. Dispatch/Scheduling then pick the Work Order up through their own governed surfaces.
//
// DEMAND LINEAGE (Owner C7 invariant): the created Work Order carries `salesOrderId` (+ line refs). Its parts
// reservations are therefore counted via the Sales Order's allocation, not double-counted (allocateSalesOrder
// excludes SO-linked WO reservations). The Sales Order records the resulting workOrderIds so the trace is
// bidirectional: SO line → allocation → Work Order → reservation/consumption.
//
// Authorization = capability `salesOrder.service`, resolved fail-closed via the trusted effective-access feed;
// registered active:false ⇒ DENY for everyone until a separate Owner grant. EXPORT != DEPLOY, REGISTER != GRANT.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const createWorkOrder_1 = require("../createWorkOrder");
const partMasterRepository_1 = require("../partMaster/partMasterRepository");
exports.SALES_ORDER_SERVICE_CAPABILITY = "salesOrder.service";
class LineRefBuildError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LineRefBuildError";
    }
}
exports.LineRefBuildError = LineRefBuildError;
class ServiceAllocationGateError extends Error {
    code;
    constructor(message) {
        super(message);
        this.code = "NOT_ALLOCATED";
        this.name = "ServiceAllocationGateError";
    }
}
exports.ServiceAllocationGateError = ServiceAllocationGateError;
// PURE, independently unit-testable (no Firestore/transaction) -- pass4 A-1 (BD-14, Owner-ratified "gate
// Service/WO on allocation"). A Work Order created before allocateSalesOrder.ts has EVER run would seed every
// PART line's qtyPlanned from unbacked demand (see buildLineRefsAndInventorySnapshot's header comment). Gate
// on `allocatedAt` (a Sales-Order-level field written by every allocateSalesOrder run) rather than requiring
// EVERY PART line to individually carry a nonzero allocatedQty, so a genuinely partially-allocated SO (some
// lines backordered at allocatedQty 0) can still create Service -- a backordered line simply seeds
// qtyPlanned=0, never orderedQty. SOs with zero PART lines skip this gate entirely (nothing to back).
function assertServiceAllocationGate(soLines, allocatedAt) {
    const hasPartLine = soLines.some((l) => l.kind === "PART");
    if (hasPartLine && !allocatedAt) {
        throw new ServiceAllocationGateError("Sales Order has PART line(s) that have not been allocated; run allocateSalesOrder before creating Service.");
    }
}
// PURE (Part Master resolution injected, exactly like setWorkOrderPartsPlan.ts's applyPartsPlan) --
// independently unit-testable without Firestore/a transaction. Builds P1.2's two derived artifacts from an
// SO's lines: the quantity+kind-bearing `salesOrderLineRefs` (every line) and the seeded `inventorySnapshot`
// (PART lines only, sku resolved from Part Master). Fail-closed: throws LineRefBuildError on any PART line
// whose ref does not resolve to a canonical Part / valid internalPartNumber -- never fabricates sku = partId.
//
// pass4 A-1 (BD-14): a PART line's seeded qtyPlanned is its `allocatedQty` ONLY -- never `allocatedQty ||
// orderedQty`. A backordered/unallocated line (allocatedQty 0) seeds qtyPlanned=0, so it can never be
// consumed/completed/credited against unbacked demand; only the Sales Order's OWN allocation authority
// (allocateSalesOrder) can turn that into a nonzero planned quantity. The caller (below) additionally gates
// Service creation on allocation having run at all when any PART line is present.
function buildLineRefsAndInventorySnapshot(soLines, resolvePart) {
    const lineRefs = [];
    const inventorySnapshot = [];
    for (const l of soLines) {
        const orderedQty = typeof l.orderedQty === "number" ? l.orderedQty : 0;
        const allocatedQty = typeof l.allocatedQty === "number" ? l.allocatedQty : 0;
        const lineId = typeof l.lineId === "string" && l.lineId.trim().length > 0 ? l.lineId : undefined;
        lineRefs.push({ ref: l.ref, kind: l.kind, orderedQty, allocatedQty, ...(lineId ? { lineId } : {}) });
        if (l.kind !== "PART")
            continue;
        const resolved = resolvePart(l.ref);
        if (!resolved.found) {
            throw new LineRefBuildError("PART_NOT_FOUND", `No canonical Part record for partId "${l.ref}".`);
        }
        if (!resolved.sku || resolved.sku.trim().length === 0) {
            throw new LineRefBuildError("SKU_UNRESOLVED", `Canonical Part "${l.ref}" has no valid internalPartNumber.`);
        }
        inventorySnapshot.push({
            partId: l.ref,
            sku: resolved.sku,
            qtyPlanned: allocatedQty,
            ...(lineId ? { lineId } : {}),
        });
    }
    return { lineRefs, inventorySnapshot };
}
exports.createServiceForSalesOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: request.auth.uid, permissionIds: [exports.SALES_ORDER_SERVICE_CAPABILITY] });
        allowed = decisions[exports.SALES_ORDER_SERVICE_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[createServiceForSalesOrder] capability resolution failed for ${exports.SALES_ORDER_SERVICE_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to create Service for Sales Orders.");
    const salesOrderId = request.data?.salesOrderId;
    if (typeof salesOrderId !== "string" || salesOrderId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesOrderId is required.");
    }
    const db = (0, firestore_1.getFirestore)();
    const soRef = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(salesOrderId);
    const year = new Date().getFullYear();
    const partsCol = db.collection(partMasterRepository_1.PARTS_COLLECTION);
    try {
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(soRef);
            if (!snap.exists)
                throw new https_1.HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
            const so = snap.data();
            if (so.state !== "CONFIRMED" && so.state !== "IN_FULFILLMENT") {
                throw new https_1.HttpsError("failed-precondition", `Sales Order is ${so.state}; only CONFIRMED/IN_FULFILLMENT can create Service.`);
            }
            if (!so.accountId)
                throw new https_1.HttpsError("failed-precondition", "Sales Order has no accountId (customer) to route Service to.");
            if (!so.locationId)
                throw new https_1.HttpsError("failed-precondition", "Sales Order has no delivery/service locationId; set one before creating Service.");
            // Idempotency: don't re-create Service if this SO already has a linked Work Order (C7 = one coordinated
            // Work Order per SO; C8 will assess per-equipment coordination).
            if (Array.isArray(so.serviceWorkOrderIds) && so.serviceWorkOrderIds.length > 0) {
                throw new https_1.HttpsError("failed-precondition", "Sales Order already has Service Work Order(s).");
            }
            const soLines = Array.isArray(so.lines) ? so.lines : [];
            try {
                assertServiceAllocationGate(soLines, so.allocatedAt);
            }
            catch (err) {
                if (err instanceof ServiceAllocationGateError) {
                    throw new https_1.HttpsError("failed-precondition", err.message);
                }
                throw err;
            }
            // P1.2: resolve PART lines against Part Master (all reads before any write, per Firestore transaction
            // rule) so the seeded inventorySnapshot carries a REAL canonical sku -- never sku = partId (mirrors
            // setWorkOrderPartsPlan.ts's fail-closed PART_NOT_FOUND/SKU_UNRESOLVED identity contract). EQUIPMENT_
            // MODEL/SERVICE lines never touch Part Master.
            const partRefIds = [...new Set(soLines.filter((l) => l.kind === "PART").map((l) => l.ref))];
            const partSnaps = await Promise.all(partRefIds.map((id) => tx.get(partsCol.doc(id))));
            const resolvedParts = new Map();
            partRefIds.forEach((id, i) => {
                const s = partSnaps[i];
                if (!s.exists) {
                    resolvedParts.set(id, { found: false, sku: null });
                }
                else {
                    const ipn = s.data().internalPartNumber;
                    resolvedParts.set(id, { found: true, sku: typeof ipn === "string" && ipn.trim().length > 0 ? ipn.trim() : null });
                }
            });
            let lineRefs;
            let inventorySnapshot;
            try {
                ({ lineRefs, inventorySnapshot } = buildLineRefsAndInventorySnapshot(soLines, (partId) => resolvedParts.get(partId) ?? { found: false, sku: null }));
            }
            catch (err) {
                if (err instanceof LineRefBuildError) {
                    throw new https_1.HttpsError("failed-precondition", `${err.code}: ${err.message}`);
                }
                throw err;
            }
            const wo = await (0, createWorkOrder_1.createWorkOrderRecord)(db, tx, {
                customerId: so.accountId,
                locationId: so.locationId,
                priority: 3,
                // THE COMPLAINT IS READ BY A TECHNICIAN, so it names the Sales Order the way a person
                // does. This interpolated the DOCUMENT ID, and that string is stored — so every Work
                // Order created this way carries a Firestore key in its visible job description, which is
                // where the raw ids on /service/job-assignments come from. DECISIONS #106 applies to
                // written text as much as to a rendered field: the id was never the order's name.
                //
                // The reference is on the Sales Order this command already read. Falls back to the plain
                // sentence — never to the id — for an order predating numbering, because a job
                // description that names nothing is better than one that names a routing key.
                complaint: so.salesOrderNumber
                    ? `Sales Order ${so.salesOrderNumber} fulfillment: deliver/install ordered items`
                    : "Sales Order fulfillment: deliver/install ordered items",
                salesOrderId,
                salesOrderLineRefs: lineRefs,
                inventorySnapshot,
            }, year);
            tx.update(soRef, {
                state: "IN_FULFILLMENT",
                serviceWorkOrderIds: firestore_1.FieldValue.arrayUnion(wo.id),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            return { workOrderId: wo.id, woNumber: wo.woNumber };
        });
        return { success: true, salesOrderId, ...result };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        throw new https_1.HttpsError("internal", "Create Service for Sales Order failed.");
    }
});
//# sourceMappingURL=createServiceForSalesOrder.js.map
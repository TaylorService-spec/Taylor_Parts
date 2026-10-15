"use strict";
// Canonical purchase-order RECEIVING PROGRESS — trusted read.
//
// WHY THIS HAS TO BE A CALLABLE. `purchase_orders` is client-readable (firestore.rules:1272,
// isAdminOrDispatcher), so a browser could list the ordered lines itself. What it cannot do is derive
// what REMAINS: that is the sum of committed receipts, and `receiving_orders` is deny-all to every
// client by design. Without a trusted read the scanning surface could show what was ordered and never
// what is still outstanding — which is the one number the whole reconciliation is about.
//
// NO NEW CAPABILITY, AND NO NEW AUTHORITY. Gated on `inventory.stock.receive`, the capability that
// already governs receiving: the people who may take a receipt are exactly the people who need to see
// what is outstanding on it. Derivation reuses the same pure normalizer and receipt fold the command
// uses (purchasing/purchaseOrderNormalization.ts), so the number this read shows and the number the
// command enforces cannot disagree.
//
// READ-ONLY. No transaction, no write, no counter, no lifecycle change. A read does not need the
// concurrency anchor the command uses, because it decides nothing — the command re-derives inside its
// own transaction and is the authority. What this returns is a true statement about committed state
// at read time, which is exactly what a scanning operator needs and no more than it can promise.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECEIVABLE_LIST_LIMIT = exports.PurchaseOrderProgressInvalidError = exports.PurchaseOrderProgressNotFoundError = void 0;
exports.readPurchaseOrderProgress = readPurchaseOrderProgress;
exports.listReceivablePurchaseOrders = listReceivablePurchaseOrders;
const purchaseOrderNormalization_js_1 = require("../purchasing/purchaseOrderNormalization.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const receivingSourceResolver_js_1 = require("./receivingSourceResolver.js");
class PurchaseOrderProgressNotFoundError extends Error {
}
exports.PurchaseOrderProgressNotFoundError = PurchaseOrderProgressNotFoundError;
class PurchaseOrderProgressInvalidError extends Error {
}
exports.PurchaseOrderProgressInvalidError = PurchaseOrderProgressInvalidError;
/**
 * Read one canonical purchase order and its committed receipt progress.
 *
 * The receipts query is a single-field equality (`source.purchaseOrderId`) with no ordering, exactly
 * as the command's derivation is — so it needs no composite index, and adding one remains a boundary
 * this slice does not cross.
 */
async function readPurchaseOrderProgress(db, purchaseOrderId, resolveTrackingMode) {
    if (typeof purchaseOrderId !== "string" || purchaseOrderId.trim() === "") {
        throw new PurchaseOrderProgressInvalidError("purchaseOrderId is required");
    }
    const snap = await db.collection(receivingSourceResolver_js_1.CANONICAL_PURCHASE_ORDERS_COLLECTION).doc(purchaseOrderId).get();
    // FAIL CLOSED, and no fallback to the legacy collection -- the same rule the command's resolver
    // follows. A caller addressing the canonical authority gets the canonical answer or nothing.
    if (!snap.exists)
        throw new PurchaseOrderProgressNotFoundError("purchase order not found");
    const data = snap.data() ?? {};
    let canonical;
    try {
        canonical = (0, purchaseOrderNormalization_js_1.normalizeCanonicalPurchaseOrder)(purchaseOrderId, data);
    }
    catch (err) {
        if (err instanceof purchaseOrderNormalization_js_1.PurchaseOrderNormalizationError) {
            throw new PurchaseOrderProgressInvalidError(`purchase order invalid: ${err.code}`);
        }
        throw err;
    }
    const receiptsSnap = await db
        .collection(receivingTypes_js_1.RECEIVING_ORDERS_COLLECTION)
        .where("source.purchaseOrderId", "==", purchaseOrderId)
        .get();
    const receipts = receiptsSnap.docs.map((d) => {
        const r = d.data() ?? {};
        const lines = Array.isArray(r.lines) ? r.lines : [];
        return {
            receivingId: d.id,
            lines: lines.map((l) => ({
                lineId: String(l?.lineId ?? ""),
                receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
            })),
        };
    });
    const derived = (0, purchaseOrderNormalization_js_1.deriveReceiptState)(canonical, receipts);
    // Tracking mode per DISTINCT part -- one question, one answer, however many lines reference it.
    const modes = new Map();
    for (const partId of new Set(canonical.lines.map((l) => l.partId))) {
        const mode = await resolveTrackingMode(partId);
        // A part the authority cannot resolve is reported as UNKNOWN rather than defaulted to NONE.
        // Defaulting would tell a scanning operator a serialized part needs no serial, and the receipt
        // would then be refused at submission for a reason the screen had actively contradicted.
        modes.set(partId, mode ?? "UNKNOWN");
    }
    const storedStatus = typeof data.status === "string" ? data.status : null;
    return {
        purchaseOrderId,
        supplierId: canonical.supplierId,
        supplierName: canonical.supplierName,
        storedStatus,
        derivedState: derived.state,
        receivable: storedStatus !== null && receivingSourceResolver_js_1.RECEIVABLE_CANONICAL_STATUSES.includes(storedStatus),
        version: (0, receivingSourceResolver_js_1.normalizePoVersion)(data.version),
        lines: derived.lines.map((l) => ({
            lineId: l.lineId,
            partId: l.partId,
            trackingMode: modes.get(l.partId) ?? "UNKNOWN",
            orderedQuantity: l.orderedQuantity,
            receivedQuantity: l.receivedQuantity,
            remainingQuantity: l.remainingQuantity,
            state: l.state,
        })),
    };
}
/**
 * List canonical purchase orders that can currently be received.
 *
 * BOUNDED, and by a single-field equality on `status` so it needs no composite index. A `SENT` or
 * `APPROVED` order may still be fully received by committed receipts, so the caller filters on the
 * DERIVED state for what is genuinely outstanding — the stored status alone cannot answer that, which
 * is the whole reason derived and stored are separate concepts.
 */
exports.RECEIVABLE_LIST_LIMIT = 100;
async function listReceivablePurchaseOrders(db) {
    const out = [];
    for (const status of receivingSourceResolver_js_1.RECEIVABLE_CANONICAL_STATUSES) {
        const snap = await db
            .collection(receivingSourceResolver_js_1.CANONICAL_PURCHASE_ORDERS_COLLECTION)
            .where("status", "==", status)
            .limit(exports.RECEIVABLE_LIST_LIMIT)
            .get();
        for (const d of snap.docs) {
            const data = d.data() ?? {};
            out.push({
                purchaseOrderId: d.id,
                supplierId: typeof data.supplierId === "string" ? data.supplierId : null,
                storedStatus: status,
                lineCount: Array.isArray(data.items) ? data.items.length : 0,
            });
        }
    }
    return out.slice(0, exports.RECEIVABLE_LIST_LIMIT);
}
//# sourceMappingURL=purchaseOrderProgressRead.js.map
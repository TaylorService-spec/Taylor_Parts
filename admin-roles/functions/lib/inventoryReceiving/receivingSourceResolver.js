"use strict";
// Receiving SOURCE AUTHORITY resolution — which purchase-order authority a receipt addresses, and
// everything derived from it that validation needs.
//
// ============================ NO FALLBACK GUESSING ============================
//
// The request STATES its authority (`source.type`, a closed set). This module reads that ONE
// collection and fails closed if the document is absent. It never tries the other collection, never
// picks an authority because a lookup returned nothing, and never infers one from the shape of an id.
//
// That rule is load-bearing rather than tidy. Legacy PO ids are reorder-request ids and canonical PO
// ids are Firestore auto-ids; nothing structurally prevents a value from being plausible in both. If
// resolution fell back, a caller could aim a receipt at one authority and have it silently land on
// the other — against different stock, with different quantity rules.
//
// ============================ THE CONCURRENCY ANCHOR ============================
//
// For a canonical PO this module's `poRef` is read inside the caller's transaction and MUST be
// written by it (the version increment). That pairing is what serializes concurrent receipts —
// Firestore aborts a commit whose read document changed, and a query over prior receipts provides no
// such guarantee on its own. See docs/specifications/multi-line-receiving-transaction-order.md §1.
//
// Legacy needs no such anchor: it is full-quantity one-shot and is already serialized by the
// reorder_requests transition the command performs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECEIVABLE_CANONICAL_STATUSES = exports.CANONICAL_PURCHASE_ORDERS_COLLECTION = void 0;
exports.normalizePoVersion = normalizePoVersion;
exports.resolveReceivingSource = resolveReceivingSource;
const purchaseOrderNormalization_js_1 = require("../purchasing/purchaseOrderNormalization.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const receiveInventoryStockCommand_js_1 = require("./receiveInventoryStockCommand.js");
const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";
exports.CANONICAL_PURCHASE_ORDERS_COLLECTION = "purchase_orders";
/** Canonical PO lifecycle states a receipt may be taken against. */
exports.RECEIVABLE_CANONICAL_STATUSES = ["APPROVED", "SENT"];
const LEGACY_RECEIVABLE_STATUS = "ORDERED";
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
/**
 * A non-negative integer concurrency version, or 0 when absent.
 *
 * Absent → 0 is the documented normalization (§6). A NEGATIVE or FRACTIONAL stored version is
 * rejected rather than coerced: it cannot have been written by this command, so treating it as a
 * number would be normalizing corruption into validity — and this value is the only thing standing
 * between two concurrent receipts and an over-receipt.
 */
function normalizePoVersion(raw) {
    if (raw === undefined || raw === null)
        return 0;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("purchase order version invalid");
    }
    return raw;
}
/**
 * Read every committed receipt for one purchase order.
 *
 * SINGLE-FIELD EQUALITY, NO ORDERING — deliberately, so this needs no composite index (adding one is
 * a protected boundary). Firestore indexes single fields automatically.
 *
 * This query is NOT what makes concurrency safe. It cannot be: a transaction query takes no predicate
 * lock, so it will not see a concurrent uncommitted receipt. Safety comes from the PO document read
 * and write around it.
 */
async function readCommittedReceipts(txn, db, purchaseOrderId) {
    const snap = await txn.get(db.collection(receivingTypes_js_1.RECEIVING_ORDERS_COLLECTION).where("source.purchaseOrderId", "==", purchaseOrderId));
    return snap.docs.map((d) => {
        const data = d.data() ?? {};
        const lines = Array.isArray(data.lines) ? data.lines : [];
        return {
            receivingId: d.id,
            lines: lines.map((l) => ({
                lineId: String(l?.lineId ?? ""),
                receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
                ...(Array.isArray(l?.serialNumbers) ? { serialNumbers: l.serialNumbers } : {}),
            })),
        };
    });
}
/**
 * Resolve the addressed authority and everything derived from it.
 *
 * READS ONLY. Every read here happens before the caller's first write, and the caller owns the
 * writes. The returned `poRef`/`version` are what the caller uses to perform the canonical version
 * increment that serializes concurrent receipts.
 */
async function resolveReceivingSource(txn, db, source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("source is not an object");
    }
    const s = source;
    const sourceType = str(s.type);
    // ---------------------------------------------------------------- canonical
    if (sourceType === receivingTypes_js_1.CANONICAL_SOURCE_TYPE) {
        // CONTRADICTORY FIELDS ARE REJECTED, not ignored (§5). A canonical source carrying a
        // reorderRequestId is a request that disagrees with itself about which authority it addresses,
        // and silently dropping the extra field would resolve that disagreement by guessing.
        if (s.reorderRequestId !== undefined) {
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("canonical source must not carry a reorderRequestId");
        }
        const purchaseOrderId = str(s.purchaseOrderId);
        if (!purchaseOrderId)
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("purchaseOrderId missing");
        const poRef = db.collection(exports.CANONICAL_PURCHASE_ORDERS_COLLECTION).doc(purchaseOrderId);
        const poSnap = await txn.get(poRef);
        // FAIL CLOSED. No fallback to the legacy collection -- see this module's header.
        if (!poSnap.exists)
            throw new receiveInventoryStockCommand_js_1.SourceNotFoundError("purchase order not found");
        const data = poSnap.data() ?? {};
        let canonical;
        try {
            canonical = (0, purchaseOrderNormalization_js_1.normalizeCanonicalPurchaseOrder)(purchaseOrderId, data);
        }
        catch (err) {
            if (err instanceof purchaseOrderNormalization_js_1.PurchaseOrderNormalizationError) {
                throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError(`purchase order invalid: ${err.code}`);
            }
            throw err;
        }
        const storedStatus = str(data.status);
        if (!storedStatus || !exports.RECEIVABLE_CANONICAL_STATUSES.includes(storedStatus)) {
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("purchase order is not in a receivable state");
        }
        const receipts = await readCommittedReceipts(txn, db, purchaseOrderId);
        return {
            sourceType,
            purchaseOrderId,
            canonical,
            derived: (0, purchaseOrderNormalization_js_1.deriveReceiptState)(canonical, receipts),
            poRef,
            storedStatus,
            version: normalizePoVersion(data.version),
            isCanonical: true,
        };
    }
    // ------------------------------------------------------------------- legacy
    if (sourceType === receivingTypes_js_1.LEGACY_SOURCE_TYPE) {
        const reorderRequestId = str(s.reorderRequestId);
        if (!reorderRequestId)
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("source reorderRequestId missing");
        const purchaseOrderId = str(s.purchaseOrderId);
        if (!purchaseOrderId)
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("purchaseOrderId missing");
        // The legacy identity invariant, unchanged: the PO's id IS its reorder request's id.
        if (purchaseOrderId !== reorderRequestId)
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("source identity mismatch");
        const poRef = db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).doc(reorderRequestId);
        const poSnap = await txn.get(poRef);
        if (!poSnap.exists)
            throw new receiveInventoryStockCommand_js_1.SourceNotFoundError("purchase order not found");
        const data = poSnap.data() ?? {};
        if (data.status !== LEGACY_RECEIVABLE_STATUS) {
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("purchase order is not ORDERED");
        }
        if (data.reorderRequestId !== reorderRequestId) {
            throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("purchase order identity incoherent");
        }
        let canonical;
        try {
            canonical = (0, purchaseOrderNormalization_js_1.normalizeLegacyPurchaseOrder)(reorderRequestId, data);
        }
        catch (err) {
            if (err instanceof purchaseOrderNormalization_js_1.PurchaseOrderNormalizationError) {
                throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError(`purchase order invalid: ${err.code}`);
            }
            throw err;
        }
        // Legacy receipts are one-shot and full-quantity, so there is nothing cumulative to derive and no
        // prior-receipt query to run. Deriving over an empty receipt set gives remaining == ordered, which
        // is exactly the quantity a legacy receipt must present -- so the shared validation path produces
        // the legacy rule without a second implementation of it.
        return {
            sourceType,
            purchaseOrderId,
            reorderRequestId,
            canonical,
            derived: (0, purchaseOrderNormalization_js_1.deriveReceiptState)(canonical, []),
            poRef,
            storedStatus: str(data.status),
            version: 0, // never read and never written for legacy: the document is immutable by contract
            isCanonical: false,
        };
    }
    throw new receiveInventoryStockCommand_js_1.SourceNotReceivableError("source type is not a supported receiving authority");
}
//# sourceMappingURL=receivingSourceResolver.js.map
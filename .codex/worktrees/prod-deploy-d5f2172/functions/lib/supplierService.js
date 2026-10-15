"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSuppliers = getSuppliers;
exports.getSupplierCatalog = getSupplierCatalog;
exports.findBestSupplierForPart = findBestSupplierForPart;
// Epic 5 Procurement + Supplier Management System -- supplier reads.
//
// Read-only. No writes live here; suppliers/catalog items are
// provisioned by an admin (console or Admin SDK), same posture as
// users/{userId} role docs elsewhere in this codebase -- not a
// live vendor integration, just internal reference data.
const firestore_1 = require("firebase-admin/firestore");
const collections_1 = require("./constants/collections");
const db = () => (0, firestore_1.getFirestore)();
async function getSuppliers() {
    const snap = await db().collection(collections_1.SUPPLIERS_COLLECTION).get();
    return snap.docs.map((doc) => doc.data());
}
async function getSupplierCatalog(supplierId) {
    const snap = await db()
        .collection(collections_1.SUPPLIER_CATALOG_COLLECTION)
        .where("supplierId", "==", supplierId)
        .get();
    return snap.docs.map((doc) => doc.data());
}
// "Best" = lowest unit price among available catalog listings for this
// part, across all suppliers; ties broken by shorter leadTimeDays.
// Deliberately this simple -- no MOQ/discount-tier/reliability scoring,
// matching this epic's "planning layer, not an optimization engine"
// framing (see procurementBridge.ts for the same restraint).
async function findBestSupplierForPart(partId) {
    const [catalogSnap, suppliers] = await Promise.all([
        db()
            .collection(collections_1.SUPPLIER_CATALOG_COLLECTION)
            .where("partId", "==", partId)
            .where("available", "==", true)
            .get(),
        getSuppliers(),
    ]);
    const candidates = catalogSnap.docs.map((doc) => doc.data());
    if (candidates.length === 0)
        return null;
    const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
    let best = null;
    for (const item of candidates) {
        const supplier = suppliersById.get(item.supplierId);
        if (!supplier)
            continue;
        if (!best ||
            item.unitPrice < best.item.unitPrice ||
            (item.unitPrice === best.item.unitPrice && supplier.leadTimeDays < best.supplier.leadTimeDays)) {
            best = { item, supplier };
        }
    }
    return best?.supplier ?? null;
}
//# sourceMappingURL=supplierService.js.map
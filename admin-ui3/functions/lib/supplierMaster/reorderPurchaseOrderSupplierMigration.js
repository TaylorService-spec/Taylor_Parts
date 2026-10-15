"use strict";
// Supplier Master (S4) -- migration PLANNING + DRY-RUN for linking existing reorder_purchase_orders
// to governed Suppliers. Mirrors warehouseGovernanceMigration's dry-run discipline: deterministic
// classification of the WHOLE live set into a plan with counts and an opaque plan fingerprint; PURE
// planning with NO writes. The Admin-SDK readers below only READ (suppliers + reorder_purchase_orders).
//
// This tool NEVER writes. Persisting the derived linkage is a separate, protected promotion step that
// FIRST requires a reorder_purchase_orders Rules update to allow the supplierId/supplierNameSnapshot
// fields (see reorderPurchaseOrderSupplierCompatibility.ts header). Rollback of the eventual real run
// is trivial and non-destructive: both fields are additive, so rollback = remove them; supplierName
// (the historical authority) is never touched.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reorderPurchaseOrderRecordFingerprint = reorderPurchaseOrderRecordFingerprint;
exports.planSupplierLinkageMigration = planSupplierLinkageMigration;
exports.readGovernedSuppliers = readGovernedSuppliers;
exports.readLiveReorderPurchaseOrders = readLiveReorderPurchaseOrders;
exports.dryRunSupplierLinkageMigration = dryRunSupplierLinkageMigration;
const node_crypto_1 = require("node:crypto");
const collections_js_1 = require("../constants/collections.js");
const reorderPurchaseOrderSupplierCompatibility_js_1 = require("./reorderPurchaseOrderSupplierCompatibility.js");
const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";
// Local copies of the canonical-JSON/sha256 helpers (warehouseGovernanceMigration.ts does not export
// them). NOTE: unlike the warehouse version, this canonicalJson has no Timestamp branch -- deliberate,
// because the S4 fingerprint hashes ONLY primitives ({poId, classification, supplierId}). Do not reuse
// this helper for a payload containing Timestamps without re-adding that branch; if a third consumer of
// this pattern appears, extract a shared, Timestamp-aware utility instead.
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
// Opaque, deterministic pre-state fingerprint over a WHOLE stored reorder-PO record (no raw field value
// is exposed). Any drift to the document changes it, so an execution manifest authored against a prior
// state fails closed at execute. Same canonical-JSON basis as the plan fingerprint; primitives only
// (reorder-PO docs carry no Timestamp fields today -- see the canonicalJson note above).
function reorderPurchaseOrderRecordFingerprint(data) {
    return sha256(canonicalJson(data));
}
function emptyCounts() {
    return { EXACT: 0, AMBIGUOUS: 0, INACTIVE: 0, UNMATCHED: 0, HISTORICAL: 0 };
}
// Dry-run plan: classify the WHOLE live PO set against the governed suppliers deterministically.
// Pure; no writes. `pos` order is preserved; classification is sorted into the plan by poId for a
// stable, fingerprint-able result.
function planSupplierLinkageMigration(pos, suppliers, pins) {
    const index = (0, reorderPurchaseOrderSupplierCompatibility_js_1.buildGovernedSupplierIndex)(suppliers ?? []);
    const classified = [];
    const tally = emptyCounts();
    for (const po of pos ?? []) {
        const linkage = (0, reorderPurchaseOrderSupplierCompatibility_js_1.deriveSupplierLinkage)((po?.data ?? {}), index);
        tally[linkage.classification] += 1;
        classified.push({ poId: po.poId, ...linkage });
    }
    classified.sort((a, b) => (a.poId < b.poId ? -1 : a.poId > b.poId ? 1 : 0));
    const counts = {
        total: classified.length,
        exact: tally.EXACT,
        ambiguous: tally.AMBIGUOUS,
        inactive: tally.INACTIVE,
        unmatched: tally.UNMATCHED,
        historical: tally.HISTORICAL,
    };
    const needsResolution = classified.filter((c) => c.classification === "AMBIGUOUS" || c.classification === "INACTIVE");
    // Fingerprint the DECISIONS only (poId -> classification + supplierId), not raw PO data, so it is an
    // opaque, stable summary of what the plan would do.
    const decisions = classified.map((c) => ({ poId: c.poId, classification: c.classification, supplierId: c.supplierId }));
    const planFingerprint = sha256(canonicalJson({ projectId: pins.projectId, governedCommit: pins.governedCommit, decisions }));
    return { projectId: pins.projectId, governedCommit: pins.governedCommit, classified, counts, needsResolution, planFingerprint };
}
// --- Admin-SDK READ-ONLY loaders (no writes anywhere) -----------------------------------------
async function readGovernedSuppliers(db) {
    const snap = await db.collection(collections_js_1.SUPPLIERS_COLLECTION).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function readLiveReorderPurchaseOrders(db) {
    const snap = await db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).get();
    return snap.docs.map((d) => ({ poId: d.id, data: d.data() }));
}
// DRY-RUN entry point: read live suppliers + reorder POs, produce the plan. READ-ONLY -- writes
// nothing. Callers use the returned plan/counts for evidence; a real run is a separate gated step.
async function dryRunSupplierLinkageMigration(db, pins) {
    const [suppliers, pos] = await Promise.all([readGovernedSuppliers(db), readLiveReorderPurchaseOrders(db)]);
    return planSupplierLinkageMigration(pos, suppliers, pins);
}
//# sourceMappingURL=reorderPurchaseOrderSupplierMigration.js.map
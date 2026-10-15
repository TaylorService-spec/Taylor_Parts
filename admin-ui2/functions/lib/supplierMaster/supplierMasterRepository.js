"use strict";
// Supplier Master (S2) -- the Firestore repository for governed `suppliers/{supplierId}` records.
// Mirrors partMasterRepository's shape: pure to/from Firestore mappers + a transaction-aware repo
// with getById / stageCreate / stageUpdate, plus a dedup-DETECTION query (findActiveByNormalizedKey).
// Reads run the SHARED governed validator (supplierMasterValidation) so a malformed stored record is
// surfaced explicitly (MalformedStoredRecordError), never silently trusted. No physical delete.
Object.defineProperty(exports, "__esModule", { value: true });
exports.supplierToFirestore = supplierToFirestore;
exports.supplierFromFirestore = supplierFromFirestore;
exports.buildFirestoreSupplierRepository = buildFirestoreSupplierRepository;
const collections_js_1 = require("../constants/collections.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const supplierMasterValidation_js_1 = require("./supplierMasterValidation.js");
const supplierMasterTypes_js_1 = require("./supplierMasterTypes.js");
// A governed Supplier serializes as itself (its fields ARE the stored shape); undefined optionals
// are omitted so a document never carries an explicit `undefined`.
function supplierToFirestore(s) {
    const out = {
        id: s.id,
        name: s.name,
        normalizedKey: s.normalizedKey,
        status: s.status,
        version: s.version,
        createdAt: s.createdAt,
        createdBy: s.createdBy,
        updatedAt: s.updatedAt,
        updatedBy: s.updatedBy,
    };
    for (const f of supplierMasterTypes_js_1.SUPPLIER_OPTIONAL_STRING_FIELDS) {
        const v = s[f];
        if (v !== undefined)
            out[f] = v;
    }
    return out;
}
// Deserialize a stored Supplier, binding it to its document id. A malformed record fails LOUD.
function supplierFromFirestore(docId, data) {
    if (data === undefined)
        throw new partMasterRepository_js_1.MalformedStoredRecordError(`supplier ${docId} has no data`);
    const r = (0, supplierMasterValidation_js_1.validateGovernedSupplier)(data, docId);
    if (!r.valid)
        throw new partMasterRepository_js_1.MalformedStoredRecordError(`supplier ${docId} is malformed: ${r.reason}`);
    return r.value;
}
function buildFirestoreSupplierRepository(db) {
    const ref = (id) => db.collection(collections_js_1.SUPPLIERS_COLLECTION).doc(id);
    return {
        async getById(txn, supplierId) {
            const snap = txn ? await txn.get(ref(supplierId)) : await ref(supplierId).get();
            if (!snap.exists)
                return null;
            return supplierFromFirestore(snap.id, snap.data());
        },
        stageCreate(txn, supplier) {
            txn.create(ref(supplier.id), supplierToFirestore(supplier));
        },
        stageUpdate(txn, supplier) {
            txn.set(ref(supplier.id), supplierToFirestore(supplier));
        },
        async findActiveByNormalizedKey(txn, normalizedKey, excludeId) {
            const q = db.collection(collections_js_1.SUPPLIERS_COLLECTION).where("normalizedKey", "==", normalizedKey);
            const snap = await txn.get(q);
            const out = [];
            for (const doc of snap.docs) {
                if (doc.id === excludeId)
                    continue;
                let s;
                try {
                    s = supplierFromFirestore(doc.id, doc.data());
                }
                catch {
                    continue; // a malformed neighbor never blocks or corrupts dedup detection
                }
                if (s.status === "ACTIVE")
                    out.push(s);
            }
            return out;
        },
    };
}
//# sourceMappingURL=supplierMasterRepository.js.map
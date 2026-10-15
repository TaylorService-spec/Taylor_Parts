"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MalformedStoredRecordError = exports.EQUIPMENT_COMPATIBILITY_COLLECTIONS = exports.EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION = exports.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION = exports.EQUIPMENT_PART_COMPATIBILITY_COLLECTION = exports.EQUIPMENT_MODEL_ALIASES_COLLECTION = exports.EQUIPMENT_MODELS_COLLECTION = void 0;
exports.metaToFirestore = metaToFirestore;
exports.readMeta = readMeta;
exports.requireData = requireData;
exports.readDoc = readDoc;
const timestamps_1 = require("./timestamps");
exports.EQUIPMENT_MODELS_COLLECTION = "equipment_models";
exports.EQUIPMENT_MODEL_ALIASES_COLLECTION = "equipment_model_aliases";
exports.EQUIPMENT_PART_COMPATIBILITY_COLLECTION = "equipment_part_compatibility";
exports.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION = "equipment_compatibility_sources";
exports.EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION = "equipment_compatibility_operations";
// The five collections a D4 repository may touch. Nothing else is reachable from this module.
exports.EQUIPMENT_COMPATIBILITY_COLLECTIONS = Object.freeze([
    exports.EQUIPMENT_MODELS_COLLECTION,
    exports.EQUIPMENT_MODEL_ALIASES_COLLECTION,
    exports.EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
    exports.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION,
    exports.EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION,
]);
class MalformedStoredRecordError extends Error {
}
exports.MalformedStoredRecordError = MalformedStoredRecordError;
const MAX_ACTOR_UID = 128;
const isActorUid = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_ACTOR_UID;
function metaToFirestore(meta) {
    const created = (0, timestamps_1.readTimestamp)(meta.createdAt), updated = (0, timestamps_1.readTimestamp)(meta.updatedAt);
    if (created === null || updated === null || !isActorUid(meta.createdBy) || !isActorUid(meta.updatedBy)) {
        throw new MalformedStoredRecordError("refusing to persist malformed audit metadata");
    }
    if ((0, timestamps_1.compareTimestamps)(updated, created) < 0) {
        throw new MalformedStoredRecordError("refusing to persist a record updated before it was created");
    }
    return {
        createdAt: meta.createdAt,
        createdBy: meta.createdBy,
        updatedAt: meta.updatedAt,
        updatedBy: meta.updatedBy,
    };
}
// Audit ordering uses the GOVERNED Timestamp contract (timestamps.ts) — the same exact
// (seconds, nanoseconds) comparison the operation state machine uses. Millisecond conversion is never
// used here: it would collapse sub-millisecond differences and accept an updatedAt that is genuinely
// earlier than createdAt.
function readMeta(docId, data) {
    const { createdAt, createdBy, updatedAt, updatedBy } = data;
    const created = (0, timestamps_1.readTimestamp)(createdAt), updated = (0, timestamps_1.readTimestamp)(updatedAt);
    if (created === null || updated === null || !isActorUid(createdBy) || !isActorUid(updatedBy)) {
        throw new MalformedStoredRecordError(`stored record ${docId} has malformed audit metadata`);
    }
    if ((0, timestamps_1.compareTimestamps)(updated, created) < 0) {
        throw new MalformedStoredRecordError(`stored record ${docId} was updated before it was created`);
    }
    return { createdAt: createdAt, createdBy, updatedAt: updatedAt, updatedBy };
}
// A stored document must be a plain data map. Firestore never returns anything else, so an exotic shape
// means the read path was tampered with or a test double is wrong — fail closed either way.
function requireData(docId, data) {
    if (data === undefined || data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new MalformedStoredRecordError(`stored record ${docId} has no readable data`);
    }
    return data;
}
// Read helper shared by every adapter: point access by document id, inside a transaction when one is
// supplied. There is intentionally no list/query/delete surface in D4 — the trusted commands use point
// access only, which is also why no compound index is proposed (deferred to D5).
async function readDoc(db, txn, collection, docId) {
    const ref = db.collection(collection).doc(docId);
    const snap = txn ? await txn.get(ref) : await ref.get();
    if (!snap.exists)
        return null;
    return { id: snap.id, data: requireData(snap.id, snap.data()) };
}
//# sourceMappingURL=repository.js.map
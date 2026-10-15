"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compatibilityToFirestore = compatibilityToFirestore;
exports.compatibilityFromFirestore = compatibilityFromFirestore;
exports.sourceToFirestore = sourceToFirestore;
exports.sourceFromFirestore = sourceFromFirestore;
exports.buildFirestoreCompatibilityRepository = buildFirestoreCompatibilityRepository;
exports.buildFirestoreCompatibilitySourceRepository = buildFirestoreCompatibilitySourceRepository;
const compatibility_1 = require("./domain/compatibility");
const repository_1 = require("./repository");
// ---------------------------------------------------------------------------
// equipment_part_compatibility
// ---------------------------------------------------------------------------
function validateCompat(input, deps) {
    return (0, compatibility_1.validateCompatibility)(input, { serialSchemes: deps.serialSchemes ?? {} });
}
function compatibilityToFirestore(stored, deps = {}) {
    const v = validateCompat(stored.compatibility, deps);
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`refusing to persist invalid compatibility: ${v.reason}`);
    const c = v.value;
    return {
        compatibilityId: c.compatibilityId,
        uniquenessKey: c.uniquenessKey,
        equipmentModelId: c.equipmentModelId,
        partId: c.partId,
        compatibilityType: c.compatibilityType,
        assembly: c.assembly,
        installationPosition: c.installationPosition,
        quantityRequired: c.quantityRequired,
        applicability: { ...c.applicability },
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
        sourceSummary: c.sourceSummary,
        confidenceLevel: c.confidenceLevel,
        verificationStatus: c.verificationStatus,
        notes: c.notes,
        version: c.version,
        ...(0, repository_1.metaToFirestore)(stored),
    };
}
function compatibilityFromFirestore(docId, data, deps = {}) {
    if (!(0, compatibility_1.isCanonicalCompatibilityId)(docId)) {
        throw new repository_1.MalformedStoredRecordError(`compatibility document id ${docId} is not a canonical compatibility id`);
    }
    if (data.compatibilityId !== docId) {
        throw new repository_1.MalformedStoredRecordError(`compatibility document ${docId} carries mismatched compatibilityId ${String(data.compatibilityId)}`);
    }
    // Passing the stored compatibilityId and uniquenessKey back through the validator makes D2 re-derive
    // both from the content and reject a mismatch — a tampered id cannot masquerade as authoritative.
    const v = validateCompat({
        compatibilityId: data.compatibilityId,
        uniquenessKey: data.uniquenessKey,
        equipmentModelId: data.equipmentModelId,
        partId: data.partId,
        compatibilityType: data.compatibilityType,
        assembly: data.assembly,
        installationPosition: data.installationPosition,
        quantityRequired: data.quantityRequired,
        applicability: data.applicability,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        sourceSummary: data.sourceSummary,
        confidenceLevel: data.confidenceLevel,
        verificationStatus: data.verificationStatus,
        notes: data.notes,
        version: data.version,
    }, deps);
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`compatibility ${docId} failed D2 validation: ${v.reason}`);
    return { compatibility: v.value, ...(0, repository_1.readMeta)(docId, data) };
}
// ---------------------------------------------------------------------------
// equipment_compatibility_sources — IMMUTABLE evidence
// ---------------------------------------------------------------------------
function sourceToFirestore(stored) {
    const v = (0, compatibility_1.validateCompatibilitySource)(stored.source);
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`refusing to persist invalid compatibility source: ${v.reason}`);
    const s = v.value;
    return {
        sourceId: s.sourceId,
        compatibilityId: s.compatibilityId,
        authorityType: s.authorityType,
        sourceReference: s.sourceReference,
        sourceVersion: s.sourceVersion,
        observedClaim: s.observedClaim,
        contentFingerprint: s.contentFingerprint,
        capturedAt: s.capturedAt,
        capturedBy: s.capturedBy,
        notes: s.notes,
        ...(0, repository_1.metaToFirestore)(stored),
    };
}
function sourceFromFirestore(docId, data) {
    if (!(0, compatibility_1.isCanonicalCompatibilitySourceId)(docId)) {
        throw new repository_1.MalformedStoredRecordError(`compatibility source document id ${docId} is not a canonical source id`);
    }
    if (data.sourceId !== docId) {
        throw new repository_1.MalformedStoredRecordError(`compatibility source document ${docId} carries mismatched sourceId ${String(data.sourceId)}`);
    }
    const v = (0, compatibility_1.validateCompatibilitySource)({
        sourceId: data.sourceId,
        compatibilityId: data.compatibilityId,
        authorityType: data.authorityType,
        sourceReference: data.sourceReference,
        sourceVersion: data.sourceVersion,
        observedClaim: data.observedClaim,
        contentFingerprint: data.contentFingerprint,
        capturedAt: data.capturedAt,
        capturedBy: data.capturedBy,
        notes: data.notes,
    });
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`compatibility source ${docId} failed D2 validation: ${v.reason}`);
    return { source: v.value, ...(0, repository_1.readMeta)(docId, data) };
}
function buildFirestoreCompatibilityRepository(db, deps = {}) {
    const ref = (id) => db.collection(repository_1.EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(id);
    const idOf = (stored) => {
        const id = stored.compatibility?.compatibilityId;
        if (!(0, compatibility_1.isCanonicalCompatibilityId)(id))
            throw new repository_1.MalformedStoredRecordError(`refusing to persist noncanonical compatibilityId ${String(id)}`);
        return id;
    };
    return {
        async getById(txn, compatibilityId) {
            const doc = await (0, repository_1.readDoc)(db, txn, repository_1.EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compatibilityId);
            return doc === null ? null : compatibilityFromFirestore(doc.id, doc.data, deps);
        },
        stageCreate(txn, stored) {
            txn.create(ref(idOf(stored)), compatibilityToFirestore(stored, deps));
        },
        stageUpdate(txn, stored) {
            // update() REQUIRES the document to exist -- "update" must never quietly become a create and
            // bypass the separate stageCreate surface. Every field the record owns is written, so this is a
            // full overwrite of the governed field set, not a partial merge.
            txn.update(ref(idOf(stored)), compatibilityToFirestore(stored, deps));
        },
    };
}
function buildFirestoreCompatibilitySourceRepository(db) {
    const ref = (id) => db.collection(repository_1.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).doc(id);
    const idOf = (stored) => {
        const id = stored.source?.sourceId;
        if (!(0, compatibility_1.isCanonicalCompatibilitySourceId)(id))
            throw new repository_1.MalformedStoredRecordError(`refusing to persist noncanonical sourceId ${String(id)}`);
        return id;
    };
    return {
        async getById(txn, sourceId) {
            const doc = await (0, repository_1.readDoc)(db, txn, repository_1.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, sourceId);
            return doc === null ? null : sourceFromFirestore(doc.id, doc.data);
        },
        async listByCompatibilityId(txn, compatibilityId) {
            if (!(0, compatibility_1.isCanonicalCompatibilityId)(compatibilityId)) {
                throw new repository_1.MalformedStoredRecordError(`cannot list evidence for noncanonical compatibilityId ${String(compatibilityId)}`);
            }
            const query = db.collection(repository_1.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).where("compatibilityId", "==", compatibilityId);
            const snap = txn ? await txn.get(query) : await query.get();
            return snap.docs.map((d) => {
                const stored = sourceFromFirestore(d.id, (0, repository_1.requireData)(d.id, d.data()));
                // Defence in depth: a document returned by the query must actually belong to this relationship.
                if (stored.source.compatibilityId !== compatibilityId) {
                    throw new repository_1.MalformedStoredRecordError(`evidence ${d.id} does not belong to ${compatibilityId}`);
                }
                return stored;
            });
        },
        // create() only — a second write to the same sourceId FAILS rather than overwriting evidence.
        stageCreate(txn, stored) {
            txn.create(ref(idOf(stored)), sourceToFirestore(stored));
        },
    };
}
//# sourceMappingURL=compatibilityRepository.js.map
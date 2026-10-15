"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelToFirestore = modelToFirestore;
exports.modelFromFirestore = modelFromFirestore;
exports.aliasDocIdFor = aliasDocIdFor;
exports.deriveAliasDocId = deriveAliasDocId;
exports.aliasToFirestore = aliasToFirestore;
exports.aliasFromFirestore = aliasFromFirestore;
exports.buildFirestoreEquipmentModelRepository = buildFirestoreEquipmentModelRepository;
exports.buildFirestoreEquipmentModelAliasRepository = buildFirestoreEquipmentModelAliasRepository;
const equipmentModel_1 = require("./domain/equipmentModel");
const repository_1 = require("./repository");
// ---------------------------------------------------------------------------
// equipment_models
// ---------------------------------------------------------------------------
function modelToFirestore(stored) {
    const v = (0, equipmentModel_1.validateEquipmentModel)(stored.model);
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`refusing to persist invalid equipment model: ${v.reason}`);
    const m = v.value;
    return {
        equipmentModelId: m.equipmentModelId,
        manufacturerId: m.manufacturerId,
        manufacturerName: m.manufacturerName,
        modelNumber: m.modelNumber,
        displayName: m.displayName,
        family: m.family,
        subtype: m.subtype,
        revision: m.revision,
        status: m.status,
        sourceAuthority: m.sourceAuthority,
        version: m.version,
        ...(0, repository_1.metaToFirestore)(stored),
    };
}
function modelFromFirestore(docId, data) {
    if (data.equipmentModelId !== docId) {
        throw new repository_1.MalformedStoredRecordError(`equipment model document ${docId} carries mismatched equipmentModelId ${String(data.equipmentModelId)}`);
    }
    // Document identity IS domain identity: the id must be canonical in its own right, not merely equal
    // to a stored field that could itself be noncanonical.
    if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(docId)) {
        throw new repository_1.MalformedStoredRecordError(`equipment model document id ${docId} is not a canonical equipment model id`);
    }
    const v = (0, equipmentModel_1.validateEquipmentModel)({
        equipmentModelId: data.equipmentModelId,
        manufacturerId: data.manufacturerId,
        manufacturerName: data.manufacturerName,
        modelNumber: data.modelNumber,
        displayName: data.displayName,
        family: data.family,
        subtype: data.subtype,
        revision: data.revision,
        status: data.status,
        sourceAuthority: data.sourceAuthority,
        version: data.version,
    });
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`equipment model ${docId} failed D1 validation: ${v.reason}`);
    return { model: v.value, ...(0, repository_1.readMeta)(docId, data) };
}
// ---------------------------------------------------------------------------
// equipment_model_aliases
// ---------------------------------------------------------------------------
// The alias KEY is the pure identity; the DOC ID is its percent-encoded, storage-safe form (the
// governed Part Master precedent). Identity and persistence stay separate, and only this function
// bridges them.
function aliasDocIdFor(aliasKey) {
    if (!(0, equipmentModel_1.isCanonicalModelAliasKey)(aliasKey)) {
        throw new repository_1.MalformedStoredRecordError(`alias key ${String(aliasKey)} is not canonical`);
    }
    return (0, equipmentModel_1.encodeModelAliasDocId)(aliasKey);
}
// Derive the storage doc id for an alias input through the SINGLE D1 key authority. Returns null on any
// input the D1 contract refuses — callers never fabricate a key.
function deriveAliasDocId(input) {
    const v = (0, equipmentModel_1.validateEquipmentModelAlias)(input);
    if (!v.valid)
        return null;
    return { docId: (0, equipmentModel_1.encodeModelAliasDocId)(v.value.aliasKey), aliasKey: v.value.aliasKey };
}
function aliasToFirestore(stored) {
    const a = stored.alias;
    const v = (0, equipmentModel_1.validateEquipmentModelAlias)({
        aliasType: a?.aliasType,
        manufacturerId: a?.manufacturerId,
        rawValue: a?.aliasValue,
        equipmentModelId: a?.equipmentModelId,
        aliasKey: a?.aliasKey,
    });
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`refusing to persist invalid model alias: ${v.reason}`);
    return {
        aliasKey: v.value.aliasKey,
        aliasType: v.value.aliasType,
        manufacturerId: v.value.manufacturerId,
        aliasValue: v.value.aliasValue,
        equipmentModelId: v.value.equipmentModelId,
        ...(0, repository_1.metaToFirestore)(stored),
    };
}
function aliasFromFirestore(docId, data) {
    const aliasKey = data.aliasKey;
    if (typeof aliasKey !== "string" || (0, equipmentModel_1.encodeModelAliasDocId)(aliasKey) !== docId) {
        throw new repository_1.MalformedStoredRecordError(`alias document ${docId} carries mismatched aliasKey ${String(aliasKey)}`);
    }
    const v = (0, equipmentModel_1.validateEquipmentModelAlias)({
        aliasType: data.aliasType,
        manufacturerId: data.manufacturerId,
        rawValue: data.aliasValue,
        equipmentModelId: data.equipmentModelId,
        aliasKey,
    });
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`model alias ${docId} failed D1 validation: ${v.reason}`);
    // The stored key must be the key D1 DERIVES from the stored segments — a hand-edited aliasKey that
    // merely encodes to the right doc id is still a disagreement.
    if ((0, equipmentModel_1.normalizeModelAliasKey)({ aliasType: v.value.aliasType, manufacturerId: v.value.manufacturerId, rawValue: v.value.aliasValue }) !== aliasKey) {
        throw new repository_1.MalformedStoredRecordError(`model alias ${docId} carries an aliasKey that disagrees with its own segments`);
    }
    return { alias: v.value, ...(0, repository_1.readMeta)(docId, data) };
}
function buildFirestoreEquipmentModelRepository(db) {
    const ref = (id) => db.collection(repository_1.EQUIPMENT_MODELS_COLLECTION).doc(id);
    const idOf = (stored) => {
        const id = stored.model?.equipmentModelId;
        if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(id))
            throw new repository_1.MalformedStoredRecordError(`refusing to persist noncanonical equipment model id ${String(id)}`);
        return id;
    };
    return {
        async getById(txn, equipmentModelId) {
            const doc = await (0, repository_1.readDoc)(db, txn, repository_1.EQUIPMENT_MODELS_COLLECTION, equipmentModelId);
            return doc === null ? null : modelFromFirestore(doc.id, doc.data);
        },
        stageCreate(txn, stored) {
            txn.create(ref(idOf(stored)), modelToFirestore(stored));
        },
        stageUpdate(txn, stored) {
            // update() REQUIRES the document to exist -- "update" must never quietly become a create and
            // bypass the separate stageCreate surface. Every field the record owns is written, so this is a
            // full overwrite of the governed field set, not a partial merge.
            txn.update(ref(idOf(stored)), modelToFirestore(stored));
        },
    };
}
function buildFirestoreEquipmentModelAliasRepository(db) {
    const ref = (aliasKey) => db.collection(repository_1.EQUIPMENT_MODEL_ALIASES_COLLECTION).doc(aliasDocIdFor(aliasKey));
    return {
        async getByAliasKey(txn, aliasKey) {
            const doc = await (0, repository_1.readDoc)(db, txn, repository_1.EQUIPMENT_MODEL_ALIASES_COLLECTION, aliasDocIdFor(aliasKey));
            return doc === null ? null : aliasFromFirestore(doc.id, doc.data);
        },
        stageCreate(txn, stored) {
            txn.create(ref(stored.alias?.aliasKey), aliasToFirestore(stored));
        },
        stageUpdate(txn, stored) {
            // update() REQUIRES the document to exist -- "update" must never quietly become a create and
            // bypass the separate stageCreate surface. Every field the record owns is written, so this is a
            // full overwrite of the governed field set, not a partial merge.
            txn.update(ref(stored.alias?.aliasKey), aliasToFirestore(stored));
        },
    };
}
//# sourceMappingURL=equipmentModelRepository.js.map
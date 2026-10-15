"use strict";
// INV-1 Phase 1, PR 1.2 -- canonical Part/Manufacturer repository contracts
// and Firestore adapters (ADR-008 Accepted / Decision #40).
//
// Storage-independent interfaces + strict Firestore (Admin SDK) adapters.
// Document identity IS domain identity: parts/{partId}, manufacturers/
// {manufacturerId} -- never derived from mutable business labels. All
// client writes to both collections are denied by Rules (this PR's Tier 2,
// deploy-gated blocks); every mutation flows through partMasterCommands.ts.
// No DocumentSnapshot leaks through the public API; malformed stored data
// is surfaced explicitly (MalformedStoredRecordError), never silently
// defaulted. Physical delete does not exist -- lifecycle status only.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MalformedStoredRecordError = exports.INITIAL_VERSION = exports.MANUFACTURERS_COLLECTION = exports.PARTS_COLLECTION = void 0;
exports.partToFirestore = partToFirestore;
exports.partFromFirestore = partFromFirestore;
exports.manufacturerToFirestore = manufacturerToFirestore;
exports.manufacturerFromFirestore = manufacturerFromFirestore;
exports.buildFirestorePartRepository = buildFirestorePartRepository;
exports.buildFirestoreManufacturerRepository = buildFirestoreManufacturerRepository;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("./types");
const validation_1 = require("./validation");
exports.PARTS_COLLECTION = "parts";
exports.MANUFACTURERS_COLLECTION = "manufacturers";
exports.INITIAL_VERSION = 1;
class MalformedStoredRecordError extends Error {
}
exports.MalformedStoredRecordError = MalformedStoredRecordError;
// ---------------------------------------------------------------------------
// Serialization (strict; no unchecked casting; explicit Timestamp handling)
// ---------------------------------------------------------------------------
function metaToFirestore(meta) {
    return {
        version: meta.version,
        createdAt: firestore_1.Timestamp.fromDate(meta.createdAt),
        createdBy: meta.createdBy,
        updatedAt: firestore_1.Timestamp.fromDate(meta.updatedAt),
        updatedBy: meta.updatedBy,
    };
}
function readMeta(docId, data) {
    const { version, createdAt, createdBy, updatedAt, updatedBy } = data;
    if (typeof version !== "number" || !Number.isInteger(version) || version < exports.INITIAL_VERSION ||
        !(createdAt instanceof firestore_1.Timestamp) || !(updatedAt instanceof firestore_1.Timestamp) ||
        typeof createdBy !== "string" || typeof updatedBy !== "string") {
        throw new MalformedStoredRecordError(`stored record ${docId} has malformed version/audit metadata`);
    }
    return { version, createdAt: createdAt.toDate(), createdBy, updatedAt: updatedAt.toDate(), updatedBy };
}
function partToFirestore(stored) {
    const p = stored.part;
    return {
        partId: p.partId,
        internalPartNumber: p.internalPartNumber,
        name: p.name,
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.category !== undefined ? { category: p.category } : {}),
        status: p.status,
        stockingUnit: p.stockingUnit,
        controlType: p.controlType,
        stockingClass: p.stockingClass,
        flags: { ...p.flags },
        ...(p.manufacturerId !== undefined ? { primaryManufacturerId: p.manufacturerId } : {}),
        ...(p.manufacturerPartNumber !== undefined ? { primaryManufacturerPartNumber: p.manufacturerPartNumber } : {}),
        ...(p.oemStatus !== undefined ? { oemStatus: p.oemStatus } : {}),
        ...metaToFirestore(stored),
    };
}
function partFromFirestore(docId, data) {
    if (data === undefined)
        throw new MalformedStoredRecordError(`part ${docId} has no data`);
    if (data.partId !== docId) {
        throw new MalformedStoredRecordError(`part document ${docId} carries mismatched partId ${String(data.partId)}`);
    }
    const validated = (0, validation_1.validatePart)({
        partId: data.partId,
        internalPartNumber: data.internalPartNumber,
        name: data.name,
        description: data.description,
        category: data.category,
        status: data.status,
        stockingUnit: data.stockingUnit,
        controlType: data.controlType,
        stockingClass: data.stockingClass,
        flags: data.flags,
        manufacturerId: data.primaryManufacturerId,
        manufacturerPartNumber: data.primaryManufacturerPartNumber,
        oemStatus: data.oemStatus,
    });
    if (!validated.valid) {
        throw new MalformedStoredRecordError(`part ${docId} failed domain validation: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
    }
    return { part: validated.value, ...readMeta(docId, data) };
}
function manufacturerToFirestore(stored) {
    const m = stored.manufacturer;
    return {
        manufacturerId: m.manufacturerId,
        name: m.name,
        normalizedName: m.name.trim().replace(/\s+/g, " ").toUpperCase(),
        status: m.status,
        ...metaToFirestore(stored),
    };
}
function manufacturerFromFirestore(docId, data) {
    if (data === undefined)
        throw new MalformedStoredRecordError(`manufacturer ${docId} has no data`);
    if (data.manufacturerId !== docId) {
        throw new MalformedStoredRecordError(`manufacturer document ${docId} carries mismatched id ${String(data.manufacturerId)}`);
    }
    if (typeof data.name !== "string" || data.name.trim().length === 0) {
        throw new MalformedStoredRecordError(`manufacturer ${docId} has no name`);
    }
    if (typeof data.status !== "string" || !types_1.MANUFACTURER_STATUSES.includes(data.status)) {
        throw new MalformedStoredRecordError(`manufacturer ${docId} has invalid status ${String(data.status)}`);
    }
    return {
        manufacturer: {
            manufacturerId: docId,
            name: data.name,
            status: data.status,
        },
        ...readMeta(docId, data),
    };
}
// ---------------------------------------------------------------------------
// Firestore-backed adapters
// ---------------------------------------------------------------------------
function buildFirestorePartRepository(db) {
    const ref = (partId) => db.collection(exports.PARTS_COLLECTION).doc(partId);
    return {
        async getById(txn, partId) {
            const snap = txn ? await txn.get(ref(partId)) : await ref(partId).get();
            if (!snap.exists)
                return null;
            return partFromFirestore(snap.id, snap.data());
        },
        stageCreate(txn, stored) {
            txn.create(ref(stored.part.partId), partToFirestore(stored));
        },
        stageUpdate(txn, stored) {
            txn.set(ref(stored.part.partId), partToFirestore(stored));
        },
    };
}
function buildFirestoreManufacturerRepository(db) {
    const ref = (id) => db.collection(exports.MANUFACTURERS_COLLECTION).doc(id);
    return {
        async getById(txn, manufacturerId) {
            const snap = txn ? await txn.get(ref(manufacturerId)) : await ref(manufacturerId).get();
            if (!snap.exists)
                return null;
            return manufacturerFromFirestore(snap.id, snap.data());
        },
        stageCreate(txn, stored) {
            txn.create(ref(stored.manufacturer.manufacturerId), manufacturerToFirestore(stored));
        },
        stageUpdate(txn, stored) {
            txn.set(ref(stored.manufacturer.manufacturerId), manufacturerToFirestore(stored));
        },
    };
}
//# sourceMappingURL=partMasterRepository.js.map
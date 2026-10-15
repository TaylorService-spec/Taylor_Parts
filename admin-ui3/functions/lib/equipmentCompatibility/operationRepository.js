"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.operationToFirestore = operationToFirestore;
exports.operationFromFirestore = operationFromFirestore;
exports.buildFirestoreOperationRepository = buildFirestoreOperationRepository;
const firestore_1 = require("firebase-admin/firestore");
const errors_1 = require("./errors");
const operations_1 = require("./operations");
const timestamps_1 = require("./timestamps");
const repository_1 = require("./repository");
// The operation record carries its own timestamps and needs no audit envelope: initiatedAt/terminalAt
// ARE the provenance, and the actor is bound into the record itself as actorUid.
function operationToFirestore(record) {
    const v = (0, operations_1.validateOperationRecord)(record);
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`refusing to persist invalid operation record: ${v.reason}`);
    return {
        idempotencyKey: record.idempotencyKey,
        actorUid: record.actorUid,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        commandFingerprint: record.commandFingerprint,
        expectedVersion: record.expectedVersion,
        resultVersion: record.resultVersion,
        status: record.status,
        initiatedAt: record.initiatedAt,
        terminalAt: record.terminalAt,
    };
}
function operationFromFirestore(docId, data) {
    if (data.idempotencyKey !== docId) {
        throw new repository_1.MalformedStoredRecordError(`operation document ${docId} carries mismatched idempotencyKey ${String(data.idempotencyKey)}`);
    }
    const record = {
        idempotencyKey: data.idempotencyKey,
        actorUid: data.actorUid,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        commandFingerprint: data.commandFingerprint,
        expectedVersion: data.expectedVersion,
        resultVersion: data.resultVersion,
        status: data.status,
        initiatedAt: data.initiatedAt,
        terminalAt: data.terminalAt,
    };
    const v = (0, operations_1.validateOperationRecord)(record);
    if (!v.valid)
        throw new repository_1.MalformedStoredRecordError(`operation ${docId} failed validation: ${v.reason}`);
    return record;
}
// A DETACHED canonical snapshot. A spread copy is not enough: OperationRecord carries Firestore
// Timestamp objects, and spreading copies their REFERENCES, so a caller retaining `terminalAt` could
// still mutate `_seconds` after preparation and change what gets persisted — and the transition
// assertion would not catch it, because the mutated Timestamp can stay structurally valid and correctly
// ordered. Every governed primitive is copied explicitly and each Timestamp is REBUILT from its
// validated exact (seconds, nanoseconds) into a fresh object, so no caller reference survives.
// Nanoseconds are carried through unchanged — the rebuild must not become a millisecond round trip.
function detachOperationRecord(record, what) {
    const initiatedAt = (0, timestamps_1.readTimestamp)(record.initiatedAt);
    if (initiatedAt === null)
        throw new repository_1.MalformedStoredRecordError(`${what} has an invalid initiatedAt`);
    const terminalAt = record.terminalAt === null ? null : (0, timestamps_1.readTimestamp)(record.terminalAt);
    if (record.terminalAt !== null && terminalAt === null)
        throw new repository_1.MalformedStoredRecordError(`${what} has an invalid terminalAt`);
    return Object.freeze({
        idempotencyKey: record.idempotencyKey,
        actorUid: record.actorUid,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        commandFingerprint: record.commandFingerprint,
        expectedVersion: record.expectedVersion,
        resultVersion: record.resultVersion,
        status: record.status,
        initiatedAt: new firestore_1.Timestamp(initiatedAt.seconds, initiatedAt.nanoseconds),
        terminalAt: terminalAt === null ? null : new firestore_1.Timestamp(terminalAt.seconds, terminalAt.nanoseconds),
    });
}
function buildFirestoreOperationRepository(db) {
    // PER-INSTANCE authority. A module-global map would let one repository instance honour a token issued
    // by another whenever the same transaction object was passed, so the authorization is scoped to the
    // adapter that actually performed the read, not merely to this module.
    const authorizations = new WeakMap();
    const ref = (idempotencyKey) => db.collection(repository_1.EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION).doc(idempotencyKey);
    const read = async (txn, idempotencyKey) => {
        const doc = await (0, repository_1.readDoc)(db, txn, repository_1.EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, idempotencyKey);
        return doc === null ? null : operationFromFirestore(doc.id, doc.data);
    };
    return {
        getByIdempotencyKey: read,
        stageInitiate(txn, record) {
            (0, operations_1.assertOperationRecordTransition)(null, record); // absent → initiated, terminal fields must be null
            txn.create(ref(record.idempotencyKey), operationToFirestore(record));
        },
        // Split into prepare/stage because a Firestore transaction requires ALL reads before ANY write: the
        // Stage C TX2 stages a record mutation too, so the predecessor read must happen first. Splitting it
        // keeps that ordering explicit instead of hiding a read behind a write-shaped method.
        async prepareTerminal(txn, next) {
            const nv = (0, operations_1.validateOperationRecord)(next);
            if (!nv.valid)
                throw new repository_1.MalformedStoredRecordError(`refusing to stage invalid successor operation record: ${nv.reason}`);
            const stored = await read(txn, next.idempotencyKey);
            if (stored === null) {
                throw new errors_1.OperationNotInitiatedError(`operation ${next.idempotencyKey} has no stored initiation to terminate`);
            }
            // Detach BOTH records before asserting, so the transition that is validated is exactly the one
            // that will be written — nothing the caller still holds a reference to.
            const detachedStored = detachOperationRecord(stored, "stored operation record");
            const detachedNext = detachOperationRecord(next, "successor operation record");
            // The STORED record is the predecessor — never a caller-supplied one. This is what makes a
            // terminal rewrite unreachable: a stored `applied`/`denied` predecessor fails the guard here.
            (0, operations_1.assertOperationRecordTransition)(detachedStored, detachedNext);
            const token = Object.freeze({});
            authorizations.set(token, { transaction: txn, stored: detachedStored, next: detachedNext, used: false });
            return token;
        },
        stageTerminal(txn, authorization) {
            const entry = authorization !== null && typeof authorization === "object"
                ? authorizations.get(authorization)
                : undefined;
            if (entry === undefined) {
                throw new errors_1.IllegalOperationTransitionError("terminal transition requires an authorization issued by prepareTerminal");
            }
            if (entry.used) {
                throw new errors_1.IllegalOperationTransitionError("terminal authorization has already been used");
            }
            // Consumed on the FIRST staging attempt of any kind, BEFORE the remaining checks. A token whose
            // use was rejected — including a wrong-transaction attempt — is spent and cannot be retried; the
            // caller must re-prepare against current stored state.
            entry.used = true;
            if (entry.transaction !== txn) {
                throw new errors_1.IllegalOperationTransitionError("terminal authorization belongs to a different transaction");
            }
            // Re-assert using only the privately captured records.
            (0, operations_1.assertOperationRecordTransition)(entry.stored, entry.next);
            txn.set(ref(entry.next.idempotencyKey), operationToFirestore(entry.next));
        },
    };
}
//# sourceMappingURL=operationRepository.js.map
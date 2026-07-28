// D4 Stage B.2 — Firestore adapter for the operation STATE MACHINE:
//   equipment_compatibility_operations   doc id = idempotencyKey
//
// This is the persistence half of the Stage B.1 contract. Every transition goes through the validated
// guard in operations.ts, so the adapter cannot express an illegal one:
//   - stageInitiate uses txn.create(), so `absent → initiated` genuinely requires absence. A concurrent
//     initiation loses the create and the transaction fails, rather than silently overwriting.
//   - stageTerminal asserts the FULL predecessor/successor transition before writing.
//   - there is NO delete and NO general update method. Terminal rewrites, fingerprint/key changes and
//     applied ↔ denied are unreachable from this surface, not merely discouraged.
// A stored record that fails validation is MalformedStoredRecordError — it is NEVER reported as absent,
// which would let a replay re-execute an already-terminal command.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  assertOperationRecordTransition,
  validateOperationRecord,
  type OperationRecord,
} from "./operations";
import {
  EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION,
  MalformedStoredRecordError,
  readDoc,
} from "./repository";

// The operation record carries its own timestamps and needs no audit envelope: initiatedAt/terminalAt
// ARE the provenance, and the actor is bound into the record itself as actorUid.
export function operationToFirestore(record: OperationRecord): Record<string, unknown> {
  const v = validateOperationRecord(record);
  if (!v.valid) throw new MalformedStoredRecordError(`refusing to persist invalid operation record: ${v.reason}`);
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

export function operationFromFirestore(docId: string, data: Record<string, unknown>): OperationRecord {
  if (data.idempotencyKey !== docId) {
    throw new MalformedStoredRecordError(`operation document ${docId} carries mismatched idempotencyKey ${String(data.idempotencyKey)}`);
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
  const v = validateOperationRecord(record);
  if (!v.valid) throw new MalformedStoredRecordError(`operation ${docId} failed validation: ${v.reason}`);
  return record as OperationRecord;
}

export interface OperationRepository {
  // Returns null ONLY when the document genuinely does not exist. A malformed record throws.
  getByIdempotencyKey(txn: Transaction | null, idempotencyKey: string): Promise<OperationRecord | null>;
  // absent → initiated. create() enforces the "absent" half at the storage layer.
  stageInitiate(txn: Transaction, record: OperationRecord): void;
  // initiated → applied | denied, guarded by the full-record transition assertion.
  stageTerminal(txn: Transaction, previous: OperationRecord, next: OperationRecord): void;
}

export function buildFirestoreOperationRepository(db: Firestore): OperationRepository {
  const ref = (idempotencyKey: string) => db.collection(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION).doc(idempotencyKey);
  return {
    async getByIdempotencyKey(txn, idempotencyKey) {
      const doc = await readDoc(db, txn, EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, idempotencyKey);
      return doc === null ? null : operationFromFirestore(doc.id, doc.data);
    },
    stageInitiate(txn, record) {
      assertOperationRecordTransition(null, record); // absent → initiated, terminal fields must be null
      txn.create(ref(record.idempotencyKey), operationToFirestore(record));
    },
    stageTerminal(txn, previous, next) {
      assertOperationRecordTransition(previous, next); // validates BOTH records + the immutable binding
      txn.set(ref(next.idempotencyKey), operationToFirestore(next));
    },
  };
}

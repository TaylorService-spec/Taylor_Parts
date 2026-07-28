// D4 Stage B.2 — Firestore adapter for the operation STATE MACHINE:
//   equipment_compatibility_operations   doc id = idempotencyKey
//
// This is the persistence half of the Stage B.1 contract. Every transition goes through the validated
// guard in operations.ts, so the adapter cannot express an illegal one:
//   - stageInitiate uses txn.create(), so `absent → initiated` genuinely requires absence. A concurrent
//     initiation loses the create and the transaction fails, rather than silently overwriting.
//   - the terminal transition is TWO-PHASE: prepareTerminal READS the stored record inside the same
//     transaction and asserts stored → next; stageTerminal writes only what prepareTerminal authorized.
//     The persistence authority is the stored document, never a caller-supplied predecessor, so a
//     fabricated or stale `initiated` argument cannot overwrite a stored terminal record.
//   - there is NO delete and NO general update method. Terminal rewrites, fingerprint/key changes and
//     applied ↔ denied are unreachable from this surface, not merely discouraged.
// A stored record that fails validation is MalformedStoredRecordError — it is NEVER reported as absent,
// which would let a replay re-execute an already-terminal command.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { IllegalOperationTransitionError, OperationNotInitiatedError } from "./errors";
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

// Unforgeable proof that the STORED predecessor was read and validated inside this transaction. The
// brand is a module-private symbol, so a caller cannot fabricate one and cannot substitute its own idea
// of the predecessor — the persistence authority is always the document, never the argument.
const TERMINAL_AUTHORIZATION = Symbol("d4.operation.terminalAuthorization");

export interface TerminalAuthorization {
  readonly [TERMINAL_AUTHORIZATION]: true;
  readonly stored: OperationRecord;
  readonly next: OperationRecord;
}

export interface OperationRepository {
  // Returns null ONLY when the document genuinely does not exist. A malformed record throws.
  getByIdempotencyKey(txn: Transaction | null, idempotencyKey: string): Promise<OperationRecord | null>;
  // absent → initiated. create() enforces the "absent" half at the storage layer.
  stageInitiate(txn: Transaction, record: OperationRecord): void;
  // Phase 1 of the terminal transition: READ the stored predecessor in this transaction and assert
  // stored → next. Throws OperationNotInitiatedError if absent, MalformedStoredRecordError if the stored
  // record is malformed, and IllegalOperationTransitionError if the stored predecessor is already
  // terminal or the binding changed.
  prepareTerminal(txn: Transaction, next: OperationRecord): Promise<TerminalAuthorization>;
  // Phase 2: write the authorized successor. Only accepts an authorization produced by phase 1.
  stageTerminal(txn: Transaction, authorization: TerminalAuthorization): void;
}

export function buildFirestoreOperationRepository(db: Firestore): OperationRepository {
  const ref = (idempotencyKey: string) => db.collection(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION).doc(idempotencyKey);
  const read = async (txn: Transaction | null, idempotencyKey: string): Promise<OperationRecord | null> => {
    const doc = await readDoc(db, txn, EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, idempotencyKey);
    return doc === null ? null : operationFromFirestore(doc.id, doc.data);
  };
  return {
    getByIdempotencyKey: read,
    stageInitiate(txn, record) {
      assertOperationRecordTransition(null, record); // absent → initiated, terminal fields must be null
      txn.create(ref(record.idempotencyKey), operationToFirestore(record));
    },
    // Split into prepare/stage because a Firestore transaction requires ALL reads before ANY write: the
    // Stage C TX2 stages a record mutation too, so the predecessor read must happen first. Splitting it
    // keeps that ordering explicit instead of hiding a read behind a write-shaped method.
    async prepareTerminal(txn, next) {
      const nv = validateOperationRecord(next);
      if (!nv.valid) throw new MalformedStoredRecordError(`refusing to stage invalid successor operation record: ${nv.reason}`);
      const stored = await read(txn, next.idempotencyKey);
      if (stored === null) {
        throw new OperationNotInitiatedError(`operation ${next.idempotencyKey} has no stored initiation to terminate`);
      }
      // The STORED record is the predecessor — never a caller-supplied one. This is what makes a
      // terminal rewrite unreachable: a stored `applied`/`denied` predecessor fails the guard here.
      assertOperationRecordTransition(stored, next);
      return { [TERMINAL_AUTHORIZATION]: true, stored, next };
    },
    stageTerminal(txn, authorization) {
      if (authorization === null || typeof authorization !== "object" || (authorization as any)[TERMINAL_AUTHORIZATION] !== true) {
        throw new IllegalOperationTransitionError("terminal transition requires an authorization from prepareTerminal");
      }
      const { stored, next } = authorization;
      // Re-assert against the record that was actually read, so an authorization cannot be mutated
      // between the two phases.
      assertOperationRecordTransition(stored, next);
      txn.set(ref(next.idempotencyKey), operationToFirestore(next));
    },
  };
}

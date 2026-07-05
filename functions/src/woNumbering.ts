// Work Order Engine v1.2 -- transaction-safe WO number generation.
//
// Format: WO-YYYY-###### (year, 6-digit zero-padded sequence).
//
// Correctness properties the spec requires, and how this satisfies them:
// - Never reused: `sequence` is read and incremented inside the SAME
//   transaction that writes the new WO doc (see createWorkOrder.ts, which
//   owns the transaction boundary -- this file never opens its own).
//   Firestore detects a read/write conflict on the counter doc between
//   two concurrent transactions and retries the loser automatically.
// - Globally sequential: exactly one counter doc per year is the only
//   writer of `sequence` for that year.
// - Concurrency-safe: relies on Firestore's standard optimistic-
//   concurrency transaction retry -- the same primitive
//   domain/jobActions.js's assignJob() already depends on client-side;
//   no new concurrency primitive is introduced here.
// - Transaction-safe: the WO doc write and the counter increment commit
//   together or not at all, so a WO number is never allocated without
//   its WO doc appearing (or vice versa).
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "./constants/collections";

interface CounterDoc {
  year: number;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(`work_orders_${year}`);
}

export interface AllocatedWorkOrderNumber {
  woNumber: string;
  sequence: number;
}

// Must be called with a transaction the caller already opened -- this
// function performs exactly one read and one write against the counter
// doc, both inside that transaction, and does not commit anything
// itself.
export async function allocateWorkOrderNumber(
  tx: Transaction,
  year: number
): Promise<AllocatedWorkOrderNumber> {
  const ref = counterRef(year);
  const snap = await tx.get(ref);

  const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;

  tx.set(ref, {
    year,
    sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const woNumber = `WO-${year}-${String(sequence).padStart(6, "0")}`;
  return { woNumber, sequence };
}

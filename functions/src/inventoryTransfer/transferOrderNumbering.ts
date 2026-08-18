// Transfer Order reference numbering — transaction-safe allocation.
//
// Format: TO-YYYY-###### (year, 6-digit zero-padded sequence).
//
// Mirrors opportunityNumbering.ts / salesOrderNumbering.ts / woNumbering.ts EXACTLY — same problem (a
// Firestore document id is not a human-usable identity), same transactional counter mechanism, same
// correctness argument. Deliberately NOT reinvented here: a second, subtly different concurrency story
// for the same problem would be worse than a duplicated one.
//
// CORRECTNESS, same argument as the other four allocators:
//   - Never reused: `sequence` is read and incremented inside the SAME transaction that writes the new
//     Transfer Order doc (see transferOrderCommand.ts's createTransferOrder, which owns the transaction
//     boundary — this file never opens its own). Firestore detects the read/write conflict on the
//     counter doc between concurrent transactions and retries the loser.
//   - Globally sequential per year: exactly one counter doc per year is the only writer of `sequence`
//     for that year. The year itself is derived server-side by the caller (new Date().getUTCFullYear()),
//     never accepted from the request — a rollover at midnight UTC on Jan 1 simply starts a fresh counter
//     doc (transfer_orders_{newYear}), exactly like the Work Order / Opportunity / Sales Order allocators.
//   - Transaction-safe: the Transfer Order write and the counter increment commit together or not at
//     all, so a reference is never allocated without its record appearing, and a record never appears
//     without its reference.
//
// IDENTITY INDEPENDENCE. Deliberately NOT derived from the Transfer Order's own document id (which is
// itself derived from the caller's idempotencyKey — see transferOrderRepository.ts's transferOrderDocId),
// a Work Order number, a Receiving Order number, or an inventory transaction id. The sequence lives in
// its own counter document (`transfer_orders_{year}`), entirely independent of every other identity in
// the system.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections.js";

interface CounterDoc {
  year: number;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

/** Counter doc id. Distinct from opportunities_YYYY / work_orders_YYYY / sales_orders_YYYY / receiving_orders_YYYY so no sequence ever interacts with another family's. */
export function transferOrderCounterDocId(year: number): string {
  return `transfer_orders_${year}`;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year));
}

export interface AllocatedTransferOrderNumber {
  transferOrderNumber: string;
  sequence: number;
}

/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a Firestore
 * transaction anywhere near it.
 */
export function formatTransferOrderNumber(year: number, sequence: number): string {
  return `TO-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly one read and one
 * write against the counter doc, both inside that transaction, and commits nothing itself.
 *
 * Callers must call this only AFTER every other read the surrounding transaction needs has already
 * happened — Firestore requires all reads before any writes in a transaction, and this function's own
 * `tx.set` is a real write. transferOrderCommand.ts's createTransferOrder calls this immediately before
 * staging the create (its last read — origin stock sufficiency — has already completed by that point).
 */
export async function allocateTransferOrderNumber(
  tx: Transaction,
  year: number
): Promise<AllocatedTransferOrderNumber> {
  const ref = counterRef(year);
  const snap = await tx.get(ref);

  const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;

  tx.set(ref, {
    year,
    sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { transferOrderNumber: formatTransferOrderNumber(year, sequence), sequence };
}

// Sales Order reference numbering — transaction-safe allocation.
//
// Format: SO-YYYY-###### (year, 6-digit zero-padded sequence).
//
// Mirrors opportunityNumbering.ts exactly — same problem (a Firestore document id is not
// a human-usable identity), same transactional counter mechanism, same correctness
// argument. Deliberately NOT reinvented here: a second, subtly different concurrency
// story for the same problem would be worse than a duplicated one.
//
// CORRECTNESS, same argument as opportunityNumbering.ts / woNumbering.ts:
//   - Never reused: `sequence` is read and incremented inside the SAME transaction
//     that writes the new Sales Order doc. The caller owns the transaction boundary;
//     this file never opens its own. Firestore detects the read/write conflict on the
//     counter between concurrent transactions and retries the loser.
//   - Globally sequential per year: exactly one counter doc per year is the only
//     writer of `sequence` for that year.
//   - Transaction-safe: the Sales Order write and the counter increment commit
//     together or not at all, so a reference is never allocated without its record
//     appearing, and a record never appears without its reference.
//
// IMMUTABILITY. Allocated once at creation, alongside the document write. No transition
// path may rewrite it — a value that changes is a label, not an identifier, and lineage
// references to a Sales Order (e.g. from a Work Order) depend on it never moving.
//
// IDENTITY INDEPENDENCE. Deliberately NOT derived from the Firestore document id, the
// originating Opportunity's number, the Account, or a Work Order. Those are all
// different entities with their own lifecycles; a Sales Order's own identity must not
// be borrowed from any of them.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections";

interface CounterDoc {
  year: number;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

/** Counter doc id. Distinct from opportunities_YYYY / work_orders_YYYY so the sequences never interact. */
export function salesOrderCounterDocId(year: number): string {
  return `sales_orders_${year}`;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(salesOrderCounterDocId(year));
}

export interface AllocatedSalesOrderNumber {
  salesOrderNumber: string;
  sequence: number;
}

/**
 * Pure formatter, exported separately so the format can be tested — and changed —
 * without a Firestore transaction anywhere near it.
 */
export function formatSalesOrderNumber(year: number, sequence: number): string {
  return `SO-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly
 * one read and one write against the counter doc, both inside that transaction, and
 * commits nothing itself.
 */
export async function allocateSalesOrderNumber(
  tx: Transaction,
  year: number
): Promise<AllocatedSalesOrderNumber> {
  const ref = counterRef(year);
  const snap = await tx.get(ref);

  const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;

  tx.set(ref, {
    year,
    sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { salesOrderNumber: formatSalesOrderNumber(year, sequence), sequence };
}

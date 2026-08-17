// Opportunity reference numbering — transaction-safe allocation.
//
// Format: OPP-YYYY-###### (year, 6-digit zero-padded sequence).
//
// WHY OPPORTUNITIES NEED A REFERENCE AT ALL. Today an Opportunity has no human
// identity, so every surface that shows one shows its Firestore document id:
// `95kFz8WWgiSn2nU2O3Ml` in the Account page's Opportunities section, and again as
// the "Originating Opportunity" link text on Sales Order detail. A document id is a
// database key. It is not a name, it cannot be read aloud, it cannot be searched for
// by a person, and it should never have been user-facing.
//
// The Owner's ruling is BOTH: a human-entered `name` for comprehension and an
// immutable system reference for identity. This file owns the second. The name is a
// plain field and needs no machinery.
//
// FORMAT NOTE — one deliberate deviation, flagged rather than buried. The ruling's
// example was "OPP-000123", a year-less global sequence. This implements
// OPP-YYYY-###### instead, matching woNumbering.ts's WO-YYYY-###### exactly, because
// the two references sit side by side in the same lineage on Sales Order detail and a
// user reading them should not have to learn two schemes. The example was phrased
// "such as", so this reads as illustrative rather than specified — but a reference
// format is user-visible and expensive to change once records carry it, so the
// deviation is called out for a cheap correction now rather than a migration later.
// Changing it is a one-line edit here plus its tests; nothing else depends on the shape.
//
// CORRECTNESS, and how each property is satisfied — deliberately the same argument as
// woNumbering.ts, because this is the same problem and a second, subtly different
// concurrency story would be worse than a duplicated one:
//   - Never reused: `sequence` is read and incremented inside the SAME transaction
//     that writes the new Opportunity doc. The caller owns the transaction boundary;
//     this file never opens its own. Firestore detects the read/write conflict on the
//     counter between concurrent transactions and retries the loser.
//   - Globally sequential per year: exactly one counter doc per year is the only
//     writer of `sequence` for that year.
//   - Transaction-safe: the Opportunity write and the counter increment commit
//     together or not at all, so a reference is never allocated without its record
//     appearing, and a record never appears without its reference.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections";

interface CounterDoc {
  year: number;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

/** Counter doc id. Distinct from work_orders_YYYY so the two sequences never interact. */
export function opportunityCounterDocId(year: number): string {
  return `opportunities_${year}`;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(opportunityCounterDocId(year));
}

export interface AllocatedOpportunityNumber {
  opportunityNumber: string;
  sequence: number;
}

/**
 * Pure formatter, exported separately so the format can be tested — and changed —
 * without a Firestore transaction anywhere near it.
 */
export function formatOpportunityNumber(year: number, sequence: number): string {
  return `OPP-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly
 * one read and one write against the counter doc, both inside that transaction, and
 * commits nothing itself.
 */
export async function allocateOpportunityNumber(
  tx: Transaction,
  year: number
): Promise<AllocatedOpportunityNumber> {
  const ref = counterRef(year);
  const snap = await tx.get(ref);

  const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;

  tx.set(ref, {
    year,
    sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { opportunityNumber: formatOpportunityNumber(year, sequence), sequence };
}

// Reorder Request reference numbering — transaction-safe allocation.
//
// Format: RR-YYYY-###### (year, 6-digit zero-padded sequence).
//
// Mirrors opportunityNumbering.ts / salesOrderNumbering.ts / woNumbering.ts / transferOrderNumbering.ts
// EXACTLY — same problem, same transactional counter mechanism, same correctness argument. Deliberately
// NOT reinvented here: a second, subtly different concurrency story for the same problem would be worse
// than a duplicated one.
//
// CORRECTNESS, same argument as the other allocators:
//   - Never reused: `sequence` is read and incremented inside the SAME transaction that writes the new
//     Reorder Request doc. The caller owns the transaction boundary; this file never opens its own.
//     Firestore detects the read/write conflict on the counter between concurrent transactions and
//     retries the loser.
//   - Globally sequential per year: exactly one counter doc per year is the only writer of `sequence`
//     for that year.
//   - Transaction-safe: the Reorder Request write and the counter increment commit together or not at
//     all, so a reference is never allocated without its record appearing, and a record never appears
//     without its reference.
//
// IDENTITY INDEPENDENCE. Deliberately NOT derived from the Reorder Request's own document id, a Work
// Order number, a Transfer Order number, a Receiving Order number, or an inventory transaction id. The
// sequence lives in its own counter document (`reorder_requests_{year}`), entirely independent of every
// other identity in the system.
//
// NOT WIRED INTO A CREATE PATH. Unlike the Transfer Order and Receiving Order families, there is no
// server-side create path for reorder_requests in functions/src today: firestore.rules' `match
// /reorder_requests/{requestId}` block grants `allow create` directly to client callers (gated by role,
// not by a Cloud Function), and the actual writer is field-ops-app-vite's domain/reorderRequestPayload.js
// / createReorderRequest() — outside this package's write scope, and outside functions/src entirely. This
// allocator exists so the reference family is defined and tested to the same standard as the other two,
// but nothing in functions/src calls it yet; wiring it in would require either (a) a new governed Cloud
// Function create path for Reorder Requests (none exists — inventing one is out of scope for a numbering
// change), or (b) an Owner-authorized firestore.rules change forcing the client write through a
// server-derived reference, which this lane's charter explicitly treats as a protected Tier-2 change and
// does not authorize. Flagged in the handoff as REGISTRATION_PENDING, not silently worked around.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections.js";

interface CounterDoc {
  year: number;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

/** Counter doc id. Distinct from every other family's counter so no sequence ever interacts with another's. */
export function reorderRequestCounterDocId(year: number): string {
  return `reorder_requests_${year}`;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(reorderRequestCounterDocId(year));
}

export interface AllocatedReorderRequestNumber {
  reorderRequestNumber: string;
  sequence: number;
}

/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a Firestore
 * transaction anywhere near it.
 */
export function formatReorderRequestNumber(year: number, sequence: number): string {
  return `RR-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly one read and one
 * write against the counter doc, both inside that transaction, and commits nothing itself.
 */
export async function allocateReorderRequestNumber(
  tx: Transaction,
  year: number
): Promise<AllocatedReorderRequestNumber> {
  const ref = counterRef(year);
  const snap = await tx.get(ref);

  const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;

  tx.set(ref, {
    year,
    sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { reorderRequestNumber: formatReorderRequestNumber(year, sequence), sequence };
}

// Sales Agreement reference numbering — transaction-safe allocation.
//
// Format: SA-YYYY-###### (year, 6-digit zero-padded sequence).
//
// ════════════════════ THE FORMAT WAS DERIVED, NOT CHOSEN ════════════════════
//
// Every governed business reference in this repo is `XX-YYYY-######`, allocated from one counter
// doc per object per year named after the object's collection:
//
//     OPP-YYYY-######  opportunities_YYYY       SO-YYYY-######  sales_orders_YYYY
//     WO-YYYY-######   work_orders_YYYY         RO-YYYY-######  receiving_orders_YYYY
//     TO-YYYY-######   transfer_orders_YYYY     RR-YYYY-######  reorder_requests_YYYY
//
// The convention decides this object's answer: SA-YYYY-###### from `sales_agreements_YYYY`. SA is
// unclaimed (asserted below by test, not by inspection alone). No naming decision was open here —
// inventing a different shape for the seventh object would be the decision.
//
// CORRECTNESS, the same argument as salesOrderNumbering.ts / opportunityNumbering.ts:
//   - Never reused: `sequence` is read and incremented inside the SAME transaction that writes the
//     new Agreement doc. The caller owns the transaction boundary; this file never opens its own.
//     Firestore detects the read/write conflict on the counter and retries the loser.
//   - Globally sequential per year: exactly one counter doc per year is the only writer of
//     `sequence` for that year.
//   - Transaction-safe: the Agreement write and the counter increment commit together or not at
//     all, so a reference is never allocated without its record appearing, and a record never
//     appears without its reference.
//
// IDEMPOTENCY IS THE CALLER'S, AND IT COMES FIRST. A retried create must not consume a sequence.
// salesAgreementCallables.ts reads the prior audit event BEFORE reaching here, so a replay returns
// the original agreement and never enters this function — the counter is untouched. Allocating
// first and de-duplicating after would burn a number per retry and leave gaps that look like
// deleted agreements.
//
// IMMUTABILITY. Allocated once at creation, alongside the document write. No later command may
// rewrite it — a value that changes is a label, not an identifier, and the Sales Order's lineage
// back to its commitment depends on it never moving.
//
// IDENTITY INDEPENDENCE. Deliberately NOT derived from the Firestore document id, the originating
// Opportunity's number, or the Sales Order it later produces. Those are different entities with
// their own lifecycles; an Agreement's identity must not be borrowed from any of them.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections";

interface CounterDoc {
  year: number;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

/** Counter doc id. Distinct from sales_orders_YYYY / opportunities_YYYY so the sequences never interact. */
export function salesAgreementCounterDocId(year: number): string {
  return `sales_agreements_${year}`;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(salesAgreementCounterDocId(year));
}

export interface AllocatedSalesAgreementNumber {
  salesAgreementNumber: string;
  sequence: number;
}

/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a
 * Firestore transaction anywhere near it.
 */
export function formatSalesAgreementNumber(year: number, sequence: number): string {
  return `SA-${year}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate the next reference for `year`.
 *
 * Must be called with a transaction the caller already opened: this performs exactly one read and
 * one write against the counter doc, both inside that transaction, and commits nothing itself.
 */
export async function allocateSalesAgreementNumber(
  tx: Transaction,
  year: number,
): Promise<AllocatedSalesAgreementNumber> {
  const ref = counterRef(year);
  const snap = await tx.get(ref);

  const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;

  tx.set(ref, {
    year,
    sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { salesAgreementNumber: formatSalesAgreementNumber(year, sequence), sequence };
}

// Receiving Order reference numbering — transaction-safe allocation.
//
// Format: RO-YYYY-###### (year, 6-digit zero-padded sequence).
//
// Same problem, same counter mechanism, same correctness argument as opportunityNumbering.ts /
// salesOrderNumbering.ts / woNumbering.ts / transferOrderNumbering.ts: one counter document per year in
// the shared `counters` collection, read and incremented inside the SAME transaction that creates the
// referencing record, relying on Firestore's optimistic-concurrency transaction retry so two concurrent
// allocations can never receive the same sequence.
//
// ONE DELIBERATE ADAPTATION, flagged rather than buried. Every other allocator (opportunity/sales
// order/work order/transfer order) calls `tx.set` on the counter doc immediately, because their callers
// commit every other write in the same transaction immediately too. receiveInventoryStockCommand.ts does
// not: it buffers EVERY write (the receiving_orders create, the RECEIVED ledger event(s), the Serialized
// Asset activations for a SERIAL receipt) into a local array and flushes them all in one loop at the very
// end of its transaction, specifically so it can keep reading (the SERIAL identity checks in its own
// section 9b) after the Receiving Order has already been staged. Firestore requires every read in a
// transaction to happen before any write; committing the counter here immediately, mid-transaction, would
// break that ordering the moment a later read runs. So allocation here is split in two: `readNextSequence`
// performs the SAME read-and-compute-next-sequence step (safe anywhere before the transaction's first
// real write) but returns the counter document's pending write instead of committing it, so the caller
// can push it onto its own write buffer and flush it atomically with everything else. The counter
// mechanism itself — one document per year, read then incremented inside the same transaction that writes
// the referencing record — is unchanged.
//
// IDENTITY INDEPENDENCE. Deliberately NOT derived from the Receiving Order's own document id (itself
// derived from the caller's idempotencyKey — see receivingRepository.ts's receivingOrderDocId), a Work
// Order number, a Transfer Order number, or an inventory transaction id. The sequence lives in its own
// counter document (`receiving_orders_{year}`), entirely independent of every other identity in the
// system.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections.js";
import { allocateBusinessNumber } from "../numbering/businessNumber.js";
import type { PendingWrite } from "../numbering/businessNumber.js";

/** Counter doc id. Distinct from opportunities_YYYY / work_orders_YYYY / sales_orders_YYYY / transfer_orders_YYYY so no sequence ever interacts with another family's. */
export function receivingOrderCounterDocId(year: number): string {
  return `receiving_orders_${year}`;
}

function counterRef(year: number): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(receivingOrderCounterDocId(year));
}

export interface AllocatedReceivingOrderNumber {
  receivingOrderNumber: string;
  sequence: number;
}

/**
 * Pure formatter, exported separately so the format can be tested — and changed — without a Firestore
 * transaction anywhere near it.
 */
export function formatReceivingOrderNumber(year: number, sequence: number): string {
  return `RO-${year}-${String(sequence).padStart(6, "0")}`;
}

/** The counter document's pending write: `ref` and `data` for the caller to push onto its own buffer. */
export interface PendingCounterWrite {
  readonly ref: DocumentReference;
  readonly data: Record<string, unknown>;
}

/**
 * Read the counter for `year` and compute the next sequence, INSIDE the caller's transaction (one read,
 * no write). Returns the formatted reference and the counter document's pending write for the caller to
 * commit later in the SAME transaction (see the module header for why this command needs that split).
 *
 * The caller MUST push `counterWrite` onto its own write buffer and flush it before the transaction
 * commits — an allocated number whose counter write is dropped would be reissued on the next allocation
 * for the same year, defeating the whole "never reused" guarantee. receiveInventoryStockCommand.ts does
 * this immediately, as part of the same buffered-write flush as the Receiving Order document itself.
 */
export async function allocateReceivingOrderNumber(
  tx: Transaction,
  year: number
): Promise<AllocatedReceivingOrderNumber & { counterWrite: PendingCounterWrite; pendingWrites: readonly PendingWrite[] }> {
  const allocated = await allocateBusinessNumber(tx, {
    counterRef: counterRef(year),
    format: (sequence) => formatReceivingOrderNumber(year, sequence),
    counterFields: { year },
  });
  // The counter `set` is always the LAST pending write (see businessNumber.ts); `counterWrite` keeps
  // the original single-write shape for any caller that still reads it, but a caller that flushes
  // ONLY `counterWrite` would drop the CLAIM and lose the duplicate defence -- so flush
  // `pendingWrites` instead. receiveInventoryStockCommand.ts does.
  const counterSet = allocated.pendingWrites[allocated.pendingWrites.length - 1];
  return {
    receivingOrderNumber: allocated.number,
    sequence: allocated.sequence,
    pendingWrites: allocated.pendingWrites,
    counterWrite: { ref: counterSet.ref, data: counterSet.data },
  };
}

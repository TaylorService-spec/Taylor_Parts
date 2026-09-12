// BUSINESS NUMBER ALLOCATION -- the ONE core every human-facing document-number allocator uses.
//
// WHAT A BUSINESS NUMBER IS, AND IS NOT. A business number (WO-2026-000001, SO-2026-000014,
// INV-000007, ...) is the HUMAN-FACING sequential document number: operators read it aloud, file by
// it, and quote it on the phone. It is deliberately NOT the system's internal record identity -- a
// record's identity is its Firestore document id, which is assigned and governed entirely separately.
// Nothing in this module derives a business number from a record id, and nothing derives a record id
// from a business number. That separation is intentional; do not collapse it.
//
// WHY THIS MODULE EXISTS. Every allocator independently repeated:
//
//     const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;
//
// Two defects are latent in that one line, and they were present in all eight allocators:
//
//   1. COUNTER LOSS REISSUES A LIVE NUMBER. The `: 1` fallback is unconditional. If the counter
//      document for a (family, year) is ever absent while records for that (family, year) already
//      exist -- deleted, restored from a backup predating the last allocations, or lost in a project
//      move -- the allocator silently restarts at 1 and hands WO-2026-000001 to a SECOND work order.
//      Nothing in the transaction could observe that the number was already in someone's hands:
//      there was no max-existing check and no record of which numbers had been issued.
//
//   2. A CORRUPT COUNTER RENDERS "NaN". If the counter document exists but its `sequence` is missing
//      or non-numeric, `undefined + 1` is NaN and `String(NaN).padStart(6,"0")` is "000NaN" -- the
//      allocator emitted the literal reference "WO-2026-000NaN" rather than failing. Two such
//      allocations produce the identical string, so this is a duplicate path as well as a garbage one.
//
// THE DEFENCE. Two independent barriers, both inside the caller's transaction:
//
//   (a) VALIDATED ARITHMETIC. A counter document that exists must carry a `sequence` that is a
//       non-negative safe integer. Anything else raises BusinessNumberError rather than being
//       coerced. NaN can no longer reach a rendered number.
//
//   (b) A CLAIM LEDGER. Every number this module issues is simultaneously CLAIMED by creating a
//       document at `business_number_claims/<number>` with `tx.create`, which Firestore fails with
//       ALREADY_EXISTS if the document is already there. The claim is a hard uniqueness constraint on
//       the number string itself, entirely independent of the counter. Before choosing a number the
//       allocator PROBES the claim ledger forward from the counter's next value and takes the first
//       unclaimed number -- so after a counter loss it walks past the numbers already issued and
//       resumes cleanly instead of colliding. Probing is all reads, performed before any write, which
//       is what Firestore's reads-before-writes rule requires.
//
// GAPS ARE ACCEPTABLE; DUPLICATES ARE NOT. A probe that skips forward leaves a hole in the sequence,
// and so does any transaction that allocates and then fails. That is the deliberate trade: these are
// document numbers, not a legally gapless fiscal series. (Whether a gapless series is required for
// any particular family -- invoices especially, in some jurisdictions -- is an OWNER question, raised
// in this lane's handoff and NOT decided here.)
//
// WHAT THE CLAIM LEDGER DOES NOT COVER. A claim exists only for numbers allocated AFTER this module
// shipped. Records numbered before it have no claim document, so a counter loss on a legacy dataset
// can still land on a legacy number. Seeding the ledger from existing records is a one-time operator
// backfill (functions/scripts/backfillOperationalNumbering.mjs is the tool that already reads every
// existing number per family); it is deliberately NOT performed automatically here, and no data
// migration was run by the lane that wrote this.
//
// CONCURRENCY. Unchanged and still Firestore's: the counter read and write happen inside the
// caller's transaction, so two concurrent allocations conflict on the counter document and the loser
// retries. The claim ledger is a SECOND barrier underneath that, not a replacement for it -- if the
// counter defence were ever defeated, `tx.create` on the claim still refuses the duplicate.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/** Admin-SDK-only, exactly like `counters`. firestore.rules denies clients every operation on it. */
export const BUSINESS_NUMBER_CLAIMS_COLLECTION = "business_number_claims";

/** How far past the counter's next value the allocator will probe for an unclaimed number. */
export const MAX_CLAIM_PROBES = 256;

export type BusinessNumberFailureCode =
  | "CORRUPT_COUNTER"
  | "INVALID_FORMAT"
  | "CLAIM_PROBE_EXHAUSTED";

export class BusinessNumberError extends Error {
  readonly code: BusinessNumberFailureCode;
  constructor(code: BusinessNumberFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BusinessNumberError";
  }
}

/** A write the caller must flush inside the SAME transaction. Shape matches the buffered-write
 *  callers already use (`{ op, ref, data }`), so a deferred-commit caller can push these straight
 *  onto its own buffer. */
export interface PendingWrite {
  readonly op: "create" | "set";
  readonly ref: DocumentReference;
  readonly data: Record<string, unknown>;
}

export interface AllocatedBusinessNumber {
  /** The human-facing number, exactly as operators read it. */
  readonly number: string;
  /** The sequence actually taken -- may exceed counter+1 when a probe skipped claimed numbers. */
  readonly sequence: number;
  /** Claim create + counter set, in order. Flush BOTH, in the same transaction, or the number leaks. */
  readonly pendingWrites: readonly PendingWrite[];
}

/**
 * A claim document id is the business number itself. Firestore document ids may not contain "/" and
 * may not be "." or ".."; every business number in this system is `[A-Z]+-...-[0-9]+`, so the check
 * is a guard against a future format change silently producing an unusable claim id, not a
 * transformation. It deliberately does NOT sanitize -- a number that cannot be claimed verbatim must
 * fail loudly rather than be claimed under a different, collidable key.
 */
export function claimDocId(businessNumber: string): string {
  if (
    typeof businessNumber !== "string" ||
    businessNumber.length === 0 ||
    businessNumber.length > 1500 ||
    businessNumber.includes("/") ||
    businessNumber === "." ||
    businessNumber === ".." ||
    /^__.*__$/.test(businessNumber)
  ) {
    throw new BusinessNumberError(
      "INVALID_FORMAT",
      `business number ${JSON.stringify(businessNumber)} cannot be used as a claim document id`
    );
  }
  return businessNumber;
}

function claimRef(businessNumber: string): DocumentReference {
  return getFirestore().collection(BUSINESS_NUMBER_CLAIMS_COLLECTION).doc(claimDocId(businessNumber));
}

/**
 * Read the counter document and compute the sequence the next allocation would START from.
 * Throws rather than coercing when the stored sequence is not a usable number.
 */
function nextSequenceFrom(snapExists: boolean, data: unknown, counterPath: string): number {
  if (!snapExists) return 1;
  const raw = (data as { sequence?: unknown } | undefined)?.sequence;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    throw new BusinessNumberError(
      "CORRUPT_COUNTER",
      `counter ${counterPath} exists but its sequence is ${JSON.stringify(raw)}, which is not a non-negative safe integer; ` +
        `refusing to allocate a business number from it (allocating would have rendered a malformed reference)`
    );
  }
  return raw + 1;
}

export interface AllocateBusinessNumberOptions {
  /** The family's counter document. One counter per (family, year) -- or per (family, company). */
  readonly counterRef: DocumentReference;
  /** Renders the human-facing number for a sequence. MUST NOT be changed without an Owner ruling. */
  readonly format: (sequence: number) => string;
  /** Extra fields to store alongside `sequence` on the counter doc (e.g. `{ year }`, `{ companyId }`). */
  readonly counterFields?: Record<string, unknown>;
  /** Test seam only. Defaults to MAX_CLAIM_PROBES. */
  readonly maxProbes?: number;
}

/**
 * Allocate the next business number for a family.
 *
 * Must be called with a transaction the caller already opened, and BEFORE that transaction's first
 * write -- every step here that touches Firestore is a read, and the writes are returned for the
 * caller to flush rather than issued directly, so a caller that buffers its writes (see
 * receiveInventoryStockCommand.ts) and one that commits immediately can share this single core.
 */
export async function allocateBusinessNumber(
  tx: Transaction,
  opts: AllocateBusinessNumberOptions
): Promise<AllocatedBusinessNumber> {
  const { counterRef, format, counterFields = {} } = opts;
  const maxProbes = opts.maxProbes ?? MAX_CLAIM_PROBES;

  const counterSnap = await tx.get(counterRef);
  const start = nextSequenceFrom(
    Boolean(counterSnap.exists),
    counterSnap.exists ? counterSnap.data() : undefined,
    counterRef.path ?? counterRef.id
  );

  // Probe the claim ledger forward from `start` for the first unclaimed number. In the normal case
  // the very first candidate is free and this is a single extra read. A batch is only widened when a
  // claim is actually hit -- i.e. after a counter loss or rollback -- and every probe is a READ, so
  // widening never violates Firestore's reads-before-writes rule.
  const PROBE_BATCH = 8;
  let chosenSequence: number | null = null;
  let chosenNumber = "";
  for (let offset = 0; offset < maxProbes && chosenSequence === null; offset += PROBE_BATCH) {
    const width = Math.min(PROBE_BATCH, maxProbes - offset);
    const candidates = Array.from({ length: width }, (_, i) => {
      const sequence = start + offset + i;
      return { sequence, number: format(sequence) };
    });
    const snaps = await tx.getAll(...candidates.map((c) => claimRef(c.number)));
    for (let i = 0; i < candidates.length; i += 1) {
      if (!snaps[i]?.exists) {
        chosenSequence = candidates[i].sequence;
        chosenNumber = candidates[i].number;
        break;
      }
    }
  }

  if (chosenSequence === null) {
    throw new BusinessNumberError(
      "CLAIM_PROBE_EXHAUSTED",
      `every business number from ${format(start)} through ${format(start + maxProbes - 1)} is already claimed; ` +
        `refusing to allocate rather than reissue a number an existing record holds. The counter at ` +
        `${counterRef.path ?? counterRef.id} is behind the claim ledger by more than ${maxProbes} -- an operator must ` +
        `reconcile it (functions/scripts/backfillOperationalNumbering.mjs reports the true state) before allocation resumes.`
    );
  }

  return {
    number: chosenNumber,
    sequence: chosenSequence,
    pendingWrites: [
      // The claim FIRST: `create` is the hard uniqueness barrier. If two transactions somehow reached
      // the same number, this is what refuses the second one.
      {
        op: "create",
        ref: claimRef(chosenNumber),
        data: {
          businessNumber: chosenNumber,
          counterPath: counterRef.path ?? counterRef.id,
          sequence: chosenSequence,
          claimedAt: FieldValue.serverTimestamp(),
        },
      },
      {
        op: "set",
        ref: counterRef,
        data: { ...counterFields, sequence: chosenSequence, updatedAt: FieldValue.serverTimestamp() },
      },
    ],
  };
}

/** Flush an allocation's pending writes onto the caller's transaction. For callers that commit
 *  immediately; a caller that buffers its own writes pushes `pendingWrites` onto its buffer instead. */
export function applyPendingWrites(tx: Transaction, writes: readonly PendingWrite[]): void {
  for (const w of writes) {
    if (w.op === "create") tx.create(w.ref, w.data);
    else tx.set(w.ref, w.data);
  }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessNumberError = exports.MAX_CLAIM_PROBES = exports.BUSINESS_NUMBER_CLAIMS_COLLECTION = void 0;
exports.claimDocId = claimDocId;
exports.allocateBusinessNumber = allocateBusinessNumber;
exports.applyPendingWrites = applyPendingWrites;
const firestore_1 = require("firebase-admin/firestore");
/** Admin-SDK-only, exactly like `counters`. firestore.rules denies clients every operation on it. */
exports.BUSINESS_NUMBER_CLAIMS_COLLECTION = "business_number_claims";
/** How far past the counter's next value the allocator will probe for an unclaimed number. */
exports.MAX_CLAIM_PROBES = 256;
class BusinessNumberError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "BusinessNumberError";
    }
}
exports.BusinessNumberError = BusinessNumberError;
/**
 * A claim document id is the business number itself. Firestore document ids may not contain "/" and
 * may not be "." or ".."; every business number in this system is `[A-Z]+-...-[0-9]+`, so the check
 * is a guard against a future format change silently producing an unusable claim id, not a
 * transformation. It deliberately does NOT sanitize -- a number that cannot be claimed verbatim must
 * fail loudly rather than be claimed under a different, collidable key.
 */
function claimDocId(businessNumber) {
    if (typeof businessNumber !== "string" ||
        businessNumber.length === 0 ||
        businessNumber.length > 1500 ||
        businessNumber.includes("/") ||
        businessNumber === "." ||
        businessNumber === ".." ||
        /^__.*__$/.test(businessNumber)) {
        throw new BusinessNumberError("INVALID_FORMAT", `business number ${JSON.stringify(businessNumber)} cannot be used as a claim document id`);
    }
    return businessNumber;
}
function claimRef(businessNumber) {
    return (0, firestore_1.getFirestore)().collection(exports.BUSINESS_NUMBER_CLAIMS_COLLECTION).doc(claimDocId(businessNumber));
}
/**
 * Read the counter document and compute the sequence the next allocation would START from.
 * Throws rather than coercing when the stored sequence is not a usable number.
 */
function nextSequenceFrom(snapExists, data, counterPath) {
    if (!snapExists)
        return 1;
    const raw = data?.sequence;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
        throw new BusinessNumberError("CORRUPT_COUNTER", `counter ${counterPath} exists but its sequence is ${JSON.stringify(raw)}, which is not a non-negative safe integer; ` +
            `refusing to allocate a business number from it (allocating would have rendered a malformed reference)`);
    }
    return raw + 1;
}
/**
 * Allocate the next business number for a family.
 *
 * Must be called with a transaction the caller already opened, and BEFORE that transaction's first
 * write -- every step here that touches Firestore is a read, and the writes are returned for the
 * caller to flush rather than issued directly, so a caller that buffers its writes (see
 * receiveInventoryStockCommand.ts) and one that commits immediately can share this single core.
 */
async function allocateBusinessNumber(tx, opts) {
    const { counterRef, format, counterFields = {} } = opts;
    const maxProbes = opts.maxProbes ?? exports.MAX_CLAIM_PROBES;
    const counterSnap = await tx.get(counterRef);
    const start = nextSequenceFrom(Boolean(counterSnap.exists), counterSnap.exists ? counterSnap.data() : undefined, counterRef.path ?? counterRef.id);
    // Probe the claim ledger forward from `start` for the first unclaimed number. In the normal case
    // the very first candidate is free and this is a single extra read. A batch is only widened when a
    // claim is actually hit -- i.e. after a counter loss or rollback -- and every probe is a READ, so
    // widening never violates Firestore's reads-before-writes rule.
    const PROBE_BATCH = 8;
    let chosenSequence = null;
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
        throw new BusinessNumberError("CLAIM_PROBE_EXHAUSTED", `every business number from ${format(start)} through ${format(start + maxProbes - 1)} is already claimed; ` +
            `refusing to allocate rather than reissue a number an existing record holds. The counter at ` +
            `${counterRef.path ?? counterRef.id} is behind the claim ledger by more than ${maxProbes} -- an operator must ` +
            `reconcile it (functions/scripts/backfillOperationalNumbering.mjs reports the true state) before allocation resumes.`);
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
                    claimedAt: firestore_1.FieldValue.serverTimestamp(),
                },
            },
            {
                op: "set",
                ref: counterRef,
                data: { ...counterFields, sequence: chosenSequence, updatedAt: firestore_1.FieldValue.serverTimestamp() },
            },
        ],
    };
}
/** Flush an allocation's pending writes onto the caller's transaction. For callers that commit
 *  immediately; a caller that buffers its own writes pushes `pendingWrites` onto its buffer instead. */
function applyPendingWrites(tx, writes) {
    for (const w of writes) {
        if (w.op === "create")
            tx.create(w.ref, w.data);
        else
            tx.set(w.ref, w.data);
    }
}
//# sourceMappingURL=businessNumber.js.map
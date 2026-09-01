// THE SEED WRITE, and the timestamps every seeded record carries.
//
// Extracted from certificationWorld.mjs for one reason: that file calls `main()` at import time, so
// nothing in it could ever be tested without running an entire world rebuild against Firestore.
// The write path is the part with a rule worth protecting, so it lives where a test can reach it.
//
// ============================ WHY RECORDS ARE STAMPED ============================
//
// Firestore's `orderBy` does not merely sort -- it FILTERS. A document missing the ordered field is
// silently excluded, with no error and nothing to indicate an omission. The world builder describes
// BUSINESS facts and says nothing about when a record was written, which is correct; but nothing
// else was supplying it either, so every seeded record landed with no `createdAt` and no
// `updatedAt`.
//
// The Customers list sorts `updatedAt DESC`. 101 of 103 customers were therefore absent from their
// own list, while the portfolio header -- a different read, which does not sort -- still counted all
// 103. A list quietly missing 94% of its rows looks exactly like a list of that size.
//
// state.mjs already declares both fields VOLATILE: "server timestamp on records written through
// Admin SDK helpers", expected to differ between rebuilds and excluded from the determinism
// comparison. Stamping here is what that entry always described. The seeder simply was not one of
// the helpers doing it.
import { FieldValue } from "firebase-admin/firestore";
import { stableShape } from "./state.mjs";
import { MARKER_FIELD } from "./manifest.mjs";

/** Default stamp source. Wrapped rather than passed as a bare reference so tests can substitute it. */
export const serverStamp = () => FieldValue.serverTimestamp();

// ============================ CERT-UPGRADE-TIMESTAMPS-05 ============================
//
// merge:true PRESERVES A STORED FIELD ONLY WHEN THE PAYLOAD OMITS IT. A field present in the
// payload is overwritten, merge or not. Because this module unconditionally put BOTH stamps in the
// payload, any writer that reused it to touch an EXISTING document silently replaced that
// document's createdAt and updatedAt -- and the additive world upgrader is exactly such a writer.
//
// The 1.7.0 -> 1.8.0 upgrade would have rewritten the createdAt of all 1092 existing records whose
// only real difference was the certification marker version. createdAt would have stopped meaning
// creation time for the entire base world, and `accounts` carries FIVE composite indexes ordering
// by updatedAt DESCENDING, so the whole customer list would have collapsed to a single instant and
// reported every account as freshly touched at migration time.
//
// THE GOVERNED SEMANTICS ARE NOT INVENTED HERE. scripts/backfillWriteTimestamps.mjs already ruled
// on this exact field, and its two load-bearing sentences decide all three cases below:
//
//   "updatedAt is a factual claim about when a record was last written. Filling it with a
//    convenient value would replace an honest absence with a dishonest presence ... it would tell
//    an operator that every customer was touched today."
//   "NON-DESTRUCTIVE ... No existing value is replaced -- a document that already has updatedAt is
//    skipped entirely rather than 'corrected'."
//
// So an existing stamp is never replaced, and a stamp is only written where it states something
// true. That yields exactly three policies, and the distinction is made IMPOSSIBLE TO MISUSE by
// being a required property of the record rather than a flag on the call: a writer that says
// nothing gets the original seeding behaviour, which is the only safe default for a NEW document.

/** How one record's write should treat the two server-stamped timestamp fields. */
export const TIMESTAMP_POLICY = Object.freeze({
  // A document that does not exist yet. Both stamps are minted, and both are true.
  NEW_RECORD: "NEW_RECORD",
  // An existing document whose BUSINESS CONTENT genuinely changed. createdAt is omitted from the
  // payload so the stored creation instant survives; updatedAt advances, because the record really
  // was just written and that is what the field claims.
  CONTENT_UPDATE: "CONTENT_UPDATE",
  // An existing document whose only difference is certification metadata -- the marker version.
  // NEITHER stamp is written. Nothing a consumer of these fields cares about changed, and moving
  // updatedAt would tell every reader of an updatedAt-ordered list that the record was touched.
  METADATA_ONLY: "METADATA_ONLY",
});

/**
 * The object actually written for one record.
 *
 * STAMPS GO UNDER THE RECORD, NEVER OVER IT. A dataset that carries a meaningful `updatedAt` of its
 * own keeps it; only silence is filled. Reversing the spread would let an infrastructure concern
 * quietly overwrite a business fact, which is a worse bug than the one this fixes.
 *
 * The policy decides WHICH stamps enter the payload at all -- and a stamp that never enters the
 * payload is a stored value merge:true leaves alone.
 */
export function stampedForWrite(data, stamp = serverStamp, policy = TIMESTAMP_POLICY.NEW_RECORD) {
  if (policy === TIMESTAMP_POLICY.METADATA_ONLY) return { ...data };
  if (policy === TIMESTAMP_POLICY.CONTENT_UPDATE) return { updatedAt: stamp(), ...data };
  if (policy !== TIMESTAMP_POLICY.NEW_RECORD) {
    // FAIL CLOSED. An unrecognised policy is a caller bug, and guessing NEW_RECORD for it would
    // reintroduce the exact overwrite this constant exists to prevent.
    throw new Error(`unknown timestamp policy: ${String(policy)}`);
  }
  return { createdAt: stamp(), updatedAt: stamp(), ...data };
}

/**
 * Commit every record in batches, stamped.
 *
 * `merge: true` preserves anything already on the document, so re-seeding is additive rather than
 * a replacement -- but see the note above: it preserves only fields the payload OMITS.
 *
 * A record may carry `timestampPolicy`. Omitting it means NEW_RECORD, which is what the ordinary
 * seeder and rebuild want and what this function has always done. Only a writer that knowingly
 * touches existing documents needs to say otherwise, and it has to say so per record.
 *
 * ============================ THE PARTIAL-FAILURE BOUNDARY ============================
 *
 * Batches of 400 are committed INDEPENDENTLY. A 1093-record upgrade is three commits, and there is
 * no transaction spanning them -- Firestore has no such thing at this size. A failure part-way
 * therefore leaves some documents upgraded and the rest untouched, and the caller's deployment
 * record (written only after this function returns) still describes the OLD world.
 *
 * That state is recoverable, because the additive planner re-reads live state and re-derives the
 * delta rather than replaying a script. It must NEVER be blindly rerun under the original
 * single-run authorization: STOP, READ, RECONCILE, and return for authorization. The count this
 * function returns is the number of records in COMMITTED batches, so on a throw it is not a
 * progress report -- nothing is returned at all, and only a re-read can say what landed.
 */
export async function writeRecords(db, records, stamp = serverStamp) {
  let written = 0;
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    for (const r of records.slice(i, i + 400)) {
      batch.set(db.collection(r.collection).doc(r.id),
        stampedForWrite(r.data, stamp, r.timestampPolicy ?? TIMESTAMP_POLICY.NEW_RECORD), { merge: true });
    }
    await batch.commit();
    written += Math.min(400, records.length - i);
  }
  return written;
}


/**
 * Only the keys the fixture declares. Extra stored fields are not drift, they are history --
 * an environment-minted userId, a migration's updatedBy, a later command's own bookkeeping.
 */
function declaredOnly(stored, expected) {
  const out = {};
  if (!stored) return out;
  for (const k of Object.keys(expected)) {
    if (Object.prototype.hasOwnProperty.call(stored, k)) out[k] = stored[k];
  }
  return out;
}

const canon = (obj) => JSON.stringify(stableShape(obj));
const withoutMarker = (obj) => {
  const out = { ...obj };
  delete out[MARKER_FIELD];
  return out;
};

/**
 * Does the stored record differ from the expected one on the parts that must match?
 *
 * stableShape strips the volatile fields the world contract already names -- server timestamps, the
 * environment-minted Auth uid, per-run idempotency keys. ONE definition of "the same", shared by
 * the additive upgrader and by the policy classifier below, because a second one would disagree
 * with verify eventually and the disagreement would surface as a record rewritten on every run.
 */
export function differsOnDeclaredFields(expected, stored) {
  return canon(expected) !== canon(declaredOnly(stored, expected));
}

/**
 * Which timestamp policy this record's write must use -- CERT-UPGRADE-TIMESTAMPS-05.
 *
 * PURE and total. `stored` undefined means the document does not exist yet.
 *
 * The three answers are the three cases in TIMESTAMP_POLICY, and the discriminator is whether
 * anything BEYOND the certification marker differs. A world version bump rewrites every record's
 * marker and nothing else; treating that as an update would move updatedAt on the entire base
 * world, which `accounts` alone indexes five ways in DESCENDING order.
 */
export function classifyTimestampPolicy(expected, stored) {
  if (stored === undefined || stored === null) return TIMESTAMP_POLICY.NEW_RECORD;
  const beyondMarker = canon(withoutMarker(expected))
    !== canon(withoutMarker(declaredOnly(stored, expected)));
  return beyondMarker ? TIMESTAMP_POLICY.CONTENT_UPDATE : TIMESTAMP_POLICY.METADATA_ONLY;
}

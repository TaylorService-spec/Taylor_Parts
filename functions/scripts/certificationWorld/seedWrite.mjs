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

/** Default stamp source. Wrapped rather than passed as a bare reference so tests can substitute it. */
export const serverStamp = () => FieldValue.serverTimestamp();

/**
 * The object actually written for one record.
 *
 * STAMPS GO UNDER THE RECORD, NEVER OVER IT. A dataset that carries a meaningful `updatedAt` of its
 * own keeps it; only silence is filled. Reversing the spread would let an infrastructure concern
 * quietly overwrite a business fact, which is a worse bug than the one this fixes.
 */
export function stampedForWrite(data, stamp = serverStamp) {
  return { createdAt: stamp(), updatedAt: stamp(), ...data };
}

/**
 * Commit every record in batches, stamped.
 *
 * `merge: true` preserves anything already on the document, so re-seeding is additive rather than
 * a replacement.
 */
export async function writeRecords(db, records, stamp = serverStamp) {
  let written = 0;
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    for (const r of records.slice(i, i + 400)) {
      batch.set(db.collection(r.collection).doc(r.id), stampedForWrite(r.data, stamp), { merge: true });
    }
    await batch.commit();
    written += Math.min(400, records.length - i);
  }
  return written;
}

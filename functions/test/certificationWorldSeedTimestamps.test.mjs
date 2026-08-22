// SEEDED RECORDS MUST CARRY WRITE TIMESTAMPS.
//
// The bug this locks down was invisible in exactly the way that matters: the seeder wrote every
// record successfully, verify passed, the world reported COMPLETE -- and 101 of 103 customers were
// missing from the Customers list, because Firestore's `orderBy` silently EXCLUDES documents that
// lack the ordered field. Nothing failed. The list was just quietly wrong.
//
// A test that only checked "the record was written" would have passed throughout. So these check
// the property the LIST depends on, which is that the ordered field exists at all.
import test from "node:test";
import assert from "node:assert/strict";
import { stampedForWrite, writeRecords } from "../scripts/certificationWorld/seedWrite.mjs";

/** Distinguishable, non-Firestore stamp so assertions are about placement, not about the SDK. */
let seq = 0;
const fakeStamp = () => `STAMP_${++seq}`;

/** Minimal Firestore batch/collection double: records what would be committed. */
function fakeDb() {
  const writes = [];
  let commits = 0;
  return {
    writes,
    commits: () => commits,
    collection: (collection) => ({ doc: (id) => ({ collection, id }) }),
    batch: () => ({
      set: (ref, data, opts) => writes.push({ ...ref, data, opts }),
      commit: async () => { commits += 1; },
    }),
  };
}

test("every seeded record is written with both write timestamps", async () => {
  const db = fakeDb();
  const written = await writeRecords(db, [
    { collection: "accounts", id: "cw-acct-0000", data: { name: "ONYX Ice Cream" } },
    { collection: "locations", id: "cw-acct-0000-loc-00", data: { label: "Main" } },
  ], fakeStamp);

  assert.equal(written, 2);
  for (const w of db.writes) {
    assert.ok(w.data.createdAt, `${w.id} was seeded with no createdAt`);
    assert.ok(w.data.updatedAt, `${w.id} was seeded with no updatedAt -- orderBy would exclude it`);
  }
  // The business fact still survives the stamping.
  assert.equal(db.writes[0].data.name, "ONYX Ice Cream");
  assert.deepEqual(db.writes[0].opts, { merge: true });
});

test("a dataset's own timestamps WIN over the stamps", () => {
  // Stamps fill silence; they never overwrite a fact the world actually asserts. If the spread
  // order were reversed, an infrastructure default would quietly replace real data.
  const own = { name: "Harbor Grill", updatedAt: "2026-08-17T04:47:36.404Z" };
  const out = stampedForWrite(own, fakeStamp);

  assert.equal(out.updatedAt, "2026-08-17T04:47:36.404Z", "the record's own updatedAt was overwritten");
  assert.ok(String(out.createdAt).startsWith("STAMP_"), "createdAt was absent and should have been filled");
});

test("MUTATION: a seeder that omits the stamp is caught", async () => {
  // The guard above is only worth having if it fails when the property is absent. This is the
  // pre-fix seeder -- `batch.set(ref, r.data)` -- and it must not pass.
  const db = fakeDb();
  const unstamped = [{ collection: "accounts", id: "cw-acct-0001", data: { name: "Novel Ice Cream" } }];
  for (const r of unstamped) db.batch().set(db.collection(r.collection).doc(r.id), r.data, { merge: true });

  const missing = db.writes.filter((w) => !w.data.updatedAt);
  assert.equal(missing.length, 1, "the unstamped write should be detectable as missing updatedAt");
});

test("records are committed in batches, not one oversized write", async () => {
  // Firestore caps a batch at 500. A silent overflow would fail the whole seed at a size nobody
  // tests at, so the chunking is asserted rather than assumed.
  const db = fakeDb();
  const many = Array.from({ length: 900 }, (_, i) => ({ collection: "contacts", id: `c-${i}`, data: { n: i } }));
  const written = await writeRecords(db, many, fakeStamp);

  assert.equal(written, 900);
  assert.equal(db.commits(), 3, "900 records should commit in 3 batches of at most 400");
  assert.ok(db.writes.every((w) => w.data.updatedAt), "every record in every batch is stamped");
});

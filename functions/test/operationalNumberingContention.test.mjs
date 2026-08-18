// Transfer Order / Receiving Order / Reorder Request reference numbering — REAL Firestore-emulator
// concurrency test. Requires the Firestore emulator (127.0.0.1:8080).
//
// The offline *Numbering.test.mjs files prove the allocators do exactly one read + one write against the
// caller's transaction using fake stubs -- that proves the SHAPE of the concurrency contract, but not
// that Firestore's real optimistic-concurrency transaction retry actually prevents two SIMULTANEOUS
// callers from ever landing on the same sequence. This file proves that against the real emulator: fire
// many concurrent db.runTransaction() calls, each allocating one number for the SAME year, and assert the
// resulting sequences are exactly {1..N} with zero duplicates and zero gaps. A racy implementation (e.g.
// reading the counter outside the transaction, or a plain non-transactional read-then-write) would
// either throw or silently hand out the same sequence to two callers; this test would catch either.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";

// The allocators under test call getFirestore()/getFirestore(app) with no app name (they resolve the
// DEFAULT app), so this must be the default app too -- not a named secondary app.
if (!admin.apps.length) admin.initializeApp({ projectId: "operational-numbering-contention-test" });
const db = admin.firestore();

const { allocateTransferOrderNumber } = await import("../lib/inventoryTransfer/transferOrderNumbering.js");
const { allocateReceivingOrderNumber } = await import("../lib/inventoryReceiving/receivingOrderNumbering.js");
const { allocateReorderRequestNumber } = await import("../lib/reorderRequest/reorderRequestNumbering.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const CONCURRENCY = 10;
// The emulator's own lock queue times out under very high same-document contention well before real
// Firestore would (a known emulator characteristic, not a correctness gap in the allocator) -- a higher
// maxAttempts absorbs that without weakening what's being proven: every attempt still goes through the
// SAME transactional read-increment-write, so a raised retry ceiling cannot paper over a genuine
// duplicate-sequence bug, it only gives the real contention more room to resolve the way production does.
const TXN_OPTS = { maxAttempts: 15 };

function assertExactSequenceSet(sequences, label) {
  assert.equal(sequences.length, CONCURRENCY, `${label}: expected ${CONCURRENCY} allocations, got ${sequences.length}`);
  const unique = new Set(sequences);
  assert.equal(unique.size, CONCURRENCY, `${label}: every sequence must be unique -- got duplicates: ${JSON.stringify(sequences.sort((a, b) => a - b))}`);
  const sorted = [...sequences].sort((a, b) => a - b);
  for (let i = 0; i < CONCURRENCY; i += 1) {
    assert.equal(sorted[i], i + 1, `${label}: sequences must be exactly 1..${CONCURRENCY} with no gaps -- got ${JSON.stringify(sorted)}`);
  }
}

await check(`Transfer Order: ${CONCURRENCY} concurrent allocations for the same year never collide`, async () => {
  const year = 2101 + Math.floor(Math.random() * 1000); // isolate this run's counter doc from any prior run
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      db.runTransaction((txn) => allocateTransferOrderNumber(txn, year), TXN_OPTS)
    )
  );
  assertExactSequenceSet(results.map((r) => r.sequence), "transferOrderNumber");
  const numbers = new Set(results.map((r) => r.transferOrderNumber));
  assert.equal(numbers.size, CONCURRENCY, "every formatted transferOrderNumber must also be unique");
});

await check(`Receiving Order: ${CONCURRENCY} concurrent allocations for the same year never collide (deferred-commit caller pattern)`, async () => {
  const year = 2101 + Math.floor(Math.random() * 1000);
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      db.runTransaction(async (txn) => {
        // Mirrors receiveInventoryStockCommand.ts's real usage exactly: allocate (read-only here), then
        // the caller commits the counter's pending write itself before the transaction ends.
        const allocated = await allocateReceivingOrderNumber(txn, year);
        txn.set(allocated.counterWrite.ref, allocated.counterWrite.data);
        return allocated;
      }, TXN_OPTS)
    )
  );
  assertExactSequenceSet(results.map((r) => r.sequence), "receivingOrderNumber");
  const numbers = new Set(results.map((r) => r.receivingOrderNumber));
  assert.equal(numbers.size, CONCURRENCY, "every formatted receivingOrderNumber must also be unique");
});

await check(`Reorder Request: ${CONCURRENCY} concurrent allocations for the same year never collide`, async () => {
  const year = 2101 + Math.floor(Math.random() * 1000);
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      db.runTransaction((txn) => allocateReorderRequestNumber(txn, year), TXN_OPTS)
    )
  );
  assertExactSequenceSet(results.map((r) => r.sequence), "reorderRequestNumber");
  const numbers = new Set(results.map((r) => r.reorderRequestNumber));
  assert.equal(numbers.size, CONCURRENCY, "every formatted reorderRequestNumber must also be unique");
});

await check("each family's counter is independent: allocating all three concurrently for the SAME year never cross-contaminates", async () => {
  const year = 2101 + Math.floor(Math.random() * 1000);
  const [to, ro, rr] = await Promise.all([
    db.runTransaction((txn) => allocateTransferOrderNumber(txn, year), TXN_OPTS),
    db.runTransaction(async (txn) => {
      const allocated = await allocateReceivingOrderNumber(txn, year);
      txn.set(allocated.counterWrite.ref, allocated.counterWrite.data);
      return allocated;
    }, TXN_OPTS),
    db.runTransaction((txn) => allocateReorderRequestNumber(txn, year), TXN_OPTS),
  ]);
  // All three start their own counter fresh for this never-before-used year -- each gets sequence 1,
  // proving the three families never share a counter document even when allocated in the same instant.
  assert.equal(to.sequence, 1);
  assert.equal(ro.sequence, 1);
  assert.equal(rr.sequence, 1);
  assert.equal(to.transferOrderNumber, `TO-${year}-000001`);
  assert.equal(ro.receivingOrderNumber, `RO-${year}-000001`);
  assert.equal(rr.reorderRequestNumber, `RR-${year}-000001`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

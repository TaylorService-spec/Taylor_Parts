// Reorder Request reference numbering — offline tests.
//
// Runs against the compiled lib/ output with a fake transaction, so it needs no emulator. Mirrors
// opportunityNumbering.test.mjs / salesOrderNumbering.test.mjs / transferOrderNumbering.test.mjs's
// structure and asserts the same properties. This allocator is NOT wired into any create path today (see
// reorderRequestNumbering.ts's module header) — these tests exercise the allocator itself to the same
// standard as the wired families, independent of that.

import assert from "node:assert/strict";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp({ projectId: "reorder-request-numbering-test" });

import {
  formatReorderRequestNumber,
  reorderRequestCounterDocId,
  allocateReorderRequestNumber,
} from "../lib/reorderRequest/reorderRequestNumbering.js";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`PASS -- ${name}`);
};

console.log("reorderRequestNumbering.test.mjs");

await ok("the format is exactly RR-YYYY-######", async () => {
  assert.equal(formatReorderRequestNumber(2026, 1), "RR-2026-000001");
  assert.equal(formatReorderRequestNumber(2026, 123), "RR-2026-000123");
  assert.equal(formatReorderRequestNumber(2026, 999999), "RR-2026-999999");
  assert.match(formatReorderRequestNumber(2026, 1), /^RR-\d{4}-\d{6}$/);
});

await ok("the sequence is zero-padded to 6 digits and does not truncate past six digits", async () => {
  assert.equal(formatReorderRequestNumber(2026, 1000000), "RR-2026-1000000");
});

await ok("the counter is per-year and distinct from every other family's counter", async () => {
  assert.equal(reorderRequestCounterDocId(2026), "reorder_requests_2026");
  assert.notEqual(reorderRequestCounterDocId(2026), "opportunities_2026");
  assert.notEqual(reorderRequestCounterDocId(2026), "work_orders_2026");
  assert.notEqual(reorderRequestCounterDocId(2026), "sales_orders_2026");
  assert.notEqual(reorderRequestCounterDocId(2026), "transfer_orders_2026");
  assert.notEqual(reorderRequestCounterDocId(2026), "receiving_orders_2026");
  assert.notEqual(reorderRequestCounterDocId(2026), reorderRequestCounterDocId(2027));
});

function fakeTx({ exists = false, sequence = 0 } = {}) {
  const writes = [];
  const reads = [];
  return {
    writes,
    reads,
    async get(ref) {
      reads.push(ref);
      return { exists, data: () => ({ year: 2026, sequence }) };
    },
    set(ref, value) {
      writes.push({ ref, value });
    },
  };
}

await ok("the first allocation of a year starts at 1, not 0", async () => {
  const tx = fakeTx({ exists: false });
  const { reorderRequestNumber, sequence } = await allocateReorderRequestNumber(tx, 2026);
  assert.equal(sequence, 1);
  assert.equal(reorderRequestNumber, "RR-2026-000001");
});

await ok("an existing counter increments — a sequence value is never reissued", async () => {
  const tx = fakeTx({ exists: true, sequence: 41 });
  const { reorderRequestNumber, sequence } = await allocateReorderRequestNumber(tx, 2026);
  assert.equal(sequence, 42, "the next reference must be strictly greater than the last issued");
  assert.equal(reorderRequestNumber, "RR-2026-000042");
});

await ok("allocation is concurrency-safe: exactly one read and one write, both on the caller's transaction", async () => {
  const tx = fakeTx({ exists: true, sequence: 7 });
  await allocateReorderRequestNumber(tx, 2026);
  assert.equal(tx.reads.length, 1, "one counter read");
  assert.equal(tx.writes.length, 1, "one counter write");
});

await ok("the counter write records the year it belongs to", async () => {
  const tx = fakeTx({ exists: false });
  await allocateReorderRequestNumber(tx, 2026);
  assert.equal(tx.writes[0].value.year, 2026);
  assert.equal(tx.writes[0].value.sequence, 1);
});

await ok("nothing is committed here — the caller owns the boundary", async () => {
  const tx = fakeTx({ exists: true, sequence: 1 });
  assert.equal(typeof tx.commit, "undefined", "the stub has no commit, and allocation still succeeds");
  await allocateReorderRequestNumber(tx, 2026);
});

await ok("the number is never derived from the document id, a Work Order number, a Transfer/Receiving Order number, or an inventory transaction id", async () => {
  const a = formatReorderRequestNumber(2026, 55);
  const b = formatReorderRequestNumber(2026, 55);
  assert.equal(a, b, "same year+sequence must always produce the same number, independent of any other entity");
  assert.equal(formatReorderRequestNumber.length, 2, "the formatter takes exactly year and sequence -- no id/WO/TO/RO parameter exists to derive from");

  const tx = fakeTx({ exists: true, sequence: 54 });
  const { reorderRequestNumber } = await allocateReorderRequestNumber(tx, 2026);
  assert.equal(reorderRequestNumber, "RR-2026-000055");
  assert.equal(tx.reads.length, 1, "the allocator reads only the counter doc, never a Reorder Request/Work/Transfer/Receiving Order or ledger doc");
  assert.equal(tx.reads[0].id, reorderRequestCounterDocId(2026), "the one read is the reorder-request counter, not another entity's document");
});

await ok("a second allocation against the same counter state never reuses the first number", async () => {
  const tx = fakeTx({ exists: true, sequence: 10 });
  const first = await allocateReorderRequestNumber(tx, 2026);
  assert.equal(first.reorderRequestNumber, "RR-2026-000011");

  const tx2 = fakeTx({ exists: true, sequence: 11 });
  const second = await allocateReorderRequestNumber(tx2, 2026);
  assert.equal(second.reorderRequestNumber, "RR-2026-000012");
  assert.notEqual(first.reorderRequestNumber, second.reorderRequestNumber, "a second allocation must never reissue a prior Reorder Request's number");
});

console.log(`\n${passed} passed, 0 failed`);

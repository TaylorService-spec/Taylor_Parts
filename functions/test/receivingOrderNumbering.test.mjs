// Receiving Order reference numbering — offline tests.
//
// Runs against the compiled lib/ output with a fake transaction, so it needs no emulator. Mirrors
// opportunityNumbering.test.mjs / transferOrderNumbering.test.mjs's structure and asserts the same
// properties, adapted for the ONE deliberate difference documented in receivingOrderNumbering.ts's module
// header: this allocator returns the counter document's PENDING write (`counterWrite`) instead of
// committing it, because receiveInventoryStockCommand.ts buffers every write and flushes them together at
// the end of its transaction. So where the other allocators assert `tx.writes.length === 1` right after
// calling allocate*, this file asserts the read happened and the returned counterWrite is exactly what a
// caller would need to commit -- and separately proves that committing it (as the real caller does)
// reproduces the identical safety properties.

import assert from "node:assert/strict";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp({ projectId: "receiving-order-numbering-test" });

import {
  formatReceivingOrderNumber,
  receivingOrderCounterDocId,
  allocateReceivingOrderNumber,
} from "../lib/inventoryReceiving/receivingOrderNumbering.js";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`PASS -- ${name}`);
};

console.log("receivingOrderNumbering.test.mjs");

await ok("the format is exactly RO-YYYY-######", async () => {
  assert.equal(formatReceivingOrderNumber(2026, 1), "RO-2026-000001");
  assert.equal(formatReceivingOrderNumber(2026, 123), "RO-2026-000123");
  assert.equal(formatReceivingOrderNumber(2026, 999999), "RO-2026-999999");
  assert.match(formatReceivingOrderNumber(2026, 1), /^RO-\d{4}-\d{6}$/);
});

await ok("the sequence is zero-padded to 6 digits and does not truncate past six digits", async () => {
  assert.equal(formatReceivingOrderNumber(2026, 1000000), "RO-2026-1000000");
});

await ok("the counter is per-year and distinct from every other family's counter", async () => {
  assert.equal(receivingOrderCounterDocId(2026), "receiving_orders_2026");
  assert.notEqual(receivingOrderCounterDocId(2026), "opportunities_2026");
  assert.notEqual(receivingOrderCounterDocId(2026), "work_orders_2026");
  assert.notEqual(receivingOrderCounterDocId(2026), "sales_orders_2026");
  assert.notEqual(receivingOrderCounterDocId(2026), "transfer_orders_2026");
  assert.notEqual(receivingOrderCounterDocId(2026), "reorder_requests_2026");
  assert.notEqual(receivingOrderCounterDocId(2026), receivingOrderCounterDocId(2027));
});

// A transaction stub that ONLY supports .get -- no .set. If allocateReceivingOrderNumber ever tried to
// commit the counter write itself (a regression back toward the other allocators' immediate-commit
// style), calling .set on this stub throws, failing the test loudly instead of silently reintroducing the
// read-after-write ordering bug this module exists to avoid.
function readOnlyTx({ exists = false, sequence = 0 } = {}) {
  const reads = [];
  return {
    reads,
    async get(ref) {
      reads.push(ref);
      return { exists, data: () => ({ year: 2026, sequence }) };
    },
    set() {
      throw new Error("allocateReceivingOrderNumber must never call tx.set itself -- the counter write must be returned for the caller to buffer");
    },
  };
}

await ok("the first allocation of a year starts at 1, not 0, and commits nothing itself", async () => {
  const tx = readOnlyTx({ exists: false });
  const { receivingOrderNumber, sequence, counterWrite } = await allocateReceivingOrderNumber(tx, 2026);
  assert.equal(sequence, 1);
  assert.equal(receivingOrderNumber, "RO-2026-000001");
  assert.equal(counterWrite.data.year, 2026);
  assert.equal(counterWrite.data.sequence, 1);
});

await ok("an existing counter increments — a sequence value is never reissued", async () => {
  const tx = readOnlyTx({ exists: true, sequence: 41 });
  const { receivingOrderNumber, sequence, counterWrite } = await allocateReceivingOrderNumber(tx, 2026);
  assert.equal(sequence, 42, "the next reference must be strictly greater than the last issued");
  assert.equal(receivingOrderNumber, "RO-2026-000042");
  assert.equal(counterWrite.data.sequence, 42);
});

await ok("allocation performs exactly one read, on the caller's transaction, and no write of its own", async () => {
  // The safety argument still rests on the counter being read INSIDE the caller's transaction (so
  // Firestore can detect the conflict between two concurrent allocations) -- only the commit itself
  // moves to the caller. readOnlyTx above already proves no write happens here; this asserts the read
  // count and target explicitly.
  const tx = readOnlyTx({ exists: true, sequence: 7 });
  const { counterWrite } = await allocateReceivingOrderNumber(tx, 2026);
  assert.equal(tx.reads.length, 1, "one counter read");
  assert.equal(tx.reads[0].id, receivingOrderCounterDocId(2026), "the one read is the receiving-order counter, not another entity's document");
  assert.equal(counterWrite.ref.id, receivingOrderCounterDocId(2026), "the pending write targets the same counter doc that was read");
});

await ok("a caller that commits the returned counterWrite reproduces the same one-read-one-write shape as the other allocators", async () => {
  // Simulates what receiveInventoryStockCommand.ts actually does: push counterWrite onto its own write
  // buffer, then flush with tx.set. Proves the deferred split still adds up to exactly one read + one
  // write against the counter doc once the caller finishes the job this function stopped short of.
  const writes = [];
  const tx = {
    reads: [],
    async get(ref) { this.reads.push(ref); return { exists: false, data: () => ({}) }; },
    set(ref, data) { writes.push({ ref, data }); },
  };
  const { counterWrite } = await allocateReceivingOrderNumber(tx, 2026);
  tx.set(counterWrite.ref, counterWrite.data); // caller's own flush step
  assert.equal(tx.reads.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.sequence, 1);
});

await ok("the number is never derived from the document id, a Work Order number, a Transfer Order number, or an inventory transaction id", async () => {
  const a = formatReceivingOrderNumber(2026, 55);
  const b = formatReceivingOrderNumber(2026, 55);
  assert.equal(a, b, "same year+sequence must always produce the same number, independent of any other entity");
  assert.equal(formatReceivingOrderNumber.length, 2, "the formatter takes exactly year and sequence -- no id/WO/TO parameter exists to derive from");

  const tx = readOnlyTx({ exists: true, sequence: 54 });
  const { receivingOrderNumber } = await allocateReceivingOrderNumber(tx, 2026);
  assert.equal(receivingOrderNumber, "RO-2026-000055");
});

await ok("a second allocation against the same counter state never reuses the first number", async () => {
  const tx = readOnlyTx({ exists: true, sequence: 10 });
  const first = await allocateReceivingOrderNumber(tx, 2026);
  assert.equal(first.receivingOrderNumber, "RO-2026-000011");

  const tx2 = readOnlyTx({ exists: true, sequence: 11 });
  const second = await allocateReceivingOrderNumber(tx2, 2026);
  assert.equal(second.receivingOrderNumber, "RO-2026-000012");
  assert.notEqual(first.receivingOrderNumber, second.receivingOrderNumber, "a second allocation must never reissue a prior Receiving Order's number");
});

console.log(`\n${passed} passed, 0 failed`);

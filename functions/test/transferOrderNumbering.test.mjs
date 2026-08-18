// Transfer Order reference numbering — offline tests.
//
// Runs against the compiled lib/ output with a fake transaction, so it needs no emulator. Mirrors
// opportunityNumbering.test.mjs / salesOrderNumbering.test.mjs's structure and asserts the same
// properties, plus the identity-independence property specific to a Transfer Order: its number must
// never be derived from another entity's identity (its own document id, a Work Order number, a Receiving
// Order number, or an inventory transaction id).

import assert from "node:assert/strict";
import admin from "firebase-admin";

// Building a DocumentReference needs an initialized app but touches no network — the counter ref is
// constructed locally and handed to the caller's transaction, which is a stub here. No emulator, no
// credentials, no I/O.
if (!admin.apps.length) admin.initializeApp({ projectId: "transfer-order-numbering-test" });

import {
  formatTransferOrderNumber,
  transferOrderCounterDocId,
  allocateTransferOrderNumber,
} from "../lib/inventoryTransfer/transferOrderNumbering.js";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`PASS -- ${name}`);
};

console.log("transferOrderNumbering.test.mjs");

await ok("the format is exactly TO-YYYY-######", async () => {
  assert.equal(formatTransferOrderNumber(2026, 1), "TO-2026-000001");
  assert.equal(formatTransferOrderNumber(2026, 123), "TO-2026-000123");
  assert.equal(formatTransferOrderNumber(2026, 999999), "TO-2026-999999");
  assert.match(formatTransferOrderNumber(2026, 1), /^TO-\d{4}-\d{6}$/);
});

await ok("the sequence is zero-padded to 6 digits and does not truncate past six digits", async () => {
  assert.equal(formatTransferOrderNumber(2026, 1000000), "TO-2026-1000000");
});

await ok("the counter is per-year and distinct from every other family's counter", async () => {
  assert.equal(transferOrderCounterDocId(2026), "transfer_orders_2026");
  assert.notEqual(transferOrderCounterDocId(2026), "opportunities_2026");
  assert.notEqual(transferOrderCounterDocId(2026), "work_orders_2026");
  assert.notEqual(transferOrderCounterDocId(2026), "sales_orders_2026");
  assert.notEqual(transferOrderCounterDocId(2026), "receiving_orders_2026");
  assert.notEqual(transferOrderCounterDocId(2026), "reorder_requests_2026");
  assert.notEqual(transferOrderCounterDocId(2026), transferOrderCounterDocId(2027));
});

// A transaction stub: records what was read and written so the concurrency contract can be asserted
// without an emulator.
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
  const { transferOrderNumber, sequence } = await allocateTransferOrderNumber(tx, 2026);
  assert.equal(sequence, 1);
  assert.equal(transferOrderNumber, "TO-2026-000001");
});

await ok("an existing counter increments — a sequence value is never reissued", async () => {
  const tx = fakeTx({ exists: true, sequence: 41 });
  const { transferOrderNumber, sequence } = await allocateTransferOrderNumber(tx, 2026);
  assert.equal(sequence, 42, "the next reference must be strictly greater than the last issued");
  assert.equal(transferOrderNumber, "TO-2026-000042");
});

await ok("allocation is concurrency-safe: exactly one read and one write, both on the caller's transaction", async () => {
  // The whole safety argument rests on this. If the counter were read or written outside the caller's
  // transaction, Firestore could not detect the conflict between two concurrent allocations and two
  // Transfer Orders could receive the same reference.
  const tx = fakeTx({ exists: true, sequence: 7 });
  await allocateTransferOrderNumber(tx, 2026);
  assert.equal(tx.reads.length, 1, "one counter read");
  assert.equal(tx.writes.length, 1, "one counter write");
});

await ok("the counter write records the year it belongs to", async () => {
  const tx = fakeTx({ exists: false });
  await allocateTransferOrderNumber(tx, 2026);
  assert.equal(tx.writes[0].value.year, 2026);
  assert.equal(tx.writes[0].value.sequence, 1);
});

await ok("nothing is committed here — the caller owns the boundary", async () => {
  // If this module committed, a reference could be allocated while the Transfer Order write that
  // motivated it failed, leaving a burned number and a gap in the sequence.
  const tx = fakeTx({ exists: true, sequence: 1 });
  assert.equal(typeof tx.commit, "undefined", "the stub has no commit, and allocation still succeeds");
  await allocateTransferOrderNumber(tx, 2026);
});

await ok("the number is never derived from the document id, a Work Order number, a Receiving Order number, or an inventory transaction id", async () => {
  // formatTransferOrderNumber's only inputs are year + sequence. Assert that directly: for a fixed year
  // and sequence the output is fully determined, independent of any other entity's identity, because
  // those values are never passed in at all.
  const a = formatTransferOrderNumber(2026, 55);
  const b = formatTransferOrderNumber(2026, 55);
  assert.equal(a, b, "same year+sequence must always produce the same number, independent of any other entity");
  assert.equal(formatTransferOrderNumber.length, 2, "the formatter takes exactly year and sequence -- no id/WO/RO/ledger parameter exists to derive from");

  // And the allocator's only Firestore interaction is the per-year counter doc -- it never reads a
  // transfer_orders document, a Work Order, a Receiving Order, or an inventory_transactions doc to
  // compute the number.
  const tx = fakeTx({ exists: true, sequence: 54 });
  const { transferOrderNumber } = await allocateTransferOrderNumber(tx, 2026);
  assert.equal(transferOrderNumber, "TO-2026-000055");
  assert.equal(tx.reads.length, 1, "the allocator reads only the counter doc, never a Transfer/Work/Receiving Order or ledger doc");
  assert.equal(tx.reads[0].id, transferOrderCounterDocId(2026), "the one read is the transfer-order counter, not another entity's document");
});

await ok("a second allocation against the same counter state never reuses the first number", async () => {
  // Immutability is enforced by construction, not by a runtime guard: allocation happens exactly once,
  // at creation, inside the SAME transaction as the document write (see transferOrderCommand.ts's
  // createTransferOrder). No transition path (dispatch/receive/cancel) calls allocateTransferOrderNumber
  // at all. What IS testable here is that allocation is not idempotent by itself -- calling it twice
  // against advancing counter state produces two DIFFERENT numbers, never the same one silently reused.
  const tx = fakeTx({ exists: true, sequence: 10 });
  const first = await allocateTransferOrderNumber(tx, 2026);
  assert.equal(first.transferOrderNumber, "TO-2026-000011");

  const tx2 = fakeTx({ exists: true, sequence: 11 });
  const second = await allocateTransferOrderNumber(tx2, 2026);
  assert.equal(second.transferOrderNumber, "TO-2026-000012");
  assert.notEqual(first.transferOrderNumber, second.transferOrderNumber, "a second allocation must never reissue a prior Transfer Order's number");
});

console.log(`\n${passed} passed, 0 failed`);

// Opportunity reference numbering — offline tests.
//
// Runs against the compiled lib/ output with a fake transaction, so it needs no
// emulator. The properties under test are the ones that make a reference safe to put
// in front of a user and in another record's lineage: it is never reused, it never
// exists without its record, and its shape is stable.

import assert from "node:assert/strict";
import admin from "firebase-admin";

// Building a DocumentReference needs an initialized app but touches no network — the
// counter ref is constructed locally and handed to the caller's transaction, which is
// a stub here. No emulator, no credentials, no I/O.
if (!admin.apps.length) admin.initializeApp({ projectId: "opportunity-numbering-test" });

import {
  formatOpportunityNumber,
  opportunityCounterDocId,
  allocateOpportunityNumber,
} from "../lib/opportunity/opportunityNumbering.js";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`PASS -- ${name}`);
};

console.log("opportunityNumbering.test.mjs");

await ok("the format is stable, zero-padded, and readable aloud", async () => {
  assert.equal(formatOpportunityNumber(2026, 1), "OPP-2026-000001");
  assert.equal(formatOpportunityNumber(2026, 123), "OPP-2026-000123");
  assert.equal(formatOpportunityNumber(2026, 999999), "OPP-2026-999999");
});

await ok("padding does not truncate once the sequence outgrows six digits", async () => {
  // Better a longer reference than a colliding one. Asserted so nobody 'fixes' the
  // padding into a slice() and silently makes 1000000 collide with 000000.
  assert.equal(formatOpportunityNumber(2026, 1000000), "OPP-2026-1000000");
});

await ok("the counter is per-year and distinct from the Work Order counter", async () => {
  assert.equal(opportunityCounterDocId(2026), "opportunities_2026");
  assert.notEqual(opportunityCounterDocId(2026), "work_orders_2026");
  assert.notEqual(opportunityCounterDocId(2026), opportunityCounterDocId(2027));
});

// A transaction stub: records what was read and written so the concurrency contract
// can be asserted without an emulator.
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
  const { opportunityNumber, sequence } = await allocateOpportunityNumber(tx, 2026);
  assert.equal(sequence, 1);
  assert.equal(opportunityNumber, "OPP-2026-000001");
});

await ok("an existing counter increments — a sequence value is never reissued", async () => {
  const tx = fakeTx({ exists: true, sequence: 41 });
  const { opportunityNumber, sequence } = await allocateOpportunityNumber(tx, 2026);
  assert.equal(sequence, 42, "the next reference must be strictly greater than the last issued");
  assert.equal(opportunityNumber, "OPP-2026-000042");
});

await ok("exactly one read and one write, both on the caller's transaction", async () => {
  // The whole safety argument rests on this. If the counter were read or written
  // outside the caller's transaction, Firestore could not detect the conflict between
  // two concurrent allocations and two Opportunities could receive the same reference.
  const tx = fakeTx({ exists: true, sequence: 7 });
  await allocateOpportunityNumber(tx, 2026);
  assert.equal(tx.reads.length, 1, "one counter read");
  assert.equal(tx.writes.length, 1, "one counter write");
});

await ok("the counter write records the year it belongs to", async () => {
  const tx = fakeTx({ exists: false });
  await allocateOpportunityNumber(tx, 2026);
  assert.equal(tx.writes[0].value.year, 2026);
  assert.equal(tx.writes[0].value.sequence, 1);
});

await ok("nothing is committed here — the caller owns the boundary", async () => {
  // If this module committed, a reference could be allocated while the Opportunity
  // write that motivated it failed, leaving a burned number and a gap in the sequence.
  const tx = fakeTx({ exists: true, sequence: 1 });
  assert.equal(typeof tx.commit, "undefined", "the stub has no commit, and allocation still succeeds");
  await allocateOpportunityNumber(tx, 2026);
});

console.log(`\n${passed} passed, 0 failed`);

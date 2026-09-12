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
// Updated for the hardened allocator (functions/src/numbering/businessNumber.ts). Allocation is no
// longer one read + one write: the allocator also PROBES the business-number claim ledger (reads) and
// CLAIMS the number it takes (a `create`, which is the hard duplicate barrier). The assertions below
// still pin "exactly one counter read and one counter write" -- they just count the counter's reads
// and writes specifically rather than every read and write on the transaction.
const CLAIMS = "business_number_claims";
const isClaim = (ref) => ref.path.startsWith(`${CLAIMS}/`);

function fakeTx({ exists = false, sequence = 0, claimed = new Set() } = {}) {
  const writes = [];
  const reads = [];
  const counterReads = [];
  const claimReads = [];
  const counterWrites = [];
  const claimWrites = [];
  const snapFor = (ref) => {
    reads.push(ref);
    if (isClaim(ref)) {
      claimReads.push(ref);
      return { exists: claimed.has(ref.id), id: ref.id, ref, data: () => ({}) };
    }
    counterReads.push(ref);
    return { exists, id: ref.id, ref, data: () => ({ year: 2026, sequence }) };
  };
  return {
    writes, reads, counterReads, claimReads, counterWrites, claimWrites,
    async get(ref) { return snapFor(ref); },
    async getAll(...refs) { return refs.flat().map(snapFor); },
    set(ref, value) {
      writes.push({ ref, value });
      (isClaim(ref) ? claimWrites : counterWrites).push({ ref, value });
    },
    create(ref, value) {
      if (isClaim(ref) && claimed.has(ref.id)) {
        const err = new Error(`6 ALREADY_EXISTS: entity already exists: ${ref.path}`);
        err.code = 6;
        throw err;
      }
      writes.push({ ref, value });
      (isClaim(ref) ? claimWrites : counterWrites).push({ ref, value });
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
  assert.equal(tx.counterReads.length, 1, "one counter read");
  assert.equal(tx.counterWrites.length, 1, "one counter write");
  assert.equal(tx.claimWrites.length, 1, "and exactly one claim, so the number can never be reissued");
});

await ok("the counter write records the year it belongs to", async () => {
  const tx = fakeTx({ exists: false });
  await allocateOpportunityNumber(tx, 2026);
  assert.equal(tx.counterWrites[0].value.year, 2026);
  assert.equal(tx.counterWrites[0].value.sequence, 1);
});

await ok("nothing is committed here — the caller owns the boundary", async () => {
  // If this module committed, a reference could be allocated while the Opportunity
  // write that motivated it failed, leaving a burned number and a gap in the sequence.
  const tx = fakeTx({ exists: true, sequence: 1 });
  assert.equal(typeof tx.commit, "undefined", "the stub has no commit, and allocation still succeeds");
  await allocateOpportunityNumber(tx, 2026);
});

console.log(`\n${passed} passed, 0 failed`);

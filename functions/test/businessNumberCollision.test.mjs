// P3-0B -- business-number allocator collision REPRODUCTION + regression suite.
//
// Business numbers (WO-2026-000001 and its seven siblings) are the human-facing, operator-spoken
// document numbers. They are NOT the system's internal record identity -- that separation is
// deliberate and is preserved here: nothing in this file imports or depends on the Record ID standard.
//
// WHAT THIS REPRODUCES. Every allocator computed its next sequence as
//     snap.exists ? counter.sequence + 1 : 1
// The `: 1` branch is unconditional: if the counter document for a (family, year) is ever absent when
// records for that (family, year) already exist -- lost, deleted, restored from a backup taken before
// the last allocations, or written to a fresh project -- the allocator silently restarts at 1 and
// reissues WO-2026-000001 to a second work order. There was no max-existing check and no claim
// record: nothing in the transaction could observe that the number was already in use.
//
// A SECOND, RELATED DEFECT this file also pins: a counter document that exists but whose `sequence`
// is missing or non-numeric produced `undefined + 1 === NaN`, and `String(NaN).padStart(6,"0")`
// renders "000NaN" -- i.e. the allocator emitted the literal reference "WO-2026-000NaN" rather than
// failing. Two such allocations produce the same string, so this is a duplicate-number path too.
//
// SCOPE OF WHAT THIS CAN PROVE OFFLINE. These tests drive the allocators through a fake transaction
// backed by an in-memory store, so they prove the ALLOCATION ARITHMETIC and the claim-ledger logic
// exactly. They do NOT prove Firestore's optimistic-concurrency retry -- that needs the real emulator
// (functions/test/operationalNumberingContention.test.mjs), which cannot run in this environment.
import assert from "node:assert/strict";
import test from "node:test";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp({ projectId: "business-number-collision-test" });

const { allocateWorkOrderNumber } = await import("../lib/woNumbering.js");
const { allocateOpportunityNumber } = await import("../lib/opportunity/opportunityNumbering.js");
const { allocateSalesOrderNumber } = await import("../lib/salesOrder/salesOrderNumbering.js");
const { allocateSalesAgreementNumber } = await import("../lib/salesAgreement/salesAgreementNumbering.js");
const { allocateTransferOrderNumber } = await import("../lib/inventoryTransfer/transferOrderNumbering.js");
const { allocateReorderRequestNumber } = await import("../lib/reorderRequest/reorderRequestNumbering.js");
const { allocateReceivingOrderNumber } = await import("../lib/inventoryReceiving/receivingOrderNumbering.js");
const { allocateInvoiceNumber } = await import("../lib/finance/invoiceNumbering.js");

// ---------------------------------------------------------------------------
// A minimal in-memory Firestore stand-in. Only what the allocators touch:
// DocumentReference identity by path, tx.get / tx.getAll / tx.set / tx.create.
// `create` throws on an existing document, exactly as Firestore's does -- that
// is the property the claim ledger relies on.
// ---------------------------------------------------------------------------
class FakeStore {
  constructor() { this.docs = new Map(); }
  has(path) { return this.docs.has(path); }
  set(path, data) { this.docs.set(path, data); }
  delete(path) { this.docs.delete(path); }
  /** Simulate counter loss: the counter document disappears, records survive. */
  loseCounter(path) { this.delete(path); }
}

function fakeTx(store) {
  const reads = [];
  const writes = [];
  let wroteYet = false;
  const snapFor = (ref) => ({
    exists: store.has(ref.path),
    id: ref.id,
    ref,
    data: () => store.docs.get(ref.path),
  });
  return {
    reads,
    writes,
    async get(ref) {
      assert.equal(wroteYet, false, "Firestore forbids a read after a write inside a transaction");
      reads.push(ref.path);
      return snapFor(ref);
    },
    async getAll(...refs) {
      assert.equal(wroteYet, false, "Firestore forbids a read after a write inside a transaction");
      const list = refs.flat();
      for (const r of list) reads.push(r.path);
      return list.map(snapFor);
    },
    set(ref, value) {
      wroteYet = true;
      writes.push({ op: "set", path: ref.path, value });
      store.set(ref.path, value);
    },
    create(ref, value) {
      wroteYet = true;
      if (store.has(ref.path)) {
        const err = new Error(`6 ALREADY_EXISTS: entity already exists: ${ref.path}`);
        err.code = 6;
        throw err;
      }
      writes.push({ op: "create", path: ref.path, value });
      store.set(ref.path, value);
      return this;
    },
  };
}

// Each allocator, reduced to a uniform shape so one body of tests covers all eight.
// `run(tx, store)` performs one allocation and returns the human-facing number.
const ALLOCATORS = [
  {
    family: "workOrder", prefix: "WO", first: "WO-2026-000001",
    counterPath: "counters/work_orders_2026",
    run: async (tx) => (await allocateWorkOrderNumber(tx, 2026)).woNumber,
  },
  {
    family: "opportunity", prefix: "OPP", first: "OPP-2026-000001",
    counterPath: "counters/opportunities_2026",
    run: async (tx) => (await allocateOpportunityNumber(tx, 2026)).opportunityNumber,
  },
  {
    family: "salesOrder", prefix: "SO", first: "SO-2026-000001",
    counterPath: "counters/sales_orders_2026",
    run: async (tx) => (await allocateSalesOrderNumber(tx, 2026)).salesOrderNumber,
  },
  {
    family: "salesAgreement", prefix: "SA", first: "SA-2026-000001",
    counterPath: "counters/sales_agreements_2026",
    run: async (tx) => (await allocateSalesAgreementNumber(tx, 2026)).salesAgreementNumber,
  },
  {
    family: "transferOrder", prefix: "TO", first: "TO-2026-000001",
    counterPath: "counters/transfer_orders_2026",
    run: async (tx) => (await allocateTransferOrderNumber(tx, 2026)).transferOrderNumber,
  },
  {
    family: "reorderRequest", prefix: "RR", first: "RR-2026-000001",
    counterPath: "counters/reorder_requests_2026",
    run: async (tx) => (await allocateReorderRequestNumber(tx, 2026)).reorderRequestNumber,
  },
  {
    // Deferred-commit caller pattern: the allocator hands back the counter write for the
    // caller to flush. Mirrors receiveInventoryStockCommand.ts exactly.
    family: "receivingOrder", prefix: "RO", first: "RO-2026-000001",
    counterPath: "counters/receiving_orders_2026",
    run: async (tx) => {
      const allocated = await allocateReceivingOrderNumber(tx, 2026);
      for (const w of allocated.pendingWrites ?? [{ op: "set", ref: allocated.counterWrite.ref, data: allocated.counterWrite.data }]) {
        if (w.op === "create") tx.create(w.ref, w.data);
        else tx.set(w.ref, w.data);
      }
      return allocated.receivingOrderNumber;
    },
  },
  {
    // Per-company, not per-year: the only allocator keyed on companyId.
    family: "invoice", prefix: "INV", first: "INV-000001",
    counterPath: "counters/invoices_acme",
    run: async (tx) => (await allocateInvoiceNumber(tx, "acme")).invoiceNumber,
  },
];

// ---------------------------------------------------------------------------
// THE REPRODUCTION.
// ---------------------------------------------------------------------------
for (const a of ALLOCATORS) {
  test(`${a.family}: counter loss must not reissue ${a.first}`, async () => {
    const store = new FakeStore();
    const issued = [];

    // Three normal allocations. The counter document accumulates as designed.
    for (let i = 0; i < 3; i += 1) issued.push(await a.run(fakeTx(store)));
    assert.equal(issued[0], a.first, "sanity: the first number of the series");
    assert.equal(new Set(issued).size, 3, "sanity: normal operation issues distinct numbers");
    assert.ok(store.has(a.counterPath), `sanity: counter lives at ${a.counterPath}`);

    // THE FAULT: the counter document is lost. Every allocated record survives.
    store.loseCounter(a.counterPath);

    // The next allocation must NOT hand out a number that is already in operators' hands.
    // Before hardening this threw nothing and returned `${a.first}` a second time.
    let reissued = null;
    try {
      reissued = await a.run(fakeTx(store));
    } catch (err) {
      // Failing closed is an acceptable outcome: a gap or an error beats a duplicate.
      assert.match(String(err && err.message), /ALREADY_EXISTS|BusinessNumber/i,
        `${a.family}: refusal must name the collision, got: ${err && err.message}`);
      return;
    }
    assert.ok(
      !issued.includes(reissued),
      `${a.family}: DUPLICATE BUSINESS NUMBER -- after counter loss the allocator reissued ${reissued}, ` +
      `which is already held by an existing record (previously issued: ${JSON.stringify(issued)})`
    );
  });

  test(`${a.family}: a corrupt counter must never render a number containing NaN`, async () => {
    const store = new FakeStore();
    const first = await a.run(fakeTx(store));
    assert.equal(first, a.first);

    // The counter document exists but its `sequence` is gone (a partial write, a bad restore,
    // a hand-edit). `snap.exists` is true, so the `: 1` fallback does not engage.
    const corrupt = { ...store.docs.get(a.counterPath) };
    delete corrupt.sequence;
    store.set(a.counterPath, corrupt);

    let out = null;
    try {
      out = await a.run(fakeTx(store));
    } catch (err) {
      assert.match(String(err && err.message), /BusinessNumber|sequence/i,
        `${a.family}: refusal must explain the corrupt counter, got: ${err && err.message}`);
      return;
    }
    assert.doesNotMatch(String(out), /NaN|undefined/,
      `${a.family}: allocator rendered a malformed reference from a corrupt counter: ${out}`);
  });
}

// ---------------------------------------------------------------------------
// FORMAT PRESERVATION. Operators read, speak and file by these numbers; hardening
// must not have altered a single character of any of them.
// ---------------------------------------------------------------------------
test("every human-facing format is unchanged by hardening", async () => {
  for (const a of ALLOCATORS) {
    const store = new FakeStore();
    const n = await a.run(fakeTx(store));
    assert.equal(n, a.first, `${a.family}: first number of the series must be exactly ${a.first}`);
    if (a.family === "invoice") {
      assert.match(n, /^INV-\d{6}$/, "invoice numbers are per-company, with no year segment");
    } else {
      assert.match(n, new RegExp(`^${a.prefix}-2026-\\d{6}$`), `${a.family}: PREFIX-YYYY-######`);
    }
  }
});

// ---------------------------------------------------------------------------
// SEQUENCE GAPS ARE ACCEPTABLE; DUPLICATES ARE NOT. A hardened allocator is allowed
// to skip forward past a number already in use -- it must never hand the same number out twice.
// ---------------------------------------------------------------------------
test("no allocator ever issues the same number twice across a long run", async () => {
  for (const a of ALLOCATORS) {
    const store = new FakeStore();
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) {
      const n = await a.run(fakeTx(store));
      assert.ok(!seen.has(n), `${a.family}: reissued ${n} on iteration ${i}`);
      seen.add(n);
    }
    assert.equal(seen.size, 40);
  }
});

// Finance — per-company invoice numbering. Tests the transactional allocation logic with a FAKE transaction
// (no emulator): sequence increments, per-company isolation, concurrency-safe shape (one read + one write on
// the company counter inside the caller's tx). Prereq: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" }); // builds refs offline; the fake tx never hits the network
const { allocateInvoiceNumber, formatInvoiceNumber, InvoiceNumberingError } = await import("../lib/finance/invoiceNumbering.js");

// A fake transaction. `existing` stubs the counter; `claimed` stubs the business-number claim ledger
// (functions/src/numbering/businessNumber.ts), which the hardened allocator probes with getAll and
// writes with create. `writes` keeps every write; `counterWrites` keeps only the counter's, so the
// original "one read + one write on the company counter" assertions still say exactly what they said.
const CLAIMS = "business_number_claims";
const isClaim = (ref) => ref.path.startsWith(`${CLAIMS}/`);

function fakeTx(existing, claimed = new Set()) {
  const writes = [];
  const counterWrites = [];
  const claimWrites = [];
  const counterReads = [];
  const snapFor = (ref) => {
    if (isClaim(ref)) return { exists: claimed.has(ref.id), id: ref.id, ref, data: () => ({}) };
    counterReads.push(ref);
    const d = existing.get(ref.path);
    return { exists: d !== undefined, id: ref.id, ref, data: () => d };
  };
  const record = (ref, doc) => {
    const entry = { path: ref.path, ref, doc };
    writes.push(entry);
    (isClaim(ref) ? claimWrites : counterWrites).push(entry);
  };
  return {
    writes, counterWrites, claimWrites, counterReads,
    async get(ref) { return snapFor(ref); },
    async getAll(...refs) { return refs.flat().map(snapFor); },
    set(ref, doc) { record(ref, doc); },
    create(ref, doc) {
      if (isClaim(ref) && claimed.has(ref.id)) {
        const err = new Error(`6 ALREADY_EXISTS: entity already exists: ${ref.path}`);
        err.code = 6;
        throw err;
      }
      record(ref, doc);
    },
  };
}

test("formatInvoiceNumber pads and prefixes (configurable)", () => {
  assert.equal(formatInvoiceNumber(42), "INV-000042");
  assert.equal(formatInvoiceNumber(7, { prefix: "TAY-", width: 4 }), "TAY-0007");
});

test("first allocation for a company starts at sequence 1", async () => {
  const tx = fakeTx(new Map());
  const r = await allocateInvoiceNumber(tx, "taylor");
  assert.equal(r.sequence, 1);
  assert.equal(r.invoiceNumber, "INV-000001");
  assert.equal(tx.counterWrites.length, 1, "one counter write");
  assert.equal(tx.claimWrites.length, 1, "and one claim, so INV-000001 can never be reissued");
  assert.equal(tx.claimWrites[0].ref.id, "INV-000001", "the claim is keyed on the human-facing number itself");
  assert.equal(tx.counterWrites[0].doc.sequence, 1);
  assert.equal(tx.counterWrites[0].doc.companyId, "taylor");
  assert.ok(tx.counterWrites[0].path.endsWith("counters/invoices_taylor"));
});

test("subsequent allocation increments the existing sequence", async () => {
  const path = "counters/invoices_taylor";
  const existing = new Map([[path, { companyId: "taylor", sequence: 5 }]]);
  const tx = fakeTx(existing);
  const r = await allocateInvoiceNumber(tx, "taylor");
  assert.equal(r.sequence, 6);
  assert.equal(r.invoiceNumber, "INV-000006");
});

test("sequences are PER-COMPANY (separate counter docs, never shared)", async () => {
  const a = fakeTx(new Map());
  const b = fakeTx(new Map());
  const ra = await allocateInvoiceNumber(a, "taylor");
  const rb = await allocateInvoiceNumber(b, "ventana");
  assert.ok(a.counterWrites[0].path.endsWith("counters/invoices_taylor"));
  assert.ok(b.counterWrites[0].path.endsWith("counters/invoices_ventana"));
  assert.equal(ra.sequence, 1);
  assert.equal(rb.sequence, 1); // independent, not global
});

test("companyId is required (never allocate a global/company-less number)", async () => {
  await assert.rejects(() => allocateInvoiceNumber(fakeTx(new Map()), ""), InvoiceNumberingError);
});

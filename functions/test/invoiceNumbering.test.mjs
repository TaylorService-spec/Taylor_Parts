// Finance — per-company invoice numbering. Tests the transactional allocation logic with a FAKE transaction
// (no emulator): sequence increments, per-company isolation, concurrency-safe shape (one read + one write on
// the company counter inside the caller's tx). Prereq: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" }); // builds refs offline; the fake tx never hits the network
const { allocateInvoiceNumber, formatInvoiceNumber, InvoiceNumberingError } = await import("../lib/finance/invoiceNumbering.js");

// A fake transaction: get() returns a stubbed counter snapshot; set() records the write + its ref path.
function fakeTx(existing) {
  const writes = [];
  return {
    writes,
    async get(ref) { const d = existing.get(ref.path); return { exists: d !== undefined, data: () => d }; },
    set(ref, doc) { writes.push({ path: ref.path, doc }); },
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
  assert.equal(tx.writes.length, 1);
  assert.equal(tx.writes[0].doc.sequence, 1);
  assert.equal(tx.writes[0].doc.companyId, "taylor");
  assert.ok(tx.writes[0].path.endsWith("counters/invoices_taylor"));
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
  assert.ok(a.writes[0].path.endsWith("counters/invoices_taylor"));
  assert.ok(b.writes[0].path.endsWith("counters/invoices_ventana"));
  assert.equal(ra.sequence, 1);
  assert.equal(rb.sequence, 1); // independent, not global
});

test("companyId is required (never allocate a global/company-less number)", async () => {
  await assert.rejects(() => allocateInvoiceNumber(fakeTx(new Map()), ""), InvoiceNumberingError);
});

// Finance — trusted AR read projection. Pure tests. Proves the AR position is DERIVED from facts (outstanding
// + due date), distinct from the invoice payment state, no PII leaked, and honest SETTLED/OVERDUE/CURRENT/VOID/
// UNKNOWN. Prereq: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectInvoiceAr, deriveArPosition, deriveOutstandingMinor, summarizeAccountAr } from "../lib/finance/financeReadProjection.js";

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;

test("outstanding is derived from facts (total − applied − credits + charges − writeoffs)", () => {
  assert.equal(deriveOutstandingMinor({ totalMinor: 10000, appliedMinor: 3000, creditsMinor: 1000, chargesMinor: 500, writeOffMinor: 500 }), 6000);
});

test("AR position: SETTLED when nothing owed (by payment OR write-off); state stays distinct", () => {
  assert.equal(deriveArPosition({ state: "ISSUED", totalMinor: 100, writeOffMinor: 100, dueDate: 0 }, now).position, "SETTLED");
  assert.equal(deriveArPosition({ state: "PARTIALLY_PAID", totalMinor: 100, appliedMinor: 100, dueDate: 0 }, now).position, "SETTLED");
});

test("AR position: OVERDUE (+daysOverdue) past due; CURRENT before; VOID; UNKNOWN without due date", () => {
  assert.deepEqual(deriveArPosition({ state: "ISSUED", totalMinor: 100, dueDate: 97 * DAY }, now), { position: "OVERDUE", daysOverdue: 3 });
  assert.deepEqual(deriveArPosition({ state: "ISSUED", totalMinor: 100, dueDate: 105 * DAY }, now), { position: "CURRENT", daysOverdue: 0 });
  assert.equal(deriveArPosition({ state: "VOID", totalMinor: 100 }, now).position, "VOID");
  assert.equal(deriveArPosition({ state: "ISSUED", totalMinor: 100 }, now).position, "UNKNOWN"); // no due date
});

test("projectInvoiceAr returns minimal fields (accountId only, no raw UID), derived outstanding + position", () => {
  const r = projectInvoiceAr("INV1", { invoiceNumber: "INV-000001", accountId: "A1", salesOrderId: "SO1", currency: "USD", state: "PARTIALLY_PAID", totalMinor: 10000, appliedMinor: 4000, dueDate: 97 * DAY }, now);
  assert.equal(r.invoiceId, "INV1");
  assert.equal(r.state, "PARTIALLY_PAID"); // payment lifecycle
  assert.equal(r.outstandingMinor, 6000); // derived
  assert.equal(r.arPosition, "OVERDUE");
  assert.equal(r.daysOverdue, 3);
  assert.equal("uid" in r || "createdBy" in r || "recordedBy" in r, false); // no principal identity leaked
});

test("summarizeAccountAr: honest counts + open balance by currency (mixed currencies not summed blindly)", () => {
  const reads = [
    projectInvoiceAr("a", { currency: "USD", state: "ISSUED", totalMinor: 5000, dueDate: 97 * DAY }, now), // overdue, open
    projectInvoiceAr("b", { currency: "USD", state: "PAID", totalMinor: 3000, appliedMinor: 3000 }, now), // settled
    projectInvoiceAr("c", { currency: "EUR", state: "ISSUED", totalMinor: 2000, dueDate: 200 * DAY }, now), // current, open EUR
  ];
  const s = summarizeAccountAr(reads);
  assert.equal(s.count, 3);
  assert.equal(s.openCount, 2);
  assert.equal(s.overdueCount, 1);
  assert.deepEqual(s.outstandingByCurrency, { USD: 5000, EUR: 2000 });
});

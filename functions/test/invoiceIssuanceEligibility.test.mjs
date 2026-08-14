// Finance — issueInvoice's transactional core cross-checked against the GOVERNED Sales Order (P1.8;
// lifecycle-audit `issueinvoice-unverified-so-pricing-and-qty` / `completion-to-billing-eligibility-unwired`).
// Same shape as commercialTransitionIdempotency.test.mjs: `persistIssuedInvoice` sits below the capability
// gate (finance.invoice.issue is registered active:false), so these tests exercise the transaction invariant
// -- tx.get the SO, cross-check accountId/currency/unitPrice/billing-eligible qty, idempotency replay --
// directly, without activating a dormant capability.
//
// Prerequisite: firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/invoiceIssuanceEligibility.test.mjs
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { persistIssuedInvoice } from "../lib/finance/invoiceCallables.js";
import { InvoiceCommandError } from "../lib/finance/invoiceCommands.js";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
let sequence = 0;
const id = (kind) => `${kind}-${Date.now()}-${++sequence}`;

async function seedSalesOrder(overrides = {}) {
  const soId = id("so");
  await db.collection("sales_orders").doc(soId).set({
    accountId: "ACCT-1",
    currency: "USD",
    state: "IN_FULFILLMENT",
    lines: [
      { kind: "PART", ref: "L1", unitPrice: 12000, orderedQty: 5, fulfilledQty: 5 },
      { kind: "SERVICE", ref: "L2", unitPrice: 5000, orderedQty: 2, fulfilledQty: 2 },
    ],
    ...overrides,
  });
  return soId;
}

const baseData = (salesOrderId) => ({
  idempotencyKey: id("key"),
  companyId: "taylor",
  accountId: "ACCT-1",
  salesOrderId,
  currency: "USD",
  dueDate: 1_800_000_000_000,
  billingAction: "BILL_NOW",
  lines: [
    { kind: "PART", ref: "L1", billableQty: 5, unitPriceMinor: 12000, taxMinor: 4785 },
    { kind: "SERVICE", ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 825 },
  ],
});

async function assertRejects(promise, matcher) {
  try {
    await promise;
    assert.fail("expected persistIssuedInvoice to reject");
  } catch (err) {
    assert.ok(matcher(err), `unexpected error: ${err && err.code ? err.code : err}`);
  }
}

test("issuing against a non-existent salesOrderId is rejected (failed-precondition, never a guess)", async () => {
  const data = baseData("SO-DOES-NOT-EXIST-" + id("x"));
  await assertRejects(
    db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, id("actor"))),
    (err) => err.code === "failed-precondition",
  );
});

test("client unitPriceMinor that does not match the SO's committed unit price snapshot is rejected (no re-pricing)", async () => {
  const soId = await seedSalesOrder();
  const data = baseData(soId);
  data.lines[0].unitPriceMinor = 99999; // does not match the SO's committed 12000
  await assertRejects(
    db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, id("actor"))),
    (err) => err instanceof InvoiceCommandError && err.code === "PRICE_MISMATCH",
  );
  const invoices = await db.collection("invoices").where("salesOrderId", "==", soId).get();
  assert.equal(invoices.empty, true, "no invoice is persisted on a rejected issuance");
});

test("billableQty exceeding the billing-eligible qty (fulfilledQty) is rejected", async () => {
  const soId = await seedSalesOrder({ lines: [
    { kind: "PART", ref: "L1", unitPrice: 12000, orderedQty: 5, fulfilledQty: 2 }, // only 2 of 5 fulfilled
    { kind: "SERVICE", ref: "L2", unitPrice: 5000, orderedQty: 2, fulfilledQty: 2 },
  ] });
  const data = baseData(soId); // claims billableQty 5 for L1, but only 2 are eligible
  await assertRejects(
    db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, id("actor"))),
    (err) => err instanceof InvoiceCommandError && err.code === "QTY_EXCEEDS_ELIGIBLE",
  );
  const invoices = await db.collection("invoices").where("salesOrderId", "==", soId).get();
  assert.equal(invoices.empty, true);
});

test("accountId / currency mismatch against the SO is rejected", async () => {
  const soId = await seedSalesOrder();
  const badAccount = { ...baseData(soId), accountId: "ACCT-WRONG" };
  await assertRejects(
    db.runTransaction((tx) => persistIssuedInvoice(db, tx, badAccount, id("actor"))),
    (err) => err instanceof InvoiceCommandError && err.code === "ACCOUNT_MISMATCH",
  );
  const badCurrency = { ...baseData(soId), currency: "CAD" };
  await assertRejects(
    db.runTransaction((tx) => persistIssuedInvoice(db, tx, badCurrency, id("actor"))),
    (err) => err instanceof InvoiceCommandError && err.code === "CURRENCY_MISMATCH",
  );
});

test("matching + eligible issuance succeeds with SO-derived amounts, and a retried idempotencyKey replays instead of re-issuing", async () => {
  const soId = await seedSalesOrder();
  const data = baseData(soId);
  const actorUid = id("actor");

  const first = await db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, actorUid));
  assert.equal(first.replayed, false);
  assert.ok(first.invoiceId);
  // subtotal 60000+10000=70000; tax 4785+825=5610; total 75610 -- amounts are SO-derived, not re-priced.
  assert.equal(first.totalMinor, 75_610);

  const stored = await db.collection("invoices").doc(first.invoiceId).get();
  assert.equal(stored.data().salesOrderId, soId);
  assert.equal(stored.data().totalMinor, 75_610);

  // Retry with the SAME idempotencyKey (client timeout retry / double-tap): must NOT re-issue or burn a new
  // sequence number -- it returns the SAME invoiceId.
  const retry = await db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, actorUid));
  assert.equal(retry.replayed, true);
  assert.equal(retry.invoiceId, first.invoiceId);

  const invoices = await db.collection("invoices").where("salesOrderId", "==", soId).get();
  assert.equal(invoices.size, 1, "the retry did not create a second invoice");
});

test("a different idempotency key cannot bill quantity already recorded on the Sales Order", async () => {
  const soId = await seedSalesOrder();
  const firstData = baseData(soId);
  await db.runTransaction((tx) => persistIssuedInvoice(db, tx, firstData, id("actor")));

  const afterFirst = await db.collection("sales_orders").doc(soId).get();
  assert.equal(afterFirst.data().lines.find((line) => line.ref === "L1").billedQty, 5);

  await assertRejects(
    db.runTransaction((tx) => persistIssuedInvoice(db, tx, baseData(soId), id("actor"))),
    (err) => err instanceof InvoiceCommandError && err.code === "QTY_EXCEEDS_ELIGIBLE",
  );
  const invoices = await db.collection("invoices").where("salesOrderId", "==", soId).get();
  assert.equal(invoices.size, 1, "a distinct idempotency key cannot produce a duplicate invoice");
});

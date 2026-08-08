// Finance INVOICE AMOUNT DERIVATION (Owner §3/§8) — pure tests. Proves amounts come from the SO unitPrice
// snapshot × billable qty (no re-pricing / no price book), concepts stay distinct, and missing price/tax fail
// closed (UNPRICED / REQUIRES_REVIEW) rather than inventing a number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveInvoiceLineAmounts } from "../src/domain/financeInvoiceAmounts.js";
import { money, rateFromBasisPoints, multiplyMoneyByRate } from "../src/domain/money.js";

const USD = "USD";
const price = (minor) => money(minor, USD);

test("READY: amounts = SO unitPrice snapshot × qty; distinct subtotal/discount/tax/total", () => {
  const billable = [{ ref: "L1", billableQty: 5 }, { ref: "L2", billableQty: 2 }];
  const priceByRef = { L1: price(12000), L2: price(5000) }; // $120.00, $50.00
  const discountByRef = { L1: price(2000) }; // $20.00 off L1
  // injected tax determination: 8.25% of taxable base, computed with the money engine (not invented here)
  const taxByRef = {
    L1: multiplyMoneyByRate(money(12000 * 5 - 2000, USD), rateFromBasisPoints(825)), // (60000-2000)*8.25%
    L2: multiplyMoneyByRate(money(5000 * 2, USD), rateFromBasisPoints(825)),
  };
  const r = deriveInvoiceLineAmounts({ billable, priceByRef, discountByRef, taxDetermination: { byRef: taxByRef, provenance: "test-engine" }, currency: USD });
  assert.equal(r.status, "READY");
  const l1 = r.lines.find((l) => l.ref === "L1");
  assert.equal(l1.subtotal.minor, 60000);
  assert.equal(l1.discount.minor, 2000);
  assert.equal(l1.taxableBase.minor, 58000);
  assert.equal(l1.tax.minor, 4785); // 58000 * 8.25% = 4785
  assert.equal(l1.lineTotal.minor, 58000 + 4785);
  assert.equal(r.totals.total.minor, r.lines.reduce((s, l) => s + l.lineTotal.minor, 0));
  assert.equal(r.taxProvenance, "test-engine");
});

test("UNPRICED: a billable line with no committed price fails closed (no re-pricing / no price book)", () => {
  const r = deriveInvoiceLineAmounts({
    billable: [{ ref: "L1", billableQty: 1 }],
    priceByRef: {}, // no SO snapshot price
    taxDetermination: { byRef: { L1: money(0, "USD") } },
    currency: "USD",
  });
  assert.equal(r.status, "UNPRICED");
  assert.equal(r.totals.total, null); // no authoritative total for an unpriced invoice
  assert.equal(r.lines[0].status, "UNPRICED");
});

test("REQUIRES_REVIEW: missing/incomplete tax determination fails closed (tax never invented)", () => {
  const r = deriveInvoiceLineAmounts({
    billable: [{ ref: "L1", billableQty: 1 }],
    priceByRef: { L1: money(10000, "USD") },
    taxDetermination: null, // no tax determination provided
    currency: "USD",
  });
  assert.equal(r.status, "REQUIRES_REVIEW");
  assert.equal(r.lines[0].status, "TAX_REQUIRES_REVIEW");
  assert.equal(r.lines[0].subtotal.minor, 10000); // subtotal known
  assert.equal(r.lines[0].tax, null); // tax not invented
  assert.equal(r.totals.total, null); // no total until tax is determined
});

test("currency mismatch on a line price is treated as UNPRICED (fail-closed), not coerced", () => {
  const r = deriveInvoiceLineAmounts({
    billable: [{ ref: "L1", billableQty: 1 }],
    priceByRef: { L1: money(10000, "EUR") }, // wrong currency for a USD invoice
    taxDetermination: { byRef: { L1: money(0, "USD") } },
    currency: "USD",
  });
  assert.equal(r.status, "UNPRICED");
});

test("zero-qty / missing-ref billable rows are skipped", () => {
  const r = deriveInvoiceLineAmounts({
    billable: [{ ref: "L1", billableQty: 0 }, { billableQty: 3 }],
    priceByRef: { L1: money(100, "USD") },
    taxDetermination: { byRef: {} },
    currency: "USD",
  });
  assert.equal(r.lines.length, 0);
});

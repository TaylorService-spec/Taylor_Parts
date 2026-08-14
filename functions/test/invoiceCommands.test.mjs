// Finance — invoice command core (governed issuance). Pure tests (node:test; no emulator). Prereq: npm run
// build. Proves the server RE-COMPUTES authoritative integer amounts from the SO unitPrice snapshot + injected
// tax, produces an immutable ISSUED record, and fails closed on non-BILL_NOW / missing price / missing tax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceRecord, verifySalesOrderMatch, InvoiceCommandError } from "../lib/finance/invoiceCommands.js";

const DEPS = { invoiceNumber: "INV-000042", sequence: 42, nowMillis: 1_700_000_000_000 };
const base = () => ({
  companyId: "taylor", accountId: "ACCT-1", salesOrderId: "SO-1", currency: "USD",
  dueDate: 1_702_000_000_000, billingAction: "BILL_NOW",
  taxProvenance: "test-engine",
  lines: [
    { ref: "L1", billableQty: 5, unitPriceMinor: 12000, discountMinor: 2000, taxMinor: 4785 }, // 60000-2000=58000; +4785
    { ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 825 }, // 10000; +825
  ],
});

test("BILL_NOW: recomputes exact amounts, immutable ISSUED record, outstanding = total", () => {
  const inv = buildInvoiceRecord(base(), DEPS);
  assert.equal(inv.state, "ISSUED");
  assert.equal(inv.invoiceNumber, "INV-000042");
  assert.equal(inv.sequence, 42);
  assert.equal(inv.issuedAtMillis, DEPS.nowMillis);
  const l1 = inv.lines.find((l) => l.ref === "L1");
  assert.equal(l1.subtotalMinor, 60000); // recomputed 12000*5
  assert.equal(l1.taxableBaseMinor, 58000); // 60000-2000
  assert.equal(l1.lineTotalMinor, 58000 + 4785);
  assert.equal(inv.subtotalMinor, 60000 + 10000);
  assert.equal(inv.discountMinor, 2000);
  assert.equal(inv.taxMinor, 4785 + 825);
  assert.equal(inv.totalMinor, 58000 + 4785 + 10000 + 825);
  assert.equal(inv.outstandingMinor, inv.totalMinor);
  assert.equal(inv.taxProvenance, "test-engine");
});

test("only an explicit BILL_NOW decision may issue (PARTIALLY_ELIGIBLE hold does not auto-issue)", () => {
  assert.throws(() => buildInvoiceRecord({ ...base(), billingAction: "HOLD_FOR_POLICY" }, DEPS), (e) => e instanceof InvoiceCommandError && e.code === "NOT_BILLABLE");
});

test("missing tax determination fails closed (TAX_REQUIRES_REVIEW) — tax never invented", () => {
  const input = base();
  delete input.lines[1].taxMinor;
  assert.throws(() => buildInvoiceRecord(input, DEPS), (e) => e.code === "TAX_REQUIRES_REVIEW");
});

test("missing committed unit price fails closed (UNPRICED) — no re-pricing", () => {
  const input = base();
  delete input.lines[0].unitPriceMinor;
  assert.throws(() => buildInvoiceRecord(input, DEPS), (e) => e.code === "UNPRICED");
});

test("required fields + dueDate (AR aging) + non-empty lines are enforced", () => {
  assert.throws(() => buildInvoiceRecord({ ...base(), companyId: "" }, DEPS), (e) => e.code === "REQUIRED");
  assert.throws(() => buildInvoiceRecord({ ...base(), dueDate: "soon" }, DEPS), (e) => e.code === "DUE_DATE_INVALID");
  assert.throws(() => buildInvoiceRecord({ ...base(), lines: [] }, DEPS), (e) => e.code === "NO_LINES");
});

test("rejects non-integer qty, discount > subtotal (no float, no negative base)", () => {
  assert.throws(() => buildInvoiceRecord({ ...base(), lines: [{ ref: "L1", billableQty: 1.5, unitPriceMinor: 100, taxMinor: 0 }] }, DEPS), (e) => e.code === "LINE_INVALID");
  assert.throws(() => buildInvoiceRecord({ ...base(), lines: [{ ref: "L1", billableQty: 1, unitPriceMinor: 100, discountMinor: 200, taxMinor: 0 }] }, DEPS), (e) => e.code === "LINE_INVALID");
});

// P1.8 (lifecycle-audit `issueinvoice-unverified-so-pricing-and-qty`): issuance must be cross-checked against
// the GOVERNED Sales Order, never trusted from the client. verifySalesOrderMatch is the pure check the
// callable runs (against a tx.get'd SO doc) before buildInvoiceRecord recomputes amounts.
const soBase = () => ({
  accountId: "ACCT-1",
  currency: "USD",
  state: "IN_FULFILLMENT",
  lines: [
    { ref: "L1", unitPrice: 12000, orderedQty: 5, fulfilledQty: 5 },
    { ref: "L2", unitPrice: 5000, orderedQty: 2, fulfilledQty: 2 },
  ],
});
const invoiceInput = () => ({
  companyId: "taylor", accountId: "ACCT-1", salesOrderId: "SO-1", currency: "USD",
  dueDate: 1_702_000_000_000, billingAction: "BILL_NOW",
  lines: [
    { ref: "L1", billableQty: 5, unitPriceMinor: 12000, taxMinor: 4785 },
    { ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 825 },
  ],
});

test("matching input against a fully-fulfilled, eligible SO passes (no throw)", () => {
  assert.doesNotThrow(() => verifySalesOrderMatch(invoiceInput(), soBase()));
});

test("accountId mismatch vs the SO's committed account is rejected", () => {
  assert.throws(() => verifySalesOrderMatch({ ...invoiceInput(), accountId: "ACCT-OTHER" }, soBase()), (e) => e instanceof InvoiceCommandError && e.code === "ACCOUNT_MISMATCH");
});

test("currency mismatch vs the SO's committed currency is rejected", () => {
  assert.throws(() => verifySalesOrderMatch({ ...invoiceInput(), currency: "CAD" }, soBase()), (e) => e.code === "CURRENCY_MISMATCH");
});

test("SO not billing-eligible (cancelled) rejects issuance entirely (NOT_BILLABLE)", () => {
  assert.throws(() => verifySalesOrderMatch(invoiceInput(), { ...soBase(), state: "CANCELLED" }), (e) => e.code === "NOT_BILLABLE");
});

test("SO not billing-eligible (nothing fulfilled yet) rejects issuance (NOT_BILLABLE)", () => {
  const so = { ...soBase(), lines: soBase().lines.map((l) => ({ ...l, fulfilledQty: 0 })) };
  assert.throws(() => verifySalesOrderMatch(invoiceInput(), so), (e) => e.code === "NOT_BILLABLE");
});

test("invoice line with no matching SO line ref is rejected (SALES_ORDER_LINE_NOT_FOUND)", () => {
  const input = { ...invoiceInput(), lines: [{ ref: "L-GHOST", billableQty: 1, unitPriceMinor: 100, taxMinor: 0 }] };
  assert.throws(() => verifySalesOrderMatch(input, soBase()), (e) => e.code === "SALES_ORDER_LINE_NOT_FOUND");
});

test("client unitPriceMinor that does not match the SO's committed unit price is rejected (PRICE_MISMATCH, no re-pricing)", () => {
  const input = invoiceInput();
  input.lines[0].unitPriceMinor = 12001; // one minor unit off the SO snapshot
  assert.throws(() => verifySalesOrderMatch(input, soBase()), (e) => e.code === "PRICE_MISMATCH");
});

test("billableQty exceeding the billing-eligible qty (min(orderedQty, fulfilledQty)) is rejected (QTY_EXCEEDS_ELIGIBLE)", () => {
  const so = { ...soBase(), lines: soBase().lines.map((l) => (l.ref === "L1" ? { ...l, fulfilledQty: 3 } : l)) };
  assert.throws(() => verifySalesOrderMatch(invoiceInput(), so), (e) => e.code === "QTY_EXCEEDS_ELIGIBLE");
});

test("partially fulfilled SO still allows billing up to the eligible qty (PARTIALLY_ELIGIBLE is billable, matches then passes)", () => {
  const so = { ...soBase(), lines: soBase().lines.map((l) => (l.ref === "L1" ? { ...l, fulfilledQty: 3 } : l)) };
  const input = { ...invoiceInput(), lines: [{ ref: "L1", billableQty: 3, unitPriceMinor: 12000, taxMinor: 0 }, { ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 0 }] };
  assert.doesNotThrow(() => verifySalesOrderMatch(input, so));
});

test("SO line with no committed unitPrice fails closed (UNPRICED) — no re-pricing basis", () => {
  const so = { ...soBase(), lines: soBase().lines.map((l) => (l.ref === "L1" ? { ref: "L1", orderedQty: 5, fulfilledQty: 5 } : l)) };
  assert.throws(() => verifySalesOrderMatch(invoiceInput(), so), (e) => e.code === "UNPRICED");
});

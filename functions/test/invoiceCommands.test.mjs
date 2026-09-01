// Finance — invoice command core (governed issuance). Pure tests (node:test; no emulator). Prereq: npm run
// build. Proves the server RE-COMPUTES authoritative integer amounts from the SO unitPrice snapshot + injected
// tax, produces an immutable ISSUED record, and fails closed on non-BILL_NOW / missing price / missing tax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceRecord, verifySalesOrderMatch, InvoiceCommandError } from "../lib/finance/invoiceCommands.js";

// Company-authority correction: the invoice's company comes from the GOVERNED Sales Order, so the
// build deps always carry the SO snapshot (as the live callable always did) and `companyId` on the
// input is assertion-only.
const BASE_SO = () => ({
  accountId: "ACCT-1", currency: "USD", state: "FULFILLED",
  operatingCompanyId: "taylor", creditedSalespersonId: "emp-a",
  lines: [
    { lineId: "line-1", kind: "PART", ref: "L1", businessUnitId: "PARTS", unitPrice: 12000, orderedQty: 5, fulfilledQty: 5 },
    { lineId: "line-2", kind: "SERVICE", ref: "L2", businessUnitId: "SERVICE", unitPrice: 5000, orderedQty: 2, fulfilledQty: 2 },
  ],
});
const DEPS = { invoiceNumber: "INV-000042", sequence: 42, nowMillis: 1_700_000_000_000, so: BASE_SO() };
const base = () => ({
  companyId: "taylor", accountId: "ACCT-1", salesOrderId: "SO-1", currency: "USD",
  dueDate: 1_702_000_000_000, billingAction: "BILL_NOW",
  taxProvenance: "test-engine",
  lines: [
    { salesOrderLineId: "line-1", kind: "PART", ref: "L1", billableQty: 5, unitPriceMinor: 12000, discountMinor: 2000, taxMinor: 4785 },
    { salesOrderLineId: "line-2", kind: "SERVICE", ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 825 },
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
  // companyId is ASSERTION-ONLY now: an empty/omitted assertion is ignored and the governed SO
  // company is used; a NON-matching assertion is refused; a missing SO company is refused.
  assert.equal(buildInvoiceRecord({ ...base(), companyId: "" }, DEPS).companyId, "taylor");
  assert.equal(buildInvoiceRecord({ ...base(), companyId: undefined }, DEPS).companyId, "taylor");
  assert.throws(() => buildInvoiceRecord({ ...base(), companyId: "ventana" }, DEPS), (e) => e.code === "COMPANY_MISMATCH");
  assert.throws(
    () => buildInvoiceRecord(base(), { ...DEPS, so: { ...BASE_SO(), operatingCompanyId: undefined } }),
    (e) => e.code === "COMPANY_REQUIRED",
  );
  // STRUCTURAL INVARIANT: header company === attribution company, always.
  const rec = buildInvoiceRecord(base(), DEPS);
  assert.equal(rec.companyId, rec.attribution.operatingCompanyId);
  assert.throws(() => buildInvoiceRecord({ ...base(), dueDate: "soon" }, DEPS), (e) => e.code === "DUE_DATE_INVALID");
  assert.throws(() => buildInvoiceRecord({ ...base(), lines: [] }, DEPS), (e) => e.code === "NO_LINES");
});

test("rejects non-integer qty, discount > subtotal (no float, no negative base)", () => {
  assert.throws(() => buildInvoiceRecord({ ...base(), lines: [{ kind: "PART", ref: "L1", billableQty: 1.5, unitPriceMinor: 100, taxMinor: 0 }] }, DEPS), (e) => e.code === "LINE_INVALID");
  assert.throws(() => buildInvoiceRecord({ ...base(), lines: [{ kind: "PART", ref: "L1", billableQty: 1, unitPriceMinor: 100, discountMinor: 200, taxMinor: 0 }] }, DEPS), (e) => e.code === "LINE_INVALID");
});

// P1.8 (lifecycle-audit `issueinvoice-unverified-so-pricing-and-qty`): issuance must be cross-checked against
// the GOVERNED Sales Order, never trusted from the client. verifySalesOrderMatch is the pure check the
// callable runs (against a tx.get'd SO doc) before buildInvoiceRecord recomputes amounts.
const soBase = () => ({
  accountId: "ACCT-1",
  currency: "USD",
  state: "IN_FULFILLMENT",
  // Company-authority correction: the governed order carries THE company the invoice will use.
  operatingCompanyId: "taylor",
  lines: [
    { lineId: "line-1", kind: "PART", ref: "L1", unitPrice: 12000, orderedQty: 5, fulfilledQty: 5 },
    { lineId: "line-2", kind: "SERVICE", ref: "L2", unitPrice: 5000, orderedQty: 2, fulfilledQty: 2 },
  ],
});
const invoiceInput = () => ({
  companyId: "taylor", accountId: "ACCT-1", salesOrderId: "SO-1", currency: "USD",
  dueDate: 1_702_000_000_000, billingAction: "BILL_NOW",
  lines: [
    { salesOrderLineId: "line-1", kind: "PART", ref: "L1", billableQty: 5, unitPriceMinor: 12000, taxMinor: 4785 },
    { salesOrderLineId: "line-2", kind: "SERVICE", ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 825 },
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
  const input = { ...invoiceInput(), lines: [{ salesOrderLineId: "ghost", kind: "PART", ref: "L-GHOST", billableQty: 1, unitPriceMinor: 100, taxMinor: 0 }] };
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
  const input = { ...invoiceInput(), lines: [{ salesOrderLineId: "line-1", kind: "PART", ref: "L1", billableQty: 3, unitPriceMinor: 12000, taxMinor: 0 }, { salesOrderLineId: "line-2", kind: "SERVICE", ref: "L2", billableQty: 2, unitPriceMinor: 5000, taxMinor: 0 }] };
  assert.doesNotThrow(() => verifySalesOrderMatch(input, so));
});

test("SO line with no committed unitPrice fails closed (UNPRICED) — no re-pricing basis", () => {
  const so = { ...soBase(), lines: soBase().lines.map((l) => (l.ref === "L1" ? { lineId: "line-1", kind: "PART", ref: "L1", orderedQty: 5, fulfilledQty: 5 } : l)) };
  assert.throws(() => verifySalesOrderMatch(invoiceInput(), so), (e) => e.code === "UNPRICED");
});

test("same ref across kinds matches the requested kind, never a bare ref", () => {
  const so = { ...soBase(), lines: [
    { lineId: "part-shared", kind: "PART", ref: "SHARED", unitPrice: 100, orderedQty: 1, fulfilledQty: 1 },
    { lineId: "service-shared", kind: "SERVICE", ref: "SHARED", unitPrice: 200, orderedQty: 1, fulfilledQty: 1 },
  ] };
  const input = { ...invoiceInput(), lines: [{ salesOrderLineId: "service-shared", kind: "SERVICE", ref: "SHARED", billableQty: 1, unitPriceMinor: 200, taxMinor: 0 }] };
  assert.doesNotThrow(() => verifySalesOrderMatch(input, so));
});

test("duplicate input lines accumulate against remaining billing eligibility", () => {
  const input = { ...invoiceInput(), lines: [
    { salesOrderLineId: "line-1", kind: "PART", ref: "L1", billableQty: 3, unitPriceMinor: 12000, taxMinor: 0 },
    { salesOrderLineId: "line-1", kind: "PART", ref: "L1", billableQty: 3, unitPriceMinor: 12000, taxMinor: 0 },
  ] };
  assert.throws(() => verifySalesOrderMatch(input, soBase()), (e) => e.code === "QTY_EXCEEDS_ELIGIBLE");
});

test("already billed quantity is unavailable to a later invoice", () => {
  const so = { ...soBase(), lines: soBase().lines.map((line) => line.ref === "L1" ? { ...line, billedQty: 5 } : line) };
  assert.throws(() => verifySalesOrderMatch(invoiceInput(), so), (e) => e.code === "QTY_EXCEEDS_ELIGIBLE");
});

test("duplicate sibling kind/ref lines bill only their exact line identity", () => {
  const so = { ...soBase(), lines: [
    { lineId: "line-a", kind: "PART", ref: "DUP", unitPrice: 100, orderedQty: 2, fulfilledQty: 2, billedQty: 0 },
    { lineId: "line-b", kind: "PART", ref: "DUP", unitPrice: 200, orderedQty: 2, fulfilledQty: 2, billedQty: 0 },
  ] };
  const input = { ...invoiceInput(), lines: [{ salesOrderLineId: "line-b", kind: "PART", ref: "DUP", billableQty: 2, unitPriceMinor: 200, taxMinor: 0 }] };
  assert.doesNotThrow(() => verifySalesOrderMatch(input, so));
});

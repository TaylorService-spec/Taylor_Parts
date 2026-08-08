// Finance — invoice command core (governed issuance). Pure tests (node:test; no emulator). Prereq: npm run
// build. Proves the server RE-COMPUTES authoritative integer amounts from the SO unitPrice snapshot + injected
// tax, produces an immutable ISSUED record, and fails closed on non-BILL_NOW / missing price / missing tax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceRecord, InvoiceCommandError } from "../lib/finance/invoiceCommands.js";

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

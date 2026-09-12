// INVOICE MONEY — the ONE derivation, and the reconciliation proof that did not exist.
//
// ════════════════════ THE DEFECT THESE PIN ════════════════════
//
// An invoice's `totalMinor` is a STORED HEADER AGGREGATE. buildInvoiceRecord computes it once, at
// issuance, from the line array and persists it beside those lines. Every AR figure downstream is
// computed from that stored number: billed and collected (financeReadProjection.ts's
// summarizeAccountAr), outstanding, and every aging bucket (summarizeArAging).
//
// Nothing re-checked it. financialReconciliation.ts's reconcileInvoiceProjection takes
// `stored.totalMinor` as its GIVEN basis and proves only the overlay above it, so an invoice whose
// header says one number and whose lines say another reported IN_SYNC. That is the defect class,
// and `reconcileInvoiceTotals` is the proof for it. These tests hold both halves still: that the
// derivation has exactly one definition, and that a divergent header is actually caught.
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveInvoiceLineAmounts,
  deriveInvoiceTotals,
  sumInvoiceLineAmounts,
  reconcileInvoiceTotalsAgainstLines,
  InvoiceTotalsError,
} from "../lib/eosOps/invoiceTotals.js";
import { reconcileInvoiceTotals, reconcileInvoiceProjection } from "../lib/finance/financialReconciliation.js";
import { reconcileMigratedInvoice } from "../lib/eosOps/invoiceAuthority.js";
import { buildInvoiceRecord } from "../lib/finance/invoiceCommands.js";

const LINES = [
  { billableQty: 3, unitPriceMinor: 1250, discountMinor: 150, taxMinor: 270 },
  { billableQty: 1, unitPriceMinor: 99_99, discountMinor: 0, taxMinor: 825 },
];

test("a line's amounts are derived, never accepted", () => {
  const a = deriveInvoiceLineAmounts(LINES[0]);
  assert.deepEqual(a, {
    subtotalMinor: 3750,
    discountMinor: 150,
    taxableBaseMinor: 3600,
    taxMinor: 270,
    lineTotalMinor: 3870,
  });
  // Supplying a wrong subtotal changes nothing: it is not an input.
  assert.deepEqual(deriveInvoiceLineAmounts({ ...LINES[0], subtotalMinor: 1 }), a);
});

test("absent tax is a refusal, not a zero", () => {
  // "nobody decided" and "the answer is zero" are different facts. The command core raises
  // TAX_REQUIRES_REVIEW; migration 008 gives tax_minor NOT NULL with no DEFAULT for the same
  // reason. A layer that converted one into the other would manufacture a tax determination.
  assert.throws(
    () => deriveInvoiceLineAmounts({ billableQty: 1, unitPriceMinor: 100 }),
    (e) => e instanceof InvoiceTotalsError && e.code === "TAX_REQUIRES_REVIEW",
  );
  // An explicit zero IS a determination and is accepted.
  assert.equal(deriveInvoiceLineAmounts({ billableQty: 1, unitPriceMinor: 100, taxMinor: 0 }).lineTotalMinor, 100);
});

test("non-integer and negative money are refused, never rounded or clamped", () => {
  const bad = [
    [{ billableQty: 1.5, unitPriceMinor: 100, taxMinor: 0 }, "LINE_INVALID"],
    [{ billableQty: 0, unitPriceMinor: 100, taxMinor: 0 }, "LINE_INVALID"],
    [{ billableQty: 1, unitPriceMinor: 10.5, taxMinor: 0 }, "UNPRICED"],
    [{ billableQty: 1, unitPriceMinor: -1, taxMinor: 0 }, "UNPRICED"],
    [{ billableQty: 1, unitPriceMinor: 100, discountMinor: -1, taxMinor: 0 }, "LINE_INVALID"],
    [{ billableQty: 1, unitPriceMinor: 100, discountMinor: 101, taxMinor: 0 }, "LINE_INVALID"],
    [{ billableQty: 1, unitPriceMinor: 100, taxMinor: -1 }, "TAX_REQUIRES_REVIEW"],
  ];
  for (const [line, code] of bad) {
    assert.throws(() => deriveInvoiceLineAmounts(line), (e) => e.code === code, JSON.stringify(line));
  }
});

test("the totals are the sum of the lines and nothing else", () => {
  const totals = deriveInvoiceTotals(LINES);
  assert.deepEqual(totals, {
    lineCount: 2,
    subtotalMinor: 3750 + 9999,
    discountMinor: 150,
    taxableBaseMinor: 3600 + 9999,
    taxMinor: 270 + 825,
    totalMinor: 3870 + 10824,
  });
  // An invoice with no lines sums to zero — which is why the repository refuses to WRITE one, and
  // why invoice_totals exposes line_count: a 0 total and "nothing billed" must stay tellable apart.
  assert.deepEqual(sumInvoiceLineAmounts([]).totalMinor, 0);
  assert.deepEqual(sumInvoiceLineAmounts([]).lineCount, 0);
});

test("buildInvoiceRecord's header aggregates come from that same derivation", () => {
  // The refactor's parity check: the command core no longer has its own reduce, and the record it
  // produces must still be exactly what the shared derivation says.
  const so = {
    accountId: "acct-1",
    currency: "USD",
    operatingCompanyId: "taylor",
    creditedSalespersonId: "emp-1",
    lines: [
      { lineId: "sol-1", kind: "PART", ref: "L1", unitPrice: 1250, orderedQty: 3, fulfilledQty: 3, businessUnitId: "bu-1" },
      { lineId: "sol-2", kind: "PART", ref: "L2", unitPrice: 9999, orderedQty: 1, fulfilledQty: 1 },
    ],
    state: "FULFILLED",
  };
  const record = buildInvoiceRecord(
    {
      accountId: "acct-1",
      salesOrderId: "so-1",
      currency: "USD",
      dueDate: 1_700_000_000_000,
      billingAction: "BILL_NOW",
      lines: [
        { salesOrderLineId: "sol-1", kind: "PART", ref: "L1", billableQty: 3, unitPriceMinor: 1250, discountMinor: 150, taxMinor: 270 },
        { salesOrderLineId: "sol-2", kind: "PART", ref: "L2", billableQty: 1, unitPriceMinor: 9999, taxMinor: 825 },
      ],
    },
    { invoiceNumber: "INV-000001", sequence: 1, nowMillis: 1_699_000_000_000, so },
  );
  const derived = deriveInvoiceTotals(LINES);
  assert.equal(record.subtotalMinor, derived.subtotalMinor);
  assert.equal(record.discountMinor, derived.discountMinor);
  assert.equal(record.taxMinor, derived.taxMinor);
  assert.equal(record.totalMinor, derived.totalMinor);
  assert.equal(record.outstandingMinor, derived.totalMinor);
  // And the header aggregate agrees with its own lines, which is the property nothing checked.
  assert.equal(reconcileInvoiceTotalsAgainstLines(record, record.lines).status, "IN_SYNC");
});

test("a header that disagrees with its own lines is DRIFT, and names the field", () => {
  const lines = LINES.map((l) => deriveInvoiceLineAmounts(l));
  const honest = sumInvoiceLineAmounts(lines);
  const tampered = { ...honest, totalMinor: honest.totalMinor + 500 };
  const result = reconcileInvoiceTotals({ invoiceId: "inv-1", ...tampered }, lines);
  assert.equal(result.status, "DRIFT");
  assert.equal(result.recordId, "inv-1");
  assert.deepEqual(result.differences, [
    { field: "totalMinor", storedValue: honest.totalMinor + 500, derivedValue: honest.totalMinor },
  ]);
});

test("an ABSENT header total is a difference, not a zero", () => {
  const lines = LINES.map((l) => deriveInvoiceLineAmounts(l));
  const result = reconcileInvoiceTotals({ invoiceId: "inv-2" }, lines);
  assert.equal(result.status, "DRIFT");
  assert.deepEqual(result.differences.map((d) => d.field).sort(), ["discountMinor", "subtotalMinor", "taxMinor", "totalMinor"]);
  for (const d of result.differences) assert.equal(d.storedValue, null, `${d.field} must report absence, not 0`);
});

test("THE GAP: the existing projection reconciler reports IN_SYNC on an invoice whose total is wrong", () => {
  // This is not a bug in reconcileInvoiceProjection — it is the boundary of what it can see, and
  // the reason reconcileInvoiceTotals had to exist. A fact set of payments says nothing about what
  // was billed, so a header inflated by 500 passes it cleanly...
  const lines = LINES.map((l) => deriveInvoiceLineAmounts(l));
  const honest = sumInvoiceLineAmounts(lines);
  const stored = {
    invoiceId: "inv-3",
    currency: "USD",
    state: "ISSUED",
    totalMinor: honest.totalMinor + 500,
    appliedMinor: 0,
    outstandingMinor: honest.totalMinor + 500,
  };
  const projection = reconcileInvoiceProjection(stored, { applications: [], adjustments: [], refunds: [] });
  assert.equal(projection.status, "IN_SYNC", "the overlay is internally consistent with a wrong basis");
  // ...and is caught only by the new proof.
  assert.equal(reconcileInvoiceTotals(stored, lines).status, "DRIFT");
});

test("reconciliation refuses to answer when the lines cannot be read", () => {
  // Silence is the failure mode that matters: reporting IN_SYNC for an invoice whose lines were
  // not loaded would be a migration signing off on a record it never compared.
  assert.throws(
    () => reconcileInvoiceTotals({ invoiceId: "inv-4", totalMinor: 0 }, null),
    (e) => e.code === "LINES_REQUIRED",
  );
  assert.throws(() => reconcileInvoiceTotals({ totalMinor: 0 }, []), (e) => e.code === "INVOICE_REQUIRED");
});

test("migration reconciliation separates 'the copy is faithful' from 'the source was right'", () => {
  const sourceLineAmounts = LINES.map((l) => deriveInvoiceLineAmounts(l));
  const fromLines = sumInvoiceLineAmounts(sourceLineAmounts);

  // A faithful copy of a source whose OWN header was already wrong. A header-to-header migration
  // check would have carried the wrong number across and called it a success.
  const carried = reconcileMigratedInvoice({
    invoiceId: "inv-5",
    sourceStoredTotals: { ...fromLines, totalMinor: fromLines.totalMinor + 500 },
    sourceLineAmounts,
    targetTotals: fromLines,
  });
  assert.equal(carried.status, "IN_SYNC", "target lines match source lines");
  assert.equal(carried.targetMatchesSourceLines, true);
  assert.equal(carried.sourceInternallyConsistent, false, "and the source header was already wrong");

  // A target that dropped a line is DRIFT, and says which fields.
  const lost = reconcileMigratedInvoice({
    invoiceId: "inv-6",
    sourceStoredTotals: fromLines,
    sourceLineAmounts,
    targetTotals: sumInvoiceLineAmounts(sourceLineAmounts.slice(0, 1)),
  });
  assert.equal(lost.status, "DRIFT");
  assert.equal(lost.sourceInternallyConsistent, true);
  assert.ok(lost.differences.some((d) => d.field === "lineCount"));
  assert.ok(lost.differences.some((d) => d.field === "totalMinor"));
});

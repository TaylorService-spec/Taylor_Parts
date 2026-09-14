// Finance — internal reconciliation core (F11 / FIN-010). Pure tests. Proves the stored AR projection is
// CHECKABLE against the durable facts: IN_SYNC when the cache matches, DRIFT with named field
// differences when it does not; foreign facts and malformed facts are thrown defects; the module never
// "fixes" anything. External reconciliation is deliberately absent (authority of record not selected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileInvoiceProjection, reconcileReceipt, ReconciliationError } from "../lib/finance/financialReconciliation.js";

const stored = (over = {}) => ({
  invoiceId: "INV-1",
  currency: "USD",
  state: "PARTIALLY_PAID",
  totalMinor: 10000,
  appliedMinor: 4000,
  creditsMinor: 1000,
  chargesMinor: 0,
  writeOffMinor: 0,
  outstandingMinor: 5000,
  ...over,
});
const facts = (over = {}) => ({
  applications: [{ invoiceId: "INV-1", appliedAmountMinor: 4000 }],
  adjustments: [{ invoiceId: "INV-1", type: "CREDIT_MEMO", amountMinor: 1000 }],
  refunds: [],
  ...over,
});

test("a projection matching its facts is IN_SYNC with zero differences", () => {
  const r = reconcileInvoiceProjection(stored(), facts());
  assert.equal(r.status, "IN_SYNC");
  assert.deepEqual(r.differences, []);
  assert.equal(r.recordId, "INV-1");
});

test("a drifted appliedMinor is named, with stored and derived values (never silently fixed)", () => {
  const r = reconcileInvoiceProjection(stored({ appliedMinor: 3000, outstandingMinor: 6000 }), facts());
  assert.equal(r.status, "DRIFT");
  const applied = r.differences.find((d) => d.field === "appliedMinor");
  assert.deepEqual(applied, { field: "appliedMinor", storedValue: 3000, derivedValue: 4000 });
  const outstanding = r.differences.find((d) => d.field === "outstandingMinor");
  assert.deepEqual(outstanding, { field: "outstandingMinor", storedValue: 6000, derivedValue: 5000 });
});

test("refund facts reduce derived applied; a projection unaware of a refund shows DRIFT", () => {
  const withRefund = facts({ refunds: [{ invoiceId: "INV-1", amountMinor: 1000 }] });
  const r = reconcileInvoiceProjection(stored(), withRefund);
  assert.equal(r.status, "DRIFT");
  assert.equal(r.differences.find((d) => d.field === "appliedMinor").derivedValue, 3000);
});

test("a stale state is caught (facts say PAID, projection still says PARTIALLY_PAID)", () => {
  const full = facts({ applications: [{ invoiceId: "INV-1", appliedAmountMinor: 9000 }] });
  const r = reconcileInvoiceProjection(stored({ appliedMinor: 9000, outstandingMinor: 0 }), full);
  assert.equal(r.status, "DRIFT");
  assert.deepEqual(r.differences.find((d) => d.field === "state"), { field: "state", storedValue: "PARTIALLY_PAID", derivedValue: "PAID" });
});

test("VOID is terminal — never re-derived into a payment state", () => {
  const r = reconcileInvoiceProjection(stored({ state: "VOID", appliedMinor: 4000, outstandingMinor: 5000 }), facts());
  assert.equal(r.differences.find((d) => d.field === "state"), undefined);
});

test("foreign facts (another invoice's rows) are a thrown defect, not drift", () => {
  assert.throws(
    () => reconcileInvoiceProjection(stored(), facts({ applications: [{ invoiceId: "INV-2", appliedAmountMinor: 1 }] })),
    (e) => e instanceof ReconciliationError && e.code === "FOREIGN_FACT",
  );
});

test("malformed facts are thrown defects — an unreconcilable set never reports sync", () => {
  assert.throws(() => reconcileInvoiceProjection(stored(), facts({ adjustments: [{ invoiceId: "INV-1", type: "REBATE", amountMinor: 1 }] })), (e) => e.code === "FACT_INVALID");
  assert.throws(() => reconcileInvoiceProjection(stored(), facts({ applications: [{ invoiceId: "INV-1", appliedAmountMinor: 1.5 }] })), (e) => e.code === "FACT_INVALID");
});

test("receipt invariant: amount = applied + unapplied and applied = Σ its applications", () => {
  const ok = reconcileReceipt(
    { paymentId: "PAY-1", amountMinor: 5000, appliedMinor: 5000, unappliedMinor: 0 },
    [{ paymentId: "PAY-1", appliedAmountMinor: 5000 }],
  );
  assert.equal(ok.status, "IN_SYNC");
  const drift = reconcileReceipt(
    { paymentId: "PAY-1", amountMinor: 5000, appliedMinor: 5000, unappliedMinor: 0 },
    [{ paymentId: "PAY-1", appliedAmountMinor: 3000 }],
  );
  assert.equal(drift.status, "DRIFT");
  assert.deepEqual(drift.differences.map((d) => d.field).sort(), ["appliedMinor", "unappliedMinor"]);
  assert.throws(() => reconcileReceipt({ paymentId: "PAY-1", amountMinor: 5000 }, [{ paymentId: "PAY-9", appliedAmountMinor: 1 }]), (e) => e.code === "FOREIGN_FACT");
});

test("over-applied receipt (applications exceed the receipt amount) surfaces as DRIFT", () => {
  const r = reconcileReceipt(
    { paymentId: "PAY-1", amountMinor: 5000, appliedMinor: 6000, unappliedMinor: 0 },
    [{ paymentId: "PAY-1", appliedAmountMinor: 6000 }],
  );
  assert.equal(r.status, "DRIFT");
  assert.ok(r.differences.some((d) => d.field === "amountMinor" || d.field === "unappliedMinor"));
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// P2-K (2026-09-12) — WHY THIS DETECTOR IS NOT WIRED.
//
// The tests above feed the reconciler hand-built projections. This one feeds it what the
// PRODUCTION adjustment core actually produces, and the reconciler calls it DRIFT. That is a
// false positive, and it is the reason `reconcileInvoiceProjection` must not be pointed at live
// data before an Owner rules on invoice state after a full write-off / credit memo.
//
// adjustmentCommands.ts: "It does NOT mark the invoice 'PAID' — it settles the AR balance without
// payment." adjustmentCallables.ts writes only outstandingMinor + the one tally; `state` is
// deliberately left alone. But deriveInvoiceStateFromFacts (paymentCommands.ts) returns PAID for
// any outstanding <= 0, and this reconciler uses it. Two production modules, two answers.
//
// This test PINS the conflict rather than papering over it: if someone changes either side, it
// fails and the ruling gets made on purpose instead of by accident.
// ════════════════════════════════════════════════════════════════════════════════════════════
import { buildAdjustment } from "../lib/finance/adjustmentCommands.js";

const issuedInvoice = () => ({
  invoiceId: "INV-WO", companyId: "co-1", accountId: "acct-1", currency: "USD", state: "ISSUED",
  totalMinor: 10000, appliedMinor: 0, creditsMinor: 0, chargesMinor: 0, writeOffMinor: 0,
  outstandingMinor: 10000,
});

for (const type of ["WRITE_OFF", "CREDIT_MEMO"]) {
  test(`KNOWN CONFLICT: a ${type}-settled invoice is healthy in production but reports DRIFT here`, () => {
    const invoice = issuedInvoice();
    const { adjustment, invoicePatch } = buildAdjustment(
      { type, invoiceId: invoice.invoiceId, companyId: "co-1", accountId: "acct-1", currency: "USD",
        amountMinor: 10000, reason: "owner-authorized", effectiveDate: "2026-09-12" },
      invoice, { nowMillis: Date.UTC(2026, 8, 12) },
    );
    // Exactly what adjustmentCallables.ts persists: outstanding + the one tally. `state` untouched.
    const storedAfter = { ...invoice, ...invoicePatch };
    assert.equal(storedAfter.outstandingMinor, 0, "the adjustment settles the balance");
    assert.equal(storedAfter.state, "ISSUED", "production deliberately leaves state alone");

    const r = reconcileInvoiceProjection(storedAfter, {
      applications: [], refunds: [],
      adjustments: [{ invoiceId: invoice.invoiceId, type: adjustment.type, amountMinor: adjustment.amountMinor }],
    });

    // Every MONEY field reconciles. The only disagreement is `state`, and it is the reconciler's
    // rule disagreeing with the command core's rule — not a cache that drifted from its facts.
    assert.equal(r.status, "DRIFT");
    assert.deepEqual(r.differences, [{ field: "state", storedValue: "ISSUED", derivedValue: "PAID" }]);
  });
}

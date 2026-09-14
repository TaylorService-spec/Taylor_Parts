# FIN-010 — Reconciliation / Traceability / Audit (F11)

**Status:** INTERNAL reconciliation IMPLEMENTED (repository, dormant); EXTERNAL
reconciliation deliberately absent — the accounting authority of record is not yet selected
(DECISIONS #145), so there is nothing to reconcile against and a speculative matcher would
guess an interface. Recorded 2026-09-01, overnight financials run phase F11.

## 1. Implemented — the projection promise made checkable

The payment/adjustment cores promise that every stored AR projection is only a CACHE of
durable fact records. `functions/src/finance/financialReconciliation.ts` verifies it:

- **`reconcileInvoiceProjection(stored, {applications, adjustments, refunds})`** —
  recomputes applied (applications − refunds), credits/charges/write-offs (typed
  adjustment facts), outstanding (the shared formula from `paymentCommands`), and the
  fact-implied state (VOID terminal, never re-derived), then diffs against the stored
  projection. Result: `IN_SYNC`, or `DRIFT` with per-field `{storedValue, derivedValue}`
  differences. **Nothing is fixed or proposed** — a drifted projection is a defect to
  investigate (invariant C).
- **`reconcileReceipt(stored, applications)`** — the receipt's own invariant:
  `amount = applied + unapplied` and `applied = Σ its application facts`; over-application
  surfaces as drift.
- Foreign facts (another record's rows) and malformed facts are THROWN defects — an
  unreconcilable set never reports sync or false drift.

## 2. Traceability posture (already in force, recorded here)

Every reportable number names its source (`sourceType`/`sourceRecordId` on attribution
snapshots — FIN-002/F3); allocation is exact by construction (F10); exclusions from
plan/forecast comparisons are named (F6/F7); consolidated figures are typed uneliminated
(F10); every governed mutation stages an audit event in-transaction (existing audit
machinery). Nothing new was needed.

## 3. Deferred with cause (not blockers)

- **External reconciliation + freshness/exception records** — arrives WITH the
  authority-of-record selection (#145). The account-page provider-state contract
  (`UNCONFIGURED/ERROR/STALE/PARTIAL/COMPLETE`) remains the display-side seam.
- **Scheduled drift sweeps / a reconciliation surface** — F12/F14 composition of the pure
  cores; a read callable would follow FIN-004 visibility.

## 4. Why it is still dormant — audited 2026-09-12 (P2-K)

Two audit lanes independently read `functions/src/finance/invoiceCommands.ts` and
`functions/src/eosOps/invoiceTotals.ts` and concluded this reconciler was live. It is not, and
never has been: **no module under `functions/src` imports it.** Those two comments have been
corrected in place, and `functions/test/financeDetectorWiring.test.mjs` now fails if the import
graph and that declaration part company in either direction.

Dormancy is now a recorded decision rather than an oversight, and it rests on two things.

**The detector currently disagrees with production about invoice state.** `adjustmentCommands.ts`
deliberately does not move `state` on a credit memo or write-off — "it settles the AR balance
without payment" — while `reconcileInvoiceProjection` re-derives state through
`deriveInvoiceStateFromFacts`, which returns `PAID` for any `outstanding <= 0`. Feeding this
reconciler exactly what `buildAdjustment` produces for a full `WRITE_OFF` or `CREDIT_MEMO` yields
`DRIFT [{ field: "state", storedValue: "ISSUED", derivedValue: "PAID" }]` on a perfectly healthy
invoice. Pinned as an executed test (`KNOWN CONFLICT ...`) in `financialReconciliation.test.mjs`.

> **OWNER QUESTION #1 — invoice lifecycle state after a full write-off or credit memo.** Is the
> invoice `PAID`, or does it stay `ISSUED` with `outstanding = 0`? Two production modules answer
> differently today and only one can be right. Until this is ruled, wiring the reconciler would
> alarm on correct records. No lane should decide it.

**The drift classes are narrowed, not dead.** Every Firestore writer of the AR cache
(`paymentCallables` / `refundCallables` / `adjustmentCallables`) updates it inside the same
transaction that writes the durable fact, and `firestore.rules` denies all client read/write on
`invoices`, `payments`, `payment_applications` and `invoice_adjustments`. The header-vs-lines class
is narrower still: `buildInvoiceRecord` is the only writer of `totalMinor` and derives it from
`eosOps/invoiceTotals.ts`. What remains open: records written before those invariants existed,
out-of-band or manual repair, and the eventual Firestore→Postgres cutover
(`eosOps/invoiceAuthority.ts`, itself unwired). A sweep would be looking for exactly those.

> **OWNER QUESTION #2 — disposition of a discovered divergence.** When a sweep finds a cache/fact
> or Firestore/Postgres divergence, should it BLOCK the operation, WARN, or reconcile
> asynchronously? §3 above defers this; the conservative reading taken meanwhile is to run no sweep
> at all rather than to pick a disposition by default.

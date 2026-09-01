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

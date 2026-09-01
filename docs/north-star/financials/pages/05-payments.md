# 05 — Payments

**Route:** /financials/payments
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 05 Payments.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 05-payments-1440.png · 05-payments-375.png · 05-payment-record-1440.png · 05-payment-record-375.png

## 1–3 · Name, route, purpose
Payments · /financials/payments — Governed operational payment workspace; RECEIVED ≠ APPLIED ≠ UNAPPLIED ≠ RECONCILED.

## 4 · Information hierarchy
Header (received $, unapplied $ exception) → tabs All/Unapplied/Fully applied → table → record: identity header → applications table → unapplied banner w/ gated Apply action → rail (record facts, reconciliation absence, audit).

## 5 · Filters
Company · Period · search (reference/customer).

## 6 · Drilldowns
Row → payment record; applications → invoice records; customer → Customer Financials.

## 7 · Desktop behavior
Unapplied cash is the sorted-first exception.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Unapplied first; apply action drills in; record recomposes.

## 9 · Empty / unavailable / denied states
Unapplied/Partially applied amber AND labelled FUTURE AUTHORITY in the design (unapplied-balance workflow not yet implemented; over-application refused today); "no remittance" note; reconciliation: honest absence ("applied-in-full is an operational state, not reconciliation").

## 10 · Financial facts shown
$231,900 received; $4,180 unapplied/2; per-payment amount/applied/unapplied with cents; method references (check #, ACH).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Payment command core BUILT_DORMANT — supports cash receipt, application to an invoice, derived outstanding balance; over-application is REFUSED. A real unapplied-cash balance workflow is FUTURE AUTHORITY: FIN-AG-PAYMENT-UNAPPLIED. No banking/settlement authority drawn (deliberate).

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-AG-PAYMENT-UNAPPLIED (Owner policy if unresolved); FIN-010 (reserved reconciliation).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Record payment; Apply to invoice.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): payment-record / payment-apply (CONCEPTUAL, IDs TBD).

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PAYMENT-UNAPPLIED; FIN-AG-READ-ACTIVATION.

## 17 · PRODUCT QUESTIONS
Refund flows route through Credits & Adjustments, not here — confirm. FIN-PQ-UNAPPLIED-POLICY: should a real unapplied-cash workflow exist at all (Owner decision).

## 18 · Implementation dependencies
Application events append-only; unapplied remainder derived.

## 19 · Shared components / patterns
NS shell, tabs, exception banner, applications table, record rail. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 05 *.dc.html (project root; copy in design_handoff_financials/). Frames: 05-payments-1440.png · 05-payments-375.png · 05-payment-record-1440.png · 05-payment-record-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.

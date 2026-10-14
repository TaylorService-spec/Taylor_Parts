# 02 — Billing Queue

**Route:** /financials/billing-queue
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 02 Billing Queue.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 02-billing-queue-1440.png · 02-billing-queue-375.png · 02-billing-queue-item-1440.png · 02-billing-queue-item-375.png

## 1–3 · Name, route, purpose
Billing Queue · /financials/billing-queue — Work financially eligible or potentially eligible to invoice; billing readiness ≠ WO COMPLETE.

## 4 · Information hierarchy
Header totals (eligible $ / blocked $) → tabs (Eligible/Blocked/Partially invoiced/All) → one table, blocked reasons inline → bulk Create invoices. Item drill-in sheet: blocking banner → readiness checklist → amount breakdown → invoice history → gated action.

## 5 · Filters
Company · Business Unit · Period (All open default).

## 6 · Drilldowns
Row → item inspection sheet (1b); source → WO/SO record; pricing link → Parts surface.

## 7 · Desktop behavior
Single table, no card-per-row; checkbox selection for bulk issue.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Two-line rows (identity+amount / dimensions+state); no bulk actions; blocked reason verbatim.

## 9 · Empty / unavailable / denied states
Blocked rows carry governed reason inline; Create invoice disabled with capability-inactive one-liner while blocked; "No portion invoiced" empty history line.

## 10 · Financial facts shown
Eligible $74,200/14; blocked $31,450/6; row amounts w/ cents; partial-invoice amounts; readiness facts (work complete, labor priced, parts priced, customer billable).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Source WO/SO facts exist. Commercial Sales Order billing eligibility: governed logic already exists. Service billing readiness (WO COMPLETE ≠ billed): the remaining gap — FIN-AG-SERVICE-BILLING-READINESS; the two models stay separate, no universal readiness model implied. Invoice command core: BUILT_DORMANT.

## 12 · FIN-002..FIN-010 dependencies
Read activation + FIN-004 visibility; FIN-007 where exception governance applies.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Create invoices (bulk), Create invoice (item), Apply-filter/tabs.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): invoice-create (CONCEPTUAL, ID TBD); blocked items never expose the action regardless of capability.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-SERVICE-BILLING-READINESS; FIN-AG-02b no governed pricing-resolution action (links out to Parts); FIN-AG-READ-ACTIVATION.

## 17 · PRODUCT QUESTIONS
Partial-invoicing policy (who may split, on what units) — FIN-007 governance question.

## 18 · Implementation dependencies
Needs readiness projection over WO/SO + pricing; blocking reasons as governed enum.

## 19 · Shared components / patterns
NS shell, tabs-with-counts, exception-tinted banner (#F7EFE4), readiness checklist rows, capability-inactive line. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 02 *.dc.html (project root; copy in design_handoff_financials/). Frames: 02-billing-queue-1440.png · 02-billing-queue-375.png · 02-billing-queue-item-1440.png · 02-billing-queue-item-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.

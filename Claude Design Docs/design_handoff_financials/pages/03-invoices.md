# 03 — Invoices

**Route:** /financials/invoices
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 03 Invoices.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 03-invoices-1440.png · 03-invoices-375.png · 03-invoice-record-1440.png · 03-invoice-record-375.png

## 1–3 · Name, route, purpose
Invoices · /financials/invoices — Governed invoice collection and immutable invoice record.

## 4 · Information hierarchy
Collection: tabs All/Open/Paid/Corrected → table (Invoice, Customer, Company·Unit, Issued, Due, Total, Applied, Outstanding, Status). Record: identity header + outstanding summary → immutable lines w/ line-level BU + lineage → payments & corrections ledger → rail (record facts, reconciliation absence, audit).

## 5 · Filters
Company · Period · search (invoice # / customer).

## 6 · Drilldowns
Row → invoice record; lines → source SO/WO; payments → payment record; credits → correction record; customer → Account.

## 7 · Desktop behavior
Issuing happens only from Billing Queue — no New Invoice button here (deliberate).

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Two-line collection rows; record recomposes to summary → lines → payments/corrections → reconciliation line.

## 9 · Empty / unavailable / denied states
Mixed invoice shows "Mixed (2 units)" at collection level (line-level BU is the only unit truth); Corrected rows keep issued value visible with derivation label; Reconciliation section: honest no-authority statement; Overdue in red.

## 10 · Financial facts shown
41 invoices; $288,150 billed; per-row totals/applied/outstanding with cents; record: issued $2,240.00, applied $1,890.00, credited $350.00, outstanding $0.00; line-level business units; terms; currency USD.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Invoice command authority BUILT_DORMANT — read/UI exposure not yet activated. Company authority: SalesOrder.operatingCompanyId (FIN-002 COMPLETE); line-level BU attribution complete. Corrections governance: FIN-007. Reconciliation column withheld: FIN-010.

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-007 (corrections shown on record); FIN-010 (reserved column).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating on collection; record links out. Corrections happen in Credits & Adjustments.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped by visibility.

## 15 · DESIGN GAPS
Reconciliation Status column withheld by design until FIN-010 (reserved slot, named).

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION (invoice read/UI exposure over the dormant core).

## 17 · PRODUCT QUESTIONS
None — INV-YYYY-NNNN is a SPECIMEN format; current governed numbering authority is used at implementation (not a new product decision).

## 18 · Implementation dependencies
Immutable issued lines; corrections as appended events; mixed-BU handling in filters.

## 19 · Shared components / patterns
NS shell, tabs, record header w/ amount summary rail, immutable-lines table, event ledger list. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 03 *.dc.html (project root; copy in design_handoff_financials/). Frames: 03-invoices-1440.png · 03-invoices-375.png · 03-invoice-record-1440.png · 03-invoice-record-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.

# 07 — Customer Financials

**Route:** /financials/customer-financials
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 07 Customer Financials.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 07-customer-financials-1440.png · 07-customer-financials-375.png

## 1–3 · Name, route, purpose
Customer Financials · /financials/customer-financials — Customer-centric composition of governed Sales and Service financial facts; never duplicates Customer identity.

## 4 · Information hierarchy
Customer search/selector → identity line (links to Account) → 5-figure summary (Booked/Billed/Collected/Outstanding/Credits) + Sales-vs-Service split → financial history (event ledger, newest first) → open-items rail + context rail.

## 5 · Filters
Customer selector · Period (YTD default).

## 6 · Drilldowns
Every event → owning record (invoice/payment/correction/SO); customer → Account North Star.

## 7 · Desktop behavior
1fr/320px grid; read-only ledger.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
2×2 summary grid → open items → recent history lines.

## 9 · Empty / unavailable / denied states
Unapplied/blocked open items carry their exception colors; unattributed lineage reported as "unattributed", never guessed.

## 10 · Financial facts shown
Canyon Foods YTD: booked $48,300; billed $41,050; collected $37,940; outstanding $3,110; credits $350; Sales $29,400 / Service $18,900 split from source lineage.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Composes invoice/payment/correction reads (cores BUILT_DORMANT, activation pending) over FIN-002-complete attribution; identity from the existing certified Customer record — no separate truth store.

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-007.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating (composition page).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped by visibility.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION; FIN-AG-PAYMENT-UNAPPLIED (the unapplied open item carries the same future-authority label).

## 17 · PRODUCT QUESTIONS
None new.

## 18 · Implementation dependencies
Cross-collection composed read keyed by customer; figures must reconcile to owning pages to the cent.

## 19 · Shared components / patterns
NS shell, summary figures, event ledger, open-items rail. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 07 *.dc.html (project root; copy in design_handoff_financials/). Frames: 07-customer-financials-1440.png · 07-customer-financials-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
